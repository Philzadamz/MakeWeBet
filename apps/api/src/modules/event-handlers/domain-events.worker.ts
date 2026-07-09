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
import { DifficultyService } from '../difficulty/difficulty.service';

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
    private readonly difficulty: DifficultyService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('RUN_WORKERS')) return;
    // A Worker holds its Redis connection open on a blocking read waiting
    // for new jobs; sharing that connection with anything else (the
    // outbox relay's Queue.add() calls, pub/sub, etc.) starves it of
    // notifications for jobs added while it's mid-block. Needs its own.
    //
    // Concurrency post-mortem — two entangled bugs once hid here:
    //  1. "Jobs silently dropped" was test-env contamination: the dev
    //     .env's REDIS_URL leaked into e2e (config snapshots env at import
    //     time) and a running dev server consumed the test app's jobs.
    //     Fixed via vitest test.env + ignoreEnvFile (see test/env.ts).
    //  2. A REAL lost-update race: concurrent scoring of two fixtures of
    //     the same contest clobbered each other's entry aggregates (settled
    //     at 120.0/150.0). Fixed with a per-contest advisory lock in
    //     ScoringService — which is what makes concurrency>1 safe here.
    this.worker = new Worker(DOMAIN_EVENTS_QUEUE, (job) => this.route(job), {
      connection: this.redis.duplicate(),
      concurrency: 5,
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
      case EventTopics.FixtureSynced:
        // May take multiple rate-limited provider calls — exactly why it
        // runs here (background, serialized) and not inline with sync.
        await this.difficulty.computeForFixture(envelope.payload.fixtureId!);
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
