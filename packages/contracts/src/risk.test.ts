import { describe, expect, it } from 'vitest';
import { computeRiskMeter, slotRisk } from './risk';
import { DEFAULT_MARKET_POINTS_X10, MAX_SCORE_X10, slipMaxScoreX10 } from './scoring';

describe('point math (Balanced Challenge Rule)', () => {
  it('a full slip totals exactly 150.0 points (1500 X10)', () => {
    expect(slipMaxScoreX10()).toBe(MAX_SCORE_X10);
  });

  it('expert tier carries 32.5 points each', () => {
    expect(DEFAULT_MARKET_POINTS_X10.CORRECT_SCORE).toBe(325);
  });
});

describe('risk meter', () => {
  const fullSlip = [
    { marketType: 'MATCH_WINNER', stars: 1, pointsX10: 50 },
    { marketType: 'DOUBLE_CHANCE', stars: 1, pointsX10: 50 },
    { marketType: 'OVER_UNDER_25', stars: 2, pointsX10: 100 },
    { marketType: 'BTTS', stars: 2, pointsX10: 100 },
    { marketType: 'FIRST_HALF_WINNER', stars: 2, pointsX10: 100 },
    { marketType: 'WINNING_MARGIN', stars: 3, pointsX10: 150 },
    { marketType: 'CLEAN_SHEET', stars: 3, pointsX10: 150 },
    { marketType: 'EXACT_GOALS', stars: 3, pointsX10: 150 },
    { marketType: 'CORRECT_SCORE', stars: 4, pointsX10: 325 },
    { marketType: 'CORRECT_SCORE', stars: 4, pointsX10: 325 },
  ] as const;

  it('reports max potential score of 150 for a full slip', () => {
    const result = computeRiskMeter([...fullSlip]);
    expect(result.maxPotentialScoreX10).toBe(1500);
  });

  it('is monotonic in stars', () => {
    expect(slotRisk('CORRECT_SCORE', 5)).toBeGreaterThan(slotRisk('CORRECT_SCORE', 1));
  });

  it('classifies low-star safe markets as SAFE', () => {
    const result = computeRiskMeter([
      { marketType: 'DOUBLE_CHANCE', stars: 1, pointsX10: 50 },
      { marketType: 'MATCH_WINNER', stars: 1, pointsX10: 50 },
    ]);
    expect(result.profile).toBe('SAFE');
  });

  it('classifies high-star expert-heavy slips as AGGRESSIVE', () => {
    const result = computeRiskMeter([
      { marketType: 'CORRECT_SCORE', stars: 5, pointsX10: 325 },
      { marketType: 'EXACT_GOALS', stars: 5, pointsX10: 150 },
    ]);
    expect(result.profile).toBe('AGGRESSIVE');
  });

  it('is deterministic (client and server agree)', () => {
    const a = computeRiskMeter([...fullSlip]);
    const b = computeRiskMeter([...fullSlip]);
    expect(a).toEqual(b);
  });
});
