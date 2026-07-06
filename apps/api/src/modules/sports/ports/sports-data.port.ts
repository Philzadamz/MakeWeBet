import type { SportsProvider } from '@prisma/client';

/**
 * SportsDataPort — anti-corruption boundary. Adapters translate provider
 * payloads into these canonical shapes at the edge; provider IDs never
 * leak past the *_provider_refs mapping tables.
 */

export interface CanonicalTeam {
  providerRef: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface CanonicalFixture {
  providerRef: string;
  leagueRef: string;
  homeTeam: CanonicalTeam;
  awayTeam: CanonicalTeam;
  kickoffAt: Date;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  homeGoals?: number;
  awayGoals?: number;
  htHomeGoals?: number;
  htAwayGoals?: number;
  firstToScore?: 'HOME' | 'AWAY' | 'NONE';
}

/** Inputs to the Difficulty Heatmap engine. All optional — the engine
 *  renormalizes weights over the signals a provider can actually supply. */
export interface CanonicalTeamForm {
  teamRef: string;
  last5: ('W' | 'D' | 'L')[];
  leaguePosition?: number;
  goalDifference?: number;
  goalsScoredLast5?: number;
  goalsConcededLast5?: number;
  injuriesCount?: number;
  suspensionsCount?: number;
}

export interface CanonicalHeadToHead {
  homeWins: number;
  awayWins: number;
  draws: number;
  matches: number;
}

export abstract class SportsDataPort {
  abstract readonly provider: SportsProvider;
  abstract getFixturesByDate(date: Date): Promise<CanonicalFixture[]>;
  abstract getFixture(providerRef: string): Promise<CanonicalFixture | null>;
  abstract getTeamForm(teamRef: string): Promise<CanonicalTeamForm | null>;
  abstract getHeadToHead(homeRef: string, awayRef: string): Promise<CanonicalHeadToHead | null>;
}
