import type { MarketType } from '@fiq/contracts';

/** Canonical finalized match result — the only input scorers may see. */
export interface FinalResult {
  homeGoals: number;
  awayGoals: number;
  htHomeGoals: number;
  htAwayGoals: number;
  firstToScore: 'HOME' | 'AWAY' | 'NONE';
}

/** A scorer decides correctness only. Points come from the contest's RuleSet. */
export type MarketScorer = (selection: string, result: FinalResult) => boolean;

export interface ScoredPrediction {
  marketType: MarketType;
  selection: string;
  isCorrect: boolean;
  pointsX10: number;
}
