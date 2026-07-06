/**
 * Canonical domain enums. The Prisma schema mirrors these exactly;
 * a drift test in the API guards the mirror.
 */

export const DifficultyTier = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
  EXPERT: 'EXPERT',
} as const;
export type DifficultyTier = (typeof DifficultyTier)[keyof typeof DifficultyTier];

export const MarketType = {
  // Easy
  MATCH_WINNER: 'MATCH_WINNER',
  DOUBLE_CHANCE: 'DOUBLE_CHANCE',
  // Medium
  OVER_UNDER_25: 'OVER_UNDER_25',
  BTTS: 'BTTS',
  FIRST_HALF_WINNER: 'FIRST_HALF_WINNER',
  FIRST_TEAM_TO_SCORE: 'FIRST_TEAM_TO_SCORE',
  // Hard
  WINNING_MARGIN: 'WINNING_MARGIN',
  CLEAN_SHEET: 'CLEAN_SHEET',
  EXACT_GOALS: 'EXACT_GOALS',
  // Expert
  CORRECT_SCORE: 'CORRECT_SCORE',
} as const;
export type MarketType = (typeof MarketType)[keyof typeof MarketType];

export const ContestStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  LOCKED: 'LOCKED',
  SCORING: 'SCORING',
  SCORED: 'SCORED',
  SETTLED: 'SETTLED',
  ARCHIVED: 'ARCHIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContestStatus = (typeof ContestStatus)[keyof typeof ContestStatus];

export const UserRole = {
  USER: 'USER',
  SUPPORT: 'SUPPORT',
  CONTEST_ADMIN: 'CONTEST_ADMIN',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const RiskProfile = {
  SAFE: 'SAFE',
  BALANCED: 'BALANCED',
  AGGRESSIVE: 'AGGRESSIVE',
} as const;
export type RiskProfile = (typeof RiskProfile)[keyof typeof RiskProfile];

/** Which side scored first in a match (NONE = goalless). */
export const FirstToScore = {
  HOME: 'HOME',
  AWAY: 'AWAY',
  NONE: 'NONE',
} as const;
export type FirstToScore = (typeof FirstToScore)[keyof typeof FirstToScore];

export const MARKET_TIER: Record<MarketType, DifficultyTier> = {
  MATCH_WINNER: 'EASY',
  DOUBLE_CHANCE: 'EASY',
  OVER_UNDER_25: 'MEDIUM',
  BTTS: 'MEDIUM',
  FIRST_HALF_WINNER: 'MEDIUM',
  FIRST_TEAM_TO_SCORE: 'MEDIUM',
  WINNING_MARGIN: 'HARD',
  CLEAN_SHEET: 'HARD',
  EXACT_GOALS: 'HARD',
  CORRECT_SCORE: 'EXPERT',
};

export const MARKETS_BY_TIER: Record<DifficultyTier, MarketType[]> = {
  EASY: ['MATCH_WINNER', 'DOUBLE_CHANCE'],
  MEDIUM: ['OVER_UNDER_25', 'BTTS', 'FIRST_HALF_WINNER', 'FIRST_TEAM_TO_SCORE'],
  HARD: ['WINNING_MARGIN', 'CLEAN_SHEET', 'EXACT_GOALS'],
  EXPERT: ['CORRECT_SCORE'],
};
