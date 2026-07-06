import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  EmptyJournalError,
  InsufficientFundsError,
  UnbalancedJournalError,
  ZeroAmountLineError,
} from './ledger.errors';
import {
  NON_NEGATIVE_ACCOUNT_TYPES,
  type JournalLineInput,
  type PostJournalInput,
} from './ledger.types';

/**
 * Double-entry ledger — the ONLY code path that moves money.
 *
 * Invariants enforced here (and re-checked by a DB trigger in migration
 * 0002_ledger_guards + nightly reconciliation):
 *   1. Every journal entry's lines sum to exactly zero.
 *   2. Journal rows are append-only (no update/delete methods exist).
 *   3. User/escrow balances can never go negative — checked INSIDE the
 *      transaction after the balance update, so a violation rolls back
 *      the whole journal atomically.
 *   4. Idempotency: reposting with a used key returns the original entry id.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Validate lines before touching the database. Pure — unit-tested directly. */
  static validateLines(lines: JournalLineInput[]): void {
    if (lines.length < 2) throw new EmptyJournalError();
    if (lines.some((l) => l.amountMinor === 0n)) throw new ZeroAmountLineError();
    const sum = lines.reduce((acc, l) => acc + l.amountMinor, 0n);
    if (sum !== 0n) throw new UnbalancedJournalError(sum);
  }

  /**
   * Post a journal entry atomically. Accepts an optional outer transaction
   * client so callers (e.g. contest entry) can bundle the money movement
   * with their own domain writes in ONE database transaction.
   */
  async post(input: PostJournalInput, outerTx?: Prisma.TransactionClient): Promise<string> {
    LedgerService.validateLines(input.lines);

    const run = async (tx: Prisma.TransactionClient): Promise<string> => {
      const existing = await tx.journalEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(`journal replay ignored (key=${input.idempotencyKey})`);
        return existing.id;
      }

      const entry = await tx.journalEntry.create({
        data: {
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          description: input.description,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          lines: {
            create: input.lines.map((l) => ({
              accountId: l.accountId,
              amountMinor: l.amountMinor,
            })),
          },
        },
        select: { id: true },
      });

      // Apply balance deltas and enforce non-negativity inside the tx.
      for (const line of input.lines) {
        const account = await tx.ledgerAccount.update({
          where: { id: line.accountId },
          data: { balanceMinor: { increment: line.amountMinor } },
          select: { id: true, type: true, balanceMinor: true },
        });
        if (
          NON_NEGATIVE_ACCOUNT_TYPES.has(account.type) &&
          account.balanceMinor < 0n
        ) {
          throw new InsufficientFundsError(account.id);
        }
      }

      return entry.id;
    };

    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run, { isolationLevel: 'ReadCommitted' });
  }
}
