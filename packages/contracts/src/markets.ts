import { z } from 'zod';
import { MarketType } from './enums';

/**
 * Selection value schemas — one per prediction market.
 * A prediction is stored as { marketType, selection } where `selection`
 * must satisfy the schema for its market. Shared by API validation,
 * web forms, and the scoring engine.
 */

export const MatchWinnerSelection = z.enum(['HOME', 'DRAW', 'AWAY']);
export const DoubleChanceSelection = z.enum(['HOME_OR_DRAW', 'AWAY_OR_DRAW', 'HOME_OR_AWAY']);
export const OverUnder25Selection = z.enum(['OVER', 'UNDER']);
export const BttsSelection = z.enum(['YES', 'NO']);
export const FirstHalfWinnerSelection = z.enum(['HOME', 'DRAW', 'AWAY']);
export const FirstTeamToScoreSelection = z.enum(['HOME', 'AWAY', 'NO_GOAL']);
export const WinningMarginSelection = z.enum([
  'HOME_BY_1',
  'HOME_BY_2',
  'HOME_BY_3_PLUS',
  'DRAW',
  'AWAY_BY_1',
  'AWAY_BY_2',
  'AWAY_BY_3_PLUS',
]);
export const CleanSheetSelection = z.enum(['HOME', 'AWAY', 'BOTH', 'NONE']);
export const ExactGoalsSelection = z.enum(['0', '1', '2', '3', '4', '5_PLUS']);
/** Correct score as "H-A". Anything above 9 goals a side is out of market scope. */
export const CorrectScoreSelection = z
  .string()
  .regex(/^[0-9]-[0-9]$/, 'Correct score must look like "2-1"');

export const SELECTION_SCHEMAS: Record<MarketType, z.ZodTypeAny> = {
  MATCH_WINNER: MatchWinnerSelection,
  DOUBLE_CHANCE: DoubleChanceSelection,
  OVER_UNDER_25: OverUnder25Selection,
  BTTS: BttsSelection,
  FIRST_HALF_WINNER: FirstHalfWinnerSelection,
  FIRST_TEAM_TO_SCORE: FirstTeamToScoreSelection,
  WINNING_MARGIN: WinningMarginSelection,
  CLEAN_SHEET: CleanSheetSelection,
  EXACT_GOALS: ExactGoalsSelection,
  CORRECT_SCORE: CorrectScoreSelection,
};

export function isValidSelection(market: MarketType, selection: string): boolean {
  return SELECTION_SCHEMAS[market].safeParse(selection).success;
}
