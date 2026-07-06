import { createHash } from 'node:crypto';

/**
 * Tie-breaker chain (spec order):
 *   1. Highest total points
 *   2. Most correct Expert (Correct Score) predictions
 *   3. Most correct Hard predictions
 *   4. Earliest slip submission (server receive time)
 *   5. Deterministic "random" draw: sha256(contestId|entryId) — reproducible
 *      from public data, so a disputed draw can be independently verified.
 * The chain yields a TOTAL order (entryId hash never collides in practice),
 * so prize positions are always unambiguous.
 */

export interface RankableEntry {
  entryId: string;
  totalPointsX10: number;
  correctExpert: number;
  correctHard: number;
  submittedAt: Date;
}

export function drawHash(contestId: string, entryId: string): string {
  return createHash('sha256').update(`${contestId}|${entryId}`).digest('hex');
}

export function compareEntries(contestId: string) {
  return (a: RankableEntry, b: RankableEntry): number => {
    if (a.totalPointsX10 !== b.totalPointsX10) return b.totalPointsX10 - a.totalPointsX10;
    if (a.correctExpert !== b.correctExpert) return b.correctExpert - a.correctExpert;
    if (a.correctHard !== b.correctHard) return b.correctHard - a.correctHard;
    const timeDiff = a.submittedAt.getTime() - b.submittedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return drawHash(contestId, a.entryId).localeCompare(drawHash(contestId, b.entryId));
  };
}

export function rankEntries<T extends RankableEntry>(contestId: string, entries: T[]): T[] {
  return [...entries].sort(compareEntries(contestId));
}

/**
 * Expand a payout template ([{from,to,shareBps}]) into per-position shares,
 * clamp to the actual entrant count, and RENORMALIZE so the full pool is
 * always distributed (e.g. a single entrant takes 100% of the pool even
 * under a 50/30/20 template). Integer math; dust goes to position 1.
 */
export interface PayoutRow {
  from: number;
  to: number;
  shareBps: number;
}

export function computePrizes(
  poolMinor: bigint,
  template: PayoutRow[],
  entrantCount: number,
): bigint[] {
  const perPosition: number[] = [];
  for (const row of template) {
    const span = row.to - row.from + 1;
    for (let pos = row.from; pos <= row.to; pos++) {
      perPosition[pos - 1] = Math.floor(row.shareBps / span);
    }
  }
  const paidPositions = Math.min(entrantCount, perPosition.length);
  if (paidPositions === 0 || poolMinor <= 0n) return [];

  const shares = perPosition.slice(0, paidPositions);
  const shareSum = BigInt(shares.reduce((s, v) => s + v, 0));

  const prizes = shares.map((share) => (poolMinor * BigInt(share)) / shareSum);
  const dust = poolMinor - prizes.reduce((s, p) => s + p, 0n);
  prizes[0] = (prizes[0] ?? 0n) + dust; // pool always fully distributed
  return prizes;
}
