import type { DifficultyTier, MarketType } from '@fiq/contracts';

/** Display metadata for markets & tiers — labels only, no rules. */

export const TIER_META: Record<DifficultyTier, { label: string; points: string; className: string }> = {
  EASY: { label: 'Easy', points: '5', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  MEDIUM: { label: 'Medium', points: '10', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  HARD: { label: 'Hard', points: '15', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  EXPERT: { label: 'Expert', points: '32.5', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
};

export const MARKET_LABEL: Record<MarketType, string> = {
  MATCH_WINNER: 'Match Winner',
  DOUBLE_CHANCE: 'Double Chance',
  OVER_UNDER_25: 'Over/Under 2.5',
  BTTS: 'Both Teams To Score',
  FIRST_HALF_WINNER: 'First Half Winner',
  FIRST_TEAM_TO_SCORE: 'First Team To Score',
  WINNING_MARGIN: 'Winning Margin',
  CLEAN_SHEET: 'Clean Sheet',
  EXACT_GOALS: 'Exact Total Goals',
  CORRECT_SCORE: 'Correct Score',
};

export interface SelectionOption {
  value: string;
  label: (home: string, away: string) => string;
}

const t = (s: string) => () => s;

export const SELECTION_OPTIONS: Record<Exclude<MarketType, 'CORRECT_SCORE'>, SelectionOption[]> = {
  MATCH_WINNER: [
    { value: 'HOME', label: (h) => h },
    { value: 'DRAW', label: t('Draw') },
    { value: 'AWAY', label: (_, a) => a },
  ],
  DOUBLE_CHANCE: [
    { value: 'HOME_OR_DRAW', label: (h) => `${h} or Draw` },
    { value: 'AWAY_OR_DRAW', label: (_, a) => `${a} or Draw` },
    { value: 'HOME_OR_AWAY', label: (h, a) => `${h} or ${a}` },
  ],
  OVER_UNDER_25: [
    { value: 'OVER', label: t('Over 2.5 goals') },
    { value: 'UNDER', label: t('Under 2.5 goals') },
  ],
  BTTS: [
    { value: 'YES', label: t('Yes') },
    { value: 'NO', label: t('No') },
  ],
  FIRST_HALF_WINNER: [
    { value: 'HOME', label: (h) => h },
    { value: 'DRAW', label: t('Draw') },
    { value: 'AWAY', label: (_, a) => a },
  ],
  FIRST_TEAM_TO_SCORE: [
    { value: 'HOME', label: (h) => h },
    { value: 'AWAY', label: (_, a) => a },
    { value: 'NO_GOAL', label: t('No goals') },
  ],
  WINNING_MARGIN: [
    { value: 'HOME_BY_1', label: (h) => `${h} by 1` },
    { value: 'HOME_BY_2', label: (h) => `${h} by 2` },
    { value: 'HOME_BY_3_PLUS', label: (h) => `${h} by 3+` },
    { value: 'DRAW', label: t('Draw') },
    { value: 'AWAY_BY_1', label: (_, a) => `${a} by 1` },
    { value: 'AWAY_BY_2', label: (_, a) => `${a} by 2` },
    { value: 'AWAY_BY_3_PLUS', label: (_, a) => `${a} by 3+` },
  ],
  CLEAN_SHEET: [
    { value: 'HOME', label: (h) => `${h} only` },
    { value: 'AWAY', label: (_, a) => `${a} only` },
    { value: 'BOTH', label: t('Both (0-0)') },
    { value: 'NONE', label: t('Neither') },
  ],
  EXACT_GOALS: [
    { value: '0', label: t('0') },
    { value: '1', label: t('1') },
    { value: '2', label: t('2') },
    { value: '3', label: t('3') },
    { value: '4', label: t('4') },
    { value: '5_PLUS', label: t('5+') },
  ],
};

/** Quick-pick grid for Correct Score (custom input also allowed). */
export const CORRECT_SCORE_GRID = ['1-0', '2-0', '2-1', '3-1', '0-0', '1-1', '2-2', '0-1', '0-2', '1-2', '1-3', '3-0'];
