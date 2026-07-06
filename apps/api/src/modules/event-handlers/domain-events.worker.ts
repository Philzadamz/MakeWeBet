import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { EventTopics, type DomainEventEnvelope } from '@fiq/contracts';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { DOMAIN_EVENTS_QUEUE } from '../../infrastructure/outbox/outbox.relay';
import { ScoringService } from '../scoring/scoring.service';
import { SettlementService } from '../settlement/settlement.service';
import { StatsService } from '../stats/stats.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';

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
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('RUN_WORKERS')) return;
    this.worker = new Worker(DOMAIN_EVENTS_QUEUE, (job) => this.route(job), {
      connection: this.redis,
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
        break;
      case EventTopics.PrizesDistributed:
        await this.stats.recomputeForContest(envelope.payload.contestId!);
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

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
