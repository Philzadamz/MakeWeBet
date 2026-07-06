import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EventTopic } from '@fiq/contracts';
import type { Prisma } from '@prisma/client';

/**
 * Transactional outbox writer.
 *
 * ALWAYS call `emit` with the SAME Prisma transaction client (`tx`) that
 * performs the state change. That is the whole point: the event row commits
 * atomically with the domain write, and the relay guarantees at-least-once
 * delivery to BullMQ afterwards. Consumers dedupe on `eventId`.
 */
@Injectable()
export class OutboxService {
  async emit<T>(
    tx: Prisma.TransactionClient,
    topic: EventTopic,
    payload: T,
  ): Promise<string> {
    const eventId = randomUUID();
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        topic,
        payload: {
          eventId,
          topic,
          occurredAt: new Date().toISOString(),
          payload: payload as Prisma.InputJsonValue,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return eventId;
  }
}
