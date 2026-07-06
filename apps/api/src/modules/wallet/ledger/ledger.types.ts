import type { JournalType } from '@prisma/client';

export interface JournalLineInput {
  accountId: string;
  /** Signed minor units: positive credits the account, negative debits it. */
  amountMinor: bigint;
}

export interface PostJournalInput {
  type: JournalType;
  /** Replay shield — retrying with the same key returns the original entry. */
  idempotencyKey: string;
  description: string;
  lines: JournalLineInput[];
  metadata?: Record<string, unknown>;
}

/** Account types whose materialized balance must never go negative. */
export const NON_NEGATIVE_ACCOUNT_TYPES = new Set([
  'USER_AVAILABLE',
  'USER_WITHDRAWAL_PENDING',
  'CONTEST_ESCROW',
]);
