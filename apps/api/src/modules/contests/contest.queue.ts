import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';

export const CONTEST_LIFECYCLE_QUEUE = 'contest-lifecycle';

@Injectable()
export class ContestQueue {
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
      { jobId: `lock:${contestId}`, delay, attempts: 3, removeOnComplete: 1000 },
    );
  }
}
