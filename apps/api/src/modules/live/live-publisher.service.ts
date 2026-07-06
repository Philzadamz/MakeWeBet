import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';

export const LIVE_CHANNEL = 'fiq:live';

export interface LiveEvent {
  type: 'leaderboard:update' | 'pool:update' | 'contest:status';
  contestId: string;
  slug: string;
  payload?: Record<string, unknown>;
}

/**
 * Bridge from background workers to WebSocket clients. Workers publish to a
 * Redis channel; every gateway pod subscribes and fans out to its sockets —
 * so it works identically whether workers run in-process (dev) or as a
 * separate deployment (prod).
 */
@Injectable()
export class LivePublisher {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: LiveEvent): Promise<void> {
    await this.redis.publish(LIVE_CHANNEL, JSON.stringify(event));
  }
}
