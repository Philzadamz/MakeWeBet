import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import {
  SportsDataPort,
  type CanonicalFixture,
  type CanonicalHeadToHead,
  type CanonicalTeamForm,
} from '../ports/sports-data.port';

/**
 * football-data.org (v4) adapter — the genuinely-free current-season
 * provider (top competitions: PL, CL, La Liga, Serie A, Bundesliga, …).
 *
 * Free-tier constraints shape this adapter:
 *  - 10 requests/minute: every call goes through a serializing throttle
 *    (min ~6.2s gap) with one retry on 429. Slow-but-steady is fine
 *    because difficulty computation runs in the background worker, not
 *    inline with admin requests.
 *  - No head-to-head-by-team-pair endpoint: derived from the home team's
 *    finished matches filtered against the opponent.
 *  - First scorer comes from the match detail's `goals` feed when present;
 *    when it isn't and both sides scored, we return `undefined` and the
 *    results poller refuses to auto-finalize (manual entry instead) —
 *    guessing would corrupt FIRST_TEAM_TO_SCORE scoring.
 */
@Injectable()
export class FootballDataAdapter extends SportsDataPort {
  readonly provider = 'FOOTBALL_DATA' as const;
  private readonly logger = new Logger(FootballDataAdapter.name);
  private readonly http: AxiosInstance;

  // Serializing throttle for the 10 req/min free tier.
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private static readonly MIN_GAP_MS = 6_200;

  // Team form/H2H barely change intra-day; cache to spare the quota.
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private static readonly CACHE_TTL_MS = 30 * 60_000;

  constructor(config: ConfigService) {
    super();
    this.http = axios.create({
      baseURL: 'https://api.football-data.org/v4',
      headers: { 'X-Auth-Token': config.get('FOOTBALL_DATA_KEY') ?? '' },
      timeout: 15_000,
    });
  }

  async getFixturesByDate(date: Date): Promise<CanonicalFixture[]> {
    const day = date.toISOString().slice(0, 10);
    // dateTo is EXCLUSIVE on this API (dateFrom=X&dateTo=X returns nothing,
    // verified against live) — query the half-open interval [day, day+1).
    const next = new Date(date.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const data = await this.request<{ matches: FdMatch[] }>(
      `/matches?dateFrom=${day}&dateTo=${next}`,
    );
    // Knockout fixtures can have TBD teams (null id/name) until the
    // qualifying round finishes — e.g. a World Cup final before the semis
    // are played. Skip them; the daily sweep picks them up once decided.
    return data.matches.filter(hasKnownTeams).map((m) => toCanonicalFixture(m));
  }

  async getFixture(providerRef: string): Promise<CanonicalFixture | null> {
    try {
      const match = await this.request<FdMatch>(`/matches/${encodeURIComponent(providerRef)}`);
      return toCanonicalFixture(match);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      throw err;
    }
  }

  async getTeamForm(teamRef: string): Promise<CanonicalTeamForm | null> {
    const matches = await this.cached(`form:${teamRef}`, () =>
      this.request<{ matches: FdMatch[] }>(
        `/teams/${encodeURIComponent(teamRef)}/matches?status=FINISHED&limit=5`,
      ),
    );
    if (matches.matches.length === 0) return null;
    return formFromMatches(teamRef, matches.matches);
  }

  async getHeadToHead(homeRef: string, awayRef: string): Promise<CanonicalHeadToHead | null> {
    // No team-pair H2H endpoint on this provider — filter the home team's
    // recent finished matches for meetings with the opponent.
    const history = await this.cached(`h2h-src:${homeRef}`, () =>
      this.request<{ matches: FdMatch[] }>(
        `/teams/${encodeURIComponent(homeRef)}/matches?status=FINISHED&limit=100`,
      ),
    );
    const meetings = history.matches
      .filter(
        (m) => String(m.homeTeam.id) === awayRef || String(m.awayTeam.id) === awayRef,
      )
      .slice(-10);
    if (meetings.length === 0) return null;
    return h2hFromMatches(homeRef, meetings);
  }

  // ------------------------------------------------------------ plumbing

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < FootballDataAdapter.CACHE_TTL_MS) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Serialize all requests with a minimum gap; retry once on 429. */
  private request<T>(path: string): Promise<T> {
    const run = async (): Promise<T> => {
      await this.gap();
      try {
        return (await this.http.get<T>(path)).data;
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 429) {
          this.logger.warn(`429 from football-data.org on ${path} — backing off 30s`);
          await new Promise((r) => setTimeout(r, 30_000));
          this.lastRequestAt = Date.now();
          return (await this.http.get<T>(path)).data;
        }
        throw err;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async gap(): Promise<void> {
    const wait = this.lastRequestAt + FootballDataAdapter.MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }
}

// ---------------------------------------------------------------- mapping
// Pure and exported for unit tests.

export interface FdMatch {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED|TIMED|IN_PLAY|PAUSED|FINISHED|POSTPONED|SUSPENDED|CANCELLED|AWARDED
  competition?: { id: number; name: string; code?: string };
  area?: { name?: string };
  /** id/name are null for TBD sides of undecided knockout ties. */
  homeTeam: { id: number | null; name: string | null; shortName?: string; tla?: string; crest?: string };
  awayTeam: { id: number | null; name: string | null; shortName?: string; tla?: string; crest?: string };
  score: {
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
  goals?: { minute: number | null; injuryTime?: number | null; team: { id: number } }[];
}

const STATUS_MAP: Record<string, CanonicalFixture['status']> = {
  SCHEDULED: 'SCHEDULED',
  TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE',
  PAUSED: 'LIVE',
  FINISHED: 'FINISHED',
  AWARDED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  SUSPENDED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
};

export function hasKnownTeams(m: FdMatch): boolean {
  return (
    m.homeTeam.id !== null &&
    m.homeTeam.name !== null &&
    m.awayTeam.id !== null &&
    m.awayTeam.name !== null
  );
}

/** Callers must filter with hasKnownTeams() first. */
export function toCanonicalFixture(m: FdMatch): CanonicalFixture {
  return {
    providerRef: String(m.id),
    leagueRef: String(m.competition?.id ?? 'unknown'),
    leagueName: m.competition?.name,
    leagueCountry: m.area?.name,
    homeTeam: {
      providerRef: String(m.homeTeam.id!),
      name: m.homeTeam.name!,
      shortName: m.homeTeam.tla ?? m.homeTeam.shortName,
      logoUrl: m.homeTeam.crest,
    },
    awayTeam: {
      providerRef: String(m.awayTeam.id!),
      name: m.awayTeam.name!,
      shortName: m.awayTeam.tla ?? m.awayTeam.shortName,
      logoUrl: m.awayTeam.crest,
    },
    kickoffAt: new Date(m.utcDate),
    status: STATUS_MAP[m.status] ?? 'SCHEDULED',
    homeGoals: m.score.fullTime.home ?? undefined,
    awayGoals: m.score.fullTime.away ?? undefined,
    htHomeGoals: m.score.halfTime.home ?? undefined,
    htAwayGoals: m.score.halfTime.away ?? undefined,
    firstToScore: deriveFirstToScore(m),
  };
}

/**
 * Determine who scored first, WITHOUT guessing:
 *  - goalless → NONE; only one side scored → that side (no feed needed)
 *  - both scored → first entry of the goals feed, if provided
 *  - both scored, no feed → undefined (caller must not auto-finalize)
 */
export function deriveFirstToScore(m: FdMatch): 'HOME' | 'AWAY' | 'NONE' | undefined {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  if (home === null || away === null) return undefined;
  if (home + away === 0) return 'NONE';
  if (home > 0 && away === 0) return 'HOME';
  if (away > 0 && home === 0) return 'AWAY';

  if (m.goals && m.goals.length > 0) {
    // ×100 keeps 45+12' ordered before 46' (injury time can exceed 10 min).
    const key = (g: { minute: number | null; injuryTime?: number | null }) =>
      (g.minute ?? 0) * 100 + (g.injuryTime ?? 0);
    const first = [...m.goals].sort((a, b) => key(a) - key(b))[0]!;
    return String(first.team.id) === String(m.homeTeam.id) ? 'HOME' : 'AWAY';
  }
  return undefined;
}

export function formFromMatches(teamRef: string, matches: FdMatch[]): CanonicalTeamForm {
  let scored = 0;
  let conceded = 0;
  const last5 = matches.slice(-5).map((m) => {
    const isHome = String(m.homeTeam.id) === teamRef;
    const us = (isHome ? m.score.fullTime.home : m.score.fullTime.away) ?? 0;
    const them = (isHome ? m.score.fullTime.away : m.score.fullTime.home) ?? 0;
    scored += us;
    conceded += them;
    return us > them ? ('W' as const) : us < them ? ('L' as const) : ('D' as const);
  });
  return { teamRef, last5, goalsScoredLast5: scored, goalsConcededLast5: conceded };
}

export function h2hFromMatches(homeRef: string, meetings: FdMatch[]): CanonicalHeadToHead {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (const m of meetings) {
    const h = m.score.fullTime.home ?? 0;
    const a = m.score.fullTime.away ?? 0;
    if (h === a) {
      draws += 1;
      continue;
    }
    const winnerRef = h > a ? String(m.homeTeam.id) : String(m.awayTeam.id);
    if (winnerRef === homeRef) homeWins += 1;
    else awayWins += 1;
  }
  return { homeWins, awayWins, draws, matches: meetings.length };
}
