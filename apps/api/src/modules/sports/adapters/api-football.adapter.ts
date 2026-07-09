import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import {
  SportsDataPort,
  type CanonicalFixture,
  type CanonicalHeadToHead,
  type CanonicalTeamForm,
} from '../ports/sports-data.port';

/**
 * API-Football (api-sports.io v3) adapter. All translation to canonical
 * shapes happens HERE — provider payloads never cross this boundary.
 * providerRef for fixtures/teams/leagues is the provider's numeric id
 * as a string.
 */
@Injectable()
export class ApiFootballAdapter extends SportsDataPort {
  readonly provider = 'API_FOOTBALL' as const;
  private readonly http: AxiosInstance;

  constructor(config: ConfigService) {
    super();
    this.http = axios.create({
      baseURL: 'https://v3.football.api-sports.io',
      headers: { 'x-apisports-key': config.get('API_FOOTBALL_KEY') ?? '' },
      timeout: 15_000,
    });
  }

  private static readonly STATUS_MAP: Record<string, CanonicalFixture['status']> = {
    NS: 'SCHEDULED',
    TBD: 'SCHEDULED',
    '1H': 'LIVE',
    HT: 'LIVE',
    '2H': 'LIVE',
    ET: 'LIVE',
    BT: 'LIVE',
    P: 'LIVE',
    LIVE: 'LIVE',
    FT: 'FINISHED',
    AET: 'FINISHED',
    PEN: 'FINISHED',
    PST: 'POSTPONED',
    CANC: 'CANCELLED',
    ABD: 'CANCELLED',
    AWD: 'FINISHED',
    WO: 'FINISHED',
  };

  async getFixturesByDate(date: Date): Promise<CanonicalFixture[]> {
    const { data } = await this.http.get('/fixtures', {
      params: { date: date.toISOString().slice(0, 10) },
    });
    return (data.response as ApiFixture[]).map((f) => this.toCanonical(f));
  }

  async getFixture(providerRef: string): Promise<CanonicalFixture | null> {
    const { data } = await this.http.get('/fixtures', { params: { id: providerRef } });
    const item = (data.response as ApiFixture[])[0];
    if (!item) return null;
    const fixture = this.toCanonical(item);

    // First scorer: derivable from a goalless/one-sided scoreline without
    // burning an events call; only a both-scored match needs the feed.
    if (fixture.status === 'FINISHED') {
      const home = fixture.homeGoals ?? 0;
      const away = fixture.awayGoals ?? 0;
      if (home + away === 0) {
        fixture.firstToScore = 'NONE';
      } else if (home > 0 && away === 0) {
        fixture.firstToScore = 'HOME';
      } else if (away > 0 && home === 0) {
        fixture.firstToScore = 'AWAY';
      } else {
        const events = await this.http.get('/fixtures/events', {
          params: { fixture: providerRef, type: 'Goal' },
        });
        const first = (events.data.response as { team: { id: number } }[])[0];
        // No feed data for a both-scored match → leave undefined; the
        // results poller then routes it to manual entry instead of guessing.
        fixture.firstToScore = first
          ? String(first.team.id) === fixture.homeTeam.providerRef
            ? 'HOME'
            : 'AWAY'
          : undefined;
      }
    }
    return fixture;
  }

  async getTeamForm(teamRef: string): Promise<CanonicalTeamForm | null> {
    const { data } = await this.http.get('/fixtures', {
      params: { team: teamRef, last: 5, status: 'FT' },
    });
    const games = data.response as ApiFixture[];
    if (games.length === 0) return null;

    let scored = 0;
    let conceded = 0;
    const last5 = games.map((g) => {
      const isHome = String(g.teams.home.id) === teamRef;
      const us = (isHome ? g.goals.home : g.goals.away) ?? 0;
      const them = (isHome ? g.goals.away : g.goals.home) ?? 0;
      scored += us;
      conceded += them;
      return us > them ? ('W' as const) : us < them ? ('L' as const) : ('D' as const);
    });

    return {
      teamRef,
      last5,
      goalsScoredLast5: scored,
      goalsConcededLast5: conceded,
      // League position/GD need a standings call scoped to a league+season;
      // injuries need a paid tier. Absent signals renormalize out cleanly.
    };
  }

  async getHeadToHead(homeRef: string, awayRef: string): Promise<CanonicalHeadToHead | null> {
    const { data } = await this.http.get('/fixtures/headtohead', {
      params: { h2h: `${homeRef}-${awayRef}`, last: 10, status: 'FT' },
    });
    const games = data.response as ApiFixture[];
    if (games.length === 0) return null;

    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    for (const g of games) {
      const h = g.goals.home ?? 0;
      const a = g.goals.away ?? 0;
      const homeSideRef = String(g.teams.home.id);
      if (h === a) draws += 1;
      else if ((h > a && homeSideRef === homeRef) || (a > h && homeSideRef !== homeRef)) homeWins += 1;
      else awayWins += 1;
    }
    return { homeWins, awayWins, draws, matches: games.length };
  }

  private toCanonical(f: ApiFixture): CanonicalFixture {
    return {
      providerRef: String(f.fixture.id),
      leagueRef: String(f.league.id),
      leagueName: f.league.name,
      leagueCountry: f.league.country,
      homeTeam: {
        providerRef: String(f.teams.home.id),
        name: f.teams.home.name,
        logoUrl: f.teams.home.logo,
      },
      awayTeam: {
        providerRef: String(f.teams.away.id),
        name: f.teams.away.name,
        logoUrl: f.teams.away.logo,
      },
      kickoffAt: new Date(f.fixture.date),
      status: ApiFootballAdapter.STATUS_MAP[f.fixture.status.short] ?? 'SCHEDULED',
      homeGoals: f.goals.home ?? undefined,
      awayGoals: f.goals.away ?? undefined,
      htHomeGoals: f.score.halftime.home ?? undefined,
      htAwayGoals: f.score.halftime.away ?? undefined,
    };
  }
}

interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string; country: string };
  teams: {
    home: { id: number; name: string; logo?: string };
    away: { id: number; name: string; logo?: string };
  };
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
}
