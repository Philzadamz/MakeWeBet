import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';

export const CONTEST_LIFECYCLE_QUEUE = 'contest-lifecycle';

@Injectable()
export class ContestQueue implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue(CONTEST_LIFECYCLE_QUEUE, { connection: redis });
  }

  /** Delayed lock job; jobId makes rescheduling/duplication safe. */
  async scheduleLock(contestId: string, lockAt: Date): Promise<void> {
    const delay = Math.max(0, lockAt.getTime() - Date.now());
    await this.queue.add(
      'lock',
      { contestId },
      // BullMQ rejects custom job IDs containing ':' — it's the internal
      // Redis key delimiter between prefix/queue-name/jobId.
      { jobId: `lock-${contestId}`, delay, attempts: 3, removeOnComplete: 1000 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
