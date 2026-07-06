import { describe, expect, it } from 'vitest';
import {
  computeSignals,
  computeStars,
  scoreToStars,
  weightedScore,
  type DifficultyInput,
} from './difficulty-engine';

const EQUAL_WEIGHTS = {
  form: 0.2,
  leaguePosition: 0.2,
  goalDifference: 0.2,
  headToHead: 0.2,
  injuries: 0.2,
};

const titansClash: DifficultyInput = {
  // Two in-form, adjacent, evenly-matched teams → maximum unpredictability.
  home: { last5: ['W', 'W', 'W', 'D', 'W'], leaguePosition: 1, goalDifference: 25 },
  away: { last5: ['W', 'W', 'D', 'W', 'W'], leaguePosition: 2, goalDifference: 24 },
  headToHead: { homeWins: 3, awayWins: 3, draws: 4, matches: 10 },
  tableSize: 20,
};

const walkover: DifficultyInput = {
  // League leaders vs bottom side in freefall → very predictable.
  home: { last5: ['W', 'W', 'W', 'W', 'W'], leaguePosition: 1, goalDifference: 30 },
  away: { last5: ['L', 'L', 'L', 'L', 'L'], leaguePosition: 20, goalDifference: -28 },
  headToHead: { homeWins: 9, awayWins: 0, draws: 1, matches: 10 },
  tableSize: 20,
};

describe('computeSignals', () => {
  it('rates evenly-matched teams as highly unpredictable', () => {
    const s = computeSignals(titansClash);
    expect(s.form).toBeGreaterThan(0.9);
    expect(s.leaguePosition).toBeGreaterThan(0.9);
    expect(s.headToHead).toBe(1);
  });

  it('rates mismatches as predictable', () => {
    const s = computeSignals(walkover);
    expect(s.form).toBe(0);
    expect(s.headToHead).toBeLessThan(0.2);
  });

  it('omits signals whose inputs are missing', () => {
    const s = computeSignals({ home: { last5: ['W'] }, away: { last5: ['L'] } });
    expect(s.leaguePosition).toBeUndefined();
    expect(s.injuries).toBeUndefined();
    expect(s.form).toBeDefined();
  });
});

describe('weightedScore', () => {
  it('renormalizes weights over present signals', () => {
    // Only form present: its weight should become 100% regardless of others.
    expect(weightedScore({ form: 0.8 }, EQUAL_WEIGHTS)).toBeCloseTo(0.8);
  });

  it('returns neutral 0.5 with no usable signals', () => {
    expect(weightedScore({}, EQUAL_WEIGHTS)).toBe(0.5);
  });
});

describe('computeStars', () => {
  it('gives a titans clash 5 stars and a walkover 1 star', () => {
    expect(computeStars(titansClash, EQUAL_WEIGHTS).stars).toBe(5);
    expect(computeStars(walkover, EQUAL_WEIGHTS).stars).toBe(1);
  });

  it('is deterministic', () => {
    expect(computeStars(titansClash, EQUAL_WEIGHTS)).toEqual(
      computeStars(titansClash, EQUAL_WEIGHTS),
    );
  });
});

describe('scoreToStars bands', () => {
  it.each([
    [0, 1],
    [0.19, 1],
    [0.2, 2],
    [0.45, 3],
    [0.65, 4],
    [0.8, 5],
    [1, 5],
  ])('%f → %i stars', (score, stars) => {
    expect(scoreToStars(score)).toBe(stars);
  });
});
