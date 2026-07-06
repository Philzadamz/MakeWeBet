import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Append-only audit trail. Rows are hash-chained: each row's hash covers the
 * previous row's hash, so tampering with history is detectable by replaying
 * the chain. Every admin/financial mutation must call `record`.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: {
      actorId?: string;
      actorType: 'USER' | 'ADMIN' | 'SYSTEM';
      action: string;
      entityType: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
      ip?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const last = await db.auditLog.findFirst({
      orderBy: { id: 'desc' },
      select: { hash: true },
    });
    const prevHash = last?.hash ?? 'genesis';
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          prevHash,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: input.before ?? null,
          after: input.after ?? null,
        }),
      )
      .digest('hex');

    await db.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as Prisma.InputJsonValue | undefined,
        after: input.after as Prisma.InputJsonValue | undefined,
        ip: input.ip,
        prevHash,
        hash,
      },
    });
  }
}
