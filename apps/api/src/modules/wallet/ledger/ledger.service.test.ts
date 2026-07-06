import { describe, expect, it } from 'vitest';
import { LedgerService } from './ledger.service';
import {
  EmptyJournalError,
  UnbalancedJournalError,
  ZeroAmountLineError,
} from './ledger.errors';

describe('LedgerService.validateLines (double-entry invariants)', () => {
  it('accepts a balanced two-line journal', () => {
    expect(() =>
      LedgerService.validateLines([
        { accountId: 'a', amountMinor: -500_00n },
        { accountId: 'b', amountMinor: 500_00n },
      ]),
    ).not.toThrow();
  });

  it('accepts a settlement-shaped journal (escrow → commission + winners) that zeroes out', () => {
    // 10 entries × ₦1,000 = ₦10,000 pool: 15% commission, 85% to two winners.
    expect(() =>
      LedgerService.validateLines([
        { accountId: 'escrow', amountMinor: -1_000_000n },
        { accountId: 'platform', amountMinor: 150_000n },
        { accountId: 'winner1', amountMinor: 595_000n }, // 70% of 850k
        { accountId: 'winner2', amountMinor: 255_000n }, // 30% of 850k
      ]),
    ).not.toThrow();
  });

  it('rejects unbalanced lines', () => {
    expect(() =>
      LedgerService.validateLines([
        { accountId: 'a', amountMinor: -500n },
        { accountId: 'b', amountMinor: 499n },
      ]),
    ).toThrow(UnbalancedJournalError);
  });

  it('rejects single-line journals', () => {
    expect(() =>
      LedgerService.validateLines([{ accountId: 'a', amountMinor: 100n }]),
    ).toThrow(EmptyJournalError);
  });

  it('rejects zero-amount lines', () => {
    expect(() =>
      LedgerService.validateLines([
        { accountId: 'a', amountMinor: 0n },
        { accountId: 'b', amountMinor: 0n },
      ]),
    ).toThrow(ZeroAmountLineError);
  });

  it('uses bigint arithmetic (no float drift at scale)', () => {
    const big = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    expect(() =>
      LedgerService.validateLines([
        { accountId: 'a', amountMinor: -big },
        { accountId: 'b', amountMinor: big },
      ]),
    ).not.toThrow();
  });
});
