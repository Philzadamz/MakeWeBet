import { describe, expect, it } from 'vitest';
import { computePrizes, drawHash, rankEntries, type RankableEntry } from './ranking';

const t0 = new Date('2026-07-06T10:00:00Z');
const t1 = new Date('2026-07-06T11:00:00Z');

const entry = (over: Partial<RankableEntry>): RankableEntry => ({
  entryId: 'e-default',
  totalPointsX10: 1000,
  correctExpert: 1,
  correctHard: 2,
  submittedAt: t0,
  ...over,
});

describe('rankEntries tie-breaker chain', () => {
  it('ranks by points first', () => {
    const ranked = rankEntries('c1', [
      entry({ entryId: 'low', totalPointsX10: 500 }),
      entry({ entryId: 'high', totalPointsX10: 1500 }),
    ]);
    expect(ranked.map((e) => e.entryId)).toEqual(['high', 'low']);
  });

  it('breaks point ties by correct Expert predictions', () => {
    const ranked = rankEntries('c1', [
      entry({ entryId: 'a', correctExpert: 0 }),
      entry({ entryId: 'b', correctExpert: 2 }),
    ]);
    expect(ranked[0]?.entryId).toBe('b');
  });

  it('then by correct Hard predictions', () => {
    const ranked = rankEntries('c1', [
      entry({ entryId: 'a', correctHard: 1 }),
      entry({ entryId: 'b', correctHard: 3 }),
    ]);
    expect(ranked[0]?.entryId).toBe('b');
  });

  it('then by earliest submission', () => {
    const ranked = rankEntries('c1', [
      entry({ entryId: 'late', submittedAt: t1 }),
      entry({ entryId: 'early', submittedAt: t0 }),
    ]);
    expect(ranked[0]?.entryId).toBe('early');
  });

  it('final draw is deterministic and reproducible', () => {
    const entries = [entry({ entryId: 'x' }), entry({ entryId: 'y' })];
    const first = rankEntries('c1', entries).map((e) => e.entryId);
    const second = rankEntries('c1', entries).map((e) => e.entryId);
    expect(first).toEqual(second);
    const expected = [
      { id: 'x', h: drawHash('c1', 'x') },
      { id: 'y', h: drawHash('c1', 'y') },
    ]
      .sort((a, b) => a.h.localeCompare(b.h))
      .map((v) => v.id);
    expect(first).toEqual(expected);
  });
});

describe('computePrizes', () => {
  const template = [
    { from: 1, to: 1, shareBps: 5000 },
    { from: 2, to: 2, shareBps: 3000 },
    { from: 3, to: 3, shareBps: 2000 },
  ];

  it('splits 50/30/20 with enough entrants', () => {
    expect(computePrizes(85_000n, template, 10)).toEqual([42_500n, 25_500n, 17_000n]);
  });

  it('renormalizes when entrants < positions (single entrant takes full pool)', () => {
    expect(computePrizes(85_000n, template, 1)).toEqual([85_000n]);
  });

  it('renormalizes for two entrants (50:30 → 5/8 : 3/8)', () => {
    const [p1, p2] = computePrizes(80_000n, template, 2);
    expect(p1! + p2!).toBe(80_000n);
    expect(p1).toBe(50_000n); // 80000*5000/8000
    expect(p2).toBe(30_000n);
  });

  it('always distributes the entire pool (dust to winner)', () => {
    const prizes = computePrizes(100_001n, template, 3);
    expect(prizes.reduce((s, p) => s + p, 0n)).toBe(100_001n);
  });

  it('splits ranged rows across positions', () => {
    const ranged = [
      { from: 1, to: 1, shareBps: 6000 },
      { from: 2, to: 3, shareBps: 4000 }, // 2000 each
    ];
    expect(computePrizes(100_000n, ranged, 3)).toEqual([60_000n, 20_000n, 20_000n]);
  });
});
