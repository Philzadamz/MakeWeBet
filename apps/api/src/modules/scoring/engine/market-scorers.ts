import type { MarketType } from '@fiq/contracts';
import type { FinalResult, MarketScorer } from './types';

/**
 * Pure, deterministic market scorers. No I/O, no clocks, no randomness —
 * given the same result and selection they always agree, which is what
 * makes rescoring after a result correction safe.
 */

const outcome = (h: number, a: number): 'HOME' | 'DRAW' | 'AWAY' =>
  h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW';

const matchWinner: MarketScorer = (sel, r) => sel === outcome(r.homeGoals, r.awayGoals);

const doubleChance: MarketScorer = (sel, r) => {
  const o = outcome(r.homeGoals, r.awayGoals);
  switch (sel) {
    case 'HOME_OR_DRAW':
      return o !== 'AWAY';
    case 'AWAY_OR_DRAW':
      return o !== 'HOME';
    case 'HOME_OR_AWAY':
      return o !== 'DRAW';
    default:
      return false;
  }
};

const overUnder25: MarketScorer = (sel, r) => {
  const total = r.homeGoals + r.awayGoals;
  return sel === 'OVER' ? total >= 3 : sel === 'UNDER' ? total <= 2 : false;
};

const btts: MarketScorer = (sel, r) => {
  const both = r.homeGoals > 0 && r.awayGoals > 0;
  return sel === 'YES' ? both : sel === 'NO' ? !both : false;
};

const firstHalfWinner: MarketScorer = (sel, r) => sel === outcome(r.htHomeGoals, r.htAwayGoals);

const firstTeamToScore: MarketScorer = (sel, r) => {
  const mapped = sel === 'NO_GOAL' ? 'NONE' : sel;
  return mapped === r.firstToScore;
};

const winningMargin: MarketScorer = (sel, r) => {
  const diff = r.homeGoals - r.awayGoals;
  if (diff === 0) return sel === 'DRAW';
  const side = diff > 0 ? 'HOME' : 'AWAY';
  const margin = Math.abs(diff);
  const band = margin >= 3 ? '3_PLUS' : String(margin);
  return sel === `${side}_BY_${band}`;
};

const cleanSheet: MarketScorer = (sel, r) => {
  const homeCs = r.awayGoals === 0;
  const awayCs = r.homeGoals === 0;
  const actual = homeCs && awayCs ? 'BOTH' : homeCs ? 'HOME' : awayCs ? 'AWAY' : 'NONE';
  return sel === actual;
};

const exactGoals: MarketScorer = (sel, r) => {
  const total = r.homeGoals + r.awayGoals;
  return sel === (total >= 5 ? '5_PLUS' : String(total));
};

const correctScore: MarketScorer = (sel, r) => sel === `${r.homeGoals}-${r.awayGoals}`;

export const MARKET_SCORERS: Record<MarketType, MarketScorer> = {
  MATCH_WINNER: matchWinner,
  DOUBLE_CHANCE: doubleChance,
  OVER_UNDER_25: overUnder25,
  BTTS: btts,
  FIRST_HALF_WINNER: firstHalfWinner,
  FIRST_TEAM_TO_SCORE: firstTeamToScore,
  WINNING_MARGIN: winningMargin,
  CLEAN_SHEET: cleanSheet,
  EXACT_GOALS: exactGoals,
  CORRECT_SCORE: correctScore,
};

export function scorePrediction(
  marketType: MarketType,
  selection: string,
  result: FinalResult,
  pointsX10: number,
): { isCorrect: boolean; pointsX10: number } {
  const isCorrect = MARKET_SCORERS[marketType](selection, result);
  return { isCorrect, pointsX10: isCorrect ? pointsX10 : 0 };
}
