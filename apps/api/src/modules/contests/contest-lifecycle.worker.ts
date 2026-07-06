import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { ContestsService } from './contests.service';
import { CONTEST_LIFECYCLE_QUEUE } from './contest.queue';

/**
 * Processes contest lifecycle jobs (lock at first kickoff). Runs only when
 * RUN_WORKERS=true — API-only pods keep it off; worker pods keep it on.
 */
@Injectable()
export class ContestLifecycleWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContestLifecycleWorker.name);
  private worker?: Worker;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly contests: ContestsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('RUN_WORKERS')) return;
    this.worker = new Worker(
      CONTEST_LIFECYCLE_QUEUE,
      async (job) => {
        if (job.name === 'lock') {
          await this.contests.lock((job.data as { contestId: string }).contestId);
        }
      },
      { connection: this.redis },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`job ${job?.name}:${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
