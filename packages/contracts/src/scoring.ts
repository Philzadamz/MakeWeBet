import { DifficultyTier, MarketType } from './enums';

/**
 * POINT MATH — the Balanced Challenge Rule.
 *
 * All point values are stored as integers scaled ×10 ("X10") so the
 * Expert tier can carry 32.5 real points without floating-point drift
 * anywhere in scoring, ranking, or prize logic.
 *
 *   2 × Easy    @  5.0  =  10
 *   3 × Medium  @ 10.0  =  30
 *   3 × Hard    @ 15.0  =  45
 *   2 × Expert  @ 32.5  =  65
 *   ────────────────────────────
 *   Maximum contest score  150.0  (1500 in X10 units)
 *
 * These are LAUNCH DEFAULTS. Live values come from the versioned RuleSet
 * in the database; contests snapshot a rule-set version at publish time.
 */

export const POINTS_SCALE = 10;

export const SLOT_DISTRIBUTION: Record<DifficultyTier, number> = {
  EASY: 2,
  MEDIUM: 3,
  HARD: 3,
  EXPERT: 2,
};

export const TOTAL_SLOTS = 10;

export const DEFAULT_TIER_POINTS_X10: Record<DifficultyTier, number> = {
  EASY: 50, //  5.0 pts
  MEDIUM: 100, // 10.0 pts
  HARD: 150, // 15.0 pts
  EXPERT: 325, // 32.5 pts
};

export const DEFAULT_MARKET_POINTS_X10: Record<MarketType, number> = {
  MATCH_WINNER: 50,
  DOUBLE_CHANCE: 50,
  OVER_UNDER_25: 100,
  BTTS: 100,
  FIRST_HALF_WINNER: 100,
  FIRST_TEAM_TO_SCORE: 100,
  WINNING_MARGIN: 150,
  CLEAN_SHEET: 150,
  EXACT_GOALS: 150,
  CORRECT_SCORE: 325,
};

export const MAX_SCORE_X10 = 1500; // 150.0 points

/** Render an X10 value for display: 325 -> "32.5", 100 -> "10". */
export function formatPoints(pointsX10: number): string {
  const whole = Math.trunc(pointsX10 / POINTS_SCALE);
  const frac = Math.abs(pointsX10 % POINTS_SCALE);
  return frac === 0 ? `${whole}` : `${whole}.${frac}`;
}

/** Sanity invariant used by tests and the rule-set validator. */
export function slipMaxScoreX10(
  tierPointsX10: Record<DifficultyTier, number> = DEFAULT_TIER_POINTS_X10,
  distribution: Record<DifficultyTier, number> = SLOT_DISTRIBUTION,
): number {
  return (Object.keys(distribution) as DifficultyTier[]).reduce(
    (sum, tier) => sum + distribution[tier] * tierPointsX10[tier],
    0,
  );
}
