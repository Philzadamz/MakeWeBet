import { MarketType, RiskProfile } from './enums';

/**
 * RISK METER — display-only analytics for a prediction slip.
 *
 * HARD RULE: this module must NEVER be imported by the scoring engine.
 * Risk output has zero effect on points; it exists purely to help users
 * understand the shape of their slip. It is deterministic so the client
 * can compute it live and the server can recompute the identical value
 * at submission for the stored record.
 */

/** Intrinsic riskiness of a market (0..1), independent of the fixture. */
export const MARKET_BASE_RISK: Record<MarketType, number> = {
  MATCH_WINNER: 0.35,
  DOUBLE_CHANCE: 0.18,
  OVER_UNDER_25: 0.42,
  BTTS: 0.42,
  FIRST_HALF_WINNER: 0.5,
  FIRST_TEAM_TO_SCORE: 0.48,
  WINNING_MARGIN: 0.68,
  CLEAN_SHEET: 0.62,
  EXACT_GOALS: 0.72,
  CORRECT_SCORE: 0.88,
};

export interface RiskSlotInput {
  marketType: MarketType;
  /** Difficulty heatmap stars for the fixture, 1..5. */
  stars: number;
  /** Points at stake for this slot (X10 units). */
  pointsX10: number;
}

export interface RiskMeterResult {
  profile: RiskProfile;
  /** 0..100, rounded to nearest integer. */
  riskPct: number;
  /** Sum of all slot points (X10) — what a perfect slip would score. */
  maxPotentialScoreX10: number;
}

const MARKET_WEIGHT = 0.55;
const FIXTURE_WEIGHT = 0.45;

export const RISK_THRESHOLDS = { safeMax: 40, balancedMax: 65 } as const;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Per-slot risk 0..1: market base blended with fixture unpredictability. */
export function slotRisk(marketType: MarketType, stars: number): number {
  const fixtureRisk = (Math.min(5, Math.max(1, stars)) - 1) / 4;
  return clamp01(MARKET_WEIGHT * MARKET_BASE_RISK[marketType] + FIXTURE_WEIGHT * fixtureRisk);
}

/**
 * Slip risk is the points-weighted average of slot risks, so risking a
 * 32.5-point Correct Score on a 5-star fixture moves the meter far more
 * than a 5-point Match Winner on a derby.
 */
export function computeRiskMeter(slots: RiskSlotInput[]): RiskMeterResult {
  if (slots.length === 0) {
    return { profile: 'SAFE', riskPct: 0, maxPotentialScoreX10: 0 };
  }
  const totalPoints = slots.reduce((s, slot) => s + slot.pointsX10, 0);
  const weighted = slots.reduce(
    (s, slot) => s + slotRisk(slot.marketType, slot.stars) * slot.pointsX10,
    0,
  );
  const riskPct = Math.round((weighted / totalPoints) * 100);
  const profile: RiskProfile =
    riskPct <= RISK_THRESHOLDS.safeMax
      ? 'SAFE'
      : riskPct <= RISK_THRESHOLDS.balancedMax
        ? 'BALANCED'
        : 'AGGRESSIVE';
  return { profile, riskPct, maxPotentialScoreX10: totalPoints };
}
