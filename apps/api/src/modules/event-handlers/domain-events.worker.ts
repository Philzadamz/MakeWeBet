import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { EventTopics, type DomainEventEnvelope } from '@fiq/contracts';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { DOMAIN_EVENTS_QUEUE } from '../../infrastructure/outbox/outbox.relay';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { SettlementService } from '../settlement/settlement.service';
import { StatsService } from '../stats/stats.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { LivePublisher } from '../live/live-publisher.service';

/**
 * Routes outbox-relayed domain events to their handlers. Delivery is
 * at-least-once (BullMQ jobId = outbox event id dedupes enqueues, but
 * retries re-run handlers), so every handler is idempotent by design.
 */
@Injectable()
export class DomainEventsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsWorker.name);
  private worker?: Worker;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly scoring: ScoringService,
    private readonly settlement: SettlementService,
    private readonly stats: StatsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly prisma: PrismaService,
    private readonly live: LivePublisher,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('RUN_WORKERS')) return;
    // A Worker holds its Redis connection open on a blocking read waiting
    // for new jobs; sharing that connection with anything else (the
    // outbox relay's Queue.add() calls, pub/sub, etc.) starves it of
    // notifications for jobs added while it's mid-block. Needs its own.
    //
    // concurrency IS 1 DELIBERATELY. Under e2e load (5 results finalized in
    // a tight loop, real Prisma transaction work per job), concurrency:5
    // intermittently failed to invoke the processor for some same-tick
    // jobs — no thrown error, no 'failed' event, the callback simply never
    // ran. A minimal bullmq+ioredis repro at the same versions did NOT
    // reproduce it, and the failure rate dropped further once an unrelated
    // competing local process was killed — so host contention is a real
    // contributing factor and the root cause isn't fully isolated. What's
    // confirmed by 9+ consecutive clean e2e runs: concurrency:1 is
    // reliable here. Given the cost of getting this wrong (a contest
    // settling on partial scoring) versus the current event volume,
    // sequential processing is the safe default — revisit only with a
    // benchmark showing concurrency is needed AND a solid repro to verify
    // any fix against.
    this.worker = new Worker(DOMAIN_EVENTS_QUEUE, (job) => this.route(job), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`event ${job?.name}:${job?.id} failed: ${err.message}`),
    );
  }

  private async route(job: Job): Promise<void> {
    const envelope = job.data as DomainEventEnvelope<Record<string, string>>;
    switch (envelope.topic) {
      case EventTopics.MatchResultFinalized:
        await this.scoring.onResultFinalized(envelope.payload.fixtureId!);
        break;
      case EventTopics.ContestScored:
        await this.settlement.distribute(envelope.payload.contestId!);
        await this.pushLive(envelope.payload.contestId!, 'leaderboard:update');
        break;
      case EventTopics.PredictionScored:
        await this.pushLive(envelope.payload.contestId!, 'leaderboard:update');
        break;
      case EventTopics.PrizesDistributed:
        await this.stats.recomputeForContest(envelope.payload.contestId!);
        await this.pushLive(envelope.payload.contestId!, 'leaderboard:update');
        break;
      case EventTopics.EntryPaid:
        await this.pushLive(envelope.payload.contestId!, 'pool:update');
        break;
      case EventTopics.ContestLocked:
      case EventTopics.ContestCancelled:
        await this.pushLive(envelope.payload.contestId!, 'contest:status');
        break;
      case EventTopics.PaymentWebhookReceived: {
        const { event, reference } = envelope.payload;
        if (event === 'transfer.success') {
          await this.withdrawals.settle(reference!, true);
        } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
          await this.withdrawals.settle(reference!, false, event);
        }
        break;
      }
      default:
        // Unhandled topics are fine — stats/notification projections attach here later.
        this.logger.debug(`no handler for ${envelope.topic}`);
    }
  }

  /** Bust the leaderboard cache and push a live tick for a contest. */
  private async pushLive(
    contestId: string,
    type: 'leaderboard:update' | 'pool:update' | 'contest:status',
  ): Promise<void> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      select: {
        slug: true,
        status: true,
        entryFeeMinor: true,
        commissionBps: true,
        _count: { select: { entries: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!contest) return;
    await this.redis.del(`lb:${contest.slug}`);
    const gross = contest.entryFeeMinor * BigInt(contest._count.entries);
    const pool = (gross * (10_000n - BigInt(contest.commissionBps))) / 10_000n;
    await this.live.publish({
      type,
      contestId,
      slug: contest.slug,
      payload: {
        status: contest.status,
        entryCount: contest._count.entries,
        estimatedPrizePoolMinor: pool.toString(),
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
