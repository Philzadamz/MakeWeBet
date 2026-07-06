import type { ContestStatus, DifficultyTier } from '@fiq/contracts';

/** API response shapes for the contest surface (mirrors the NestJS DTOs). */

export interface ContestListItem {
  id: string;
  slug: string;
  title: string;
  status: ContestStatus;
  entryFeeMinor: string;
  currency: string;
  lockAt: string | null;
  maxEntries: number | null;
  entryCount: number;
  estimatedPrizePoolMinor: string;
}

export interface ContestTeam {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

export interface ContestMatchView {
  contestMatchId: string;
  order: number;
  fixture: {
    id: string;
    kickoffAt: string;
    status: string;
    homeTeam: ContestTeam;
    awayTeam: ContestTeam;
    league: { id: string; name: string; country: string };
    stars: number | null;
  };
}

export interface ContestSlotView {
  slotId: string;
  slotNo: number;
  tier: DifficultyTier;
  contestMatchId: string;
}

export interface ContestDetail extends ContestListItem {
  description: string | null;
  matches: ContestMatchView[];
  slots: ContestSlotView[];
}

export interface LeaderboardView {
  contest: { slug: string; title: string; status: ContestStatus };
  entries: {
    rank: number;
    username: string;
    avatarUrl: string | null;
    points: string;
    pointsX10: number;
    correctCount: number;
    prizeMinor: string | null;
  }[];
}
