import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';

/**
 * Polls unpublished outbox rows (oldest first) and publishes them to BullMQ.
 * Uses the event id as the BullMQ job id, so a crash between publish and
 * mark-published cannot double-enqueue (BullMQ dedupes on job id).
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly queue: Queue;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) redis: Redis,
  ) {
    this.queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection: redis });
  }

  @Interval(1000)
  async relay(): Promise<void> {
    if (this.running) return; // no overlapping ticks
    this.running = true;
    try {
      const batch = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      for (const event of batch) {
        try {
          await this.queue.add(event.topic, event.payload, {
            jobId: event.id,
            removeOnComplete: 10_000,
            removeOnFail: false,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
          });
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date() },
          });
        } catch (err) {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: err instanceof Error ? err.message : String(err),
            },
          });
          this.logger.warn(`outbox publish failed for ${event.id}: ${String(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
