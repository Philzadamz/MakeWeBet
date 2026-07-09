import { describe, expect, it } from 'vitest';
import {
  deriveFirstToScore,
  formFromMatches,
  h2hFromMatches,
  toCanonicalFixture,
  type FdMatch,
} from './football-data.adapter';

/** Shaped like real football-data.org v4 payloads. */
const match = (over: Partial<FdMatch> = {}): FdMatch => ({
  id: 497_555,
  utcDate: '2026-08-15T14:00:00Z',
  status: 'FINISHED',
  competition: { id: 2021, name: 'Premier League', code: 'PL' },
  area: { name: 'England' },
  homeTeam: { id: 57, name: 'Arsenal FC', tla: 'ARS', crest: 'https://crests.example/57.png' },
  awayTeam: { id: 61, name: 'Chelsea FC', tla: 'CHE', crest: 'https://crests.example/61.png' },
  score: { fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 } },
  goals: [
    { minute: 23, team: { id: 57 } },
    { minute: 55, team: { id: 61 } },
    { minute: 78, team: { id: 57 } },
  ],
  ...over,
});

describe('toCanonicalFixture', () => {
  it('maps ids, names, league metadata and scores', () => {
    const canonical = toCanonicalFixture(match());
    expect(canonical.providerRef).toBe('497555');
    expect(canonical.leagueRef).toBe('2021');
    expect(canonical.leagueName).toBe('Premier League');
    expect(canonical.leagueCountry).toBe('England');
    expect(canonical.homeTeam).toEqual({
      providerRef: '57',
      name: 'Arsenal FC',
      shortName: 'ARS',
      logoUrl: 'https://crests.example/57.png',
    });
    expect(canonical.homeGoals).toBe(2);
    expect(canonical.htAwayGoals).toBe(0);
    expect(canonical.kickoffAt.toISOString()).toBe('2026-08-15T14:00:00.000Z');
  });

  it.each([
    ['TIMED', 'SCHEDULED'],
    ['IN_PLAY', 'LIVE'],
    ['PAUSED', 'LIVE'],
    ['FINISHED', 'FINISHED'],
    ['AWARDED', 'FINISHED'],
    ['POSTPONED', 'POSTPONED'],
    ['SUSPENDED', 'POSTPONED'],
    ['CANCELLED', 'CANCELLED'],
  ])('maps status %s → %s', (fd, canonical) => {
    expect(toCanonicalFixture(match({ status: fd })).status).toBe(canonical);
  });

  it('leaves scores undefined for an unplayed match', () => {
    const canonical = toCanonicalFixture(
      match({
        status: 'TIMED',
        score: { fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
        goals: undefined,
      }),
    );
    expect(canonical.homeGoals).toBeUndefined();
    expect(canonical.firstToScore).toBeUndefined();
  });
});

describe('deriveFirstToScore', () => {
  it('goalless → NONE, no feed needed', () => {
    expect(
      deriveFirstToScore(
        match({
          score: { fullTime: { home: 0, away: 0 }, halfTime: { home: 0, away: 0 } },
          goals: undefined,
        }),
      ),
    ).toBe('NONE');
  });

  it('one-sided scoreline is derivable without the goals feed', () => {
    expect(
      deriveFirstToScore(
        match({
          score: { fullTime: { home: 3, away: 0 }, halfTime: { home: 1, away: 0 } },
          goals: undefined,
        }),
      ),
    ).toBe('HOME');
    expect(
      deriveFirstToScore(
        match({
          score: { fullTime: { home: 0, away: 2 }, halfTime: { home: 0, away: 0 } },
          goals: undefined,
        }),
      ),
    ).toBe('AWAY');
  });

  it('both scored → earliest goal in the feed decides', () => {
    expect(deriveFirstToScore(match())).toBe('HOME'); // 23' Arsenal
    expect(
      deriveFirstToScore(
        match({
          goals: [
            { minute: 40, team: { id: 57 } },
            { minute: 12, team: { id: 61 } }, // unsorted on purpose
          ],
        }),
      ),
    ).toBe('AWAY');
  });

  it('orders injury-time goals after regular goals in the same minute', () => {
    expect(
      deriveFirstToScore(
        match({
          goals: [
            { minute: 45, injuryTime: 3, team: { id: 61 } },
            { minute: 45, team: { id: 57 } },
          ],
        }),
      ),
    ).toBe('HOME');
  });

  it('REFUSES TO GUESS: both scored + no feed → undefined (manual entry)', () => {
    expect(deriveFirstToScore(match({ goals: undefined }))).toBeUndefined();
    expect(deriveFirstToScore(match({ goals: [] }))).toBeUndefined();
  });
});

describe('formFromMatches', () => {
  it('computes W/D/L and goal tallies from the team perspective', () => {
    const teamRef = '57';
    const matches: FdMatch[] = [
      match({ score: { fullTime: { home: 2, away: 1 }, halfTime: { home: 0, away: 0 } } }), // home W
      match({
        homeTeam: { id: 61, name: 'Chelsea FC' },
        awayTeam: { id: 57, name: 'Arsenal FC' },
        score: { fullTime: { home: 3, away: 1 }, halfTime: { home: 1, away: 1 } }, // away L
      }),
      match({ score: { fullTime: { home: 1, away: 1 }, halfTime: { home: 0, away: 1 } } }), // home D
    ];
    const form = formFromMatches(teamRef, matches);
    expect(form.last5).toEqual(['W', 'L', 'D']);
    expect(form.goalsScoredLast5).toBe(2 + 1 + 1);
    expect(form.goalsConcededLast5).toBe(1 + 3 + 1);
  });
});

describe('h2hFromMatches', () => {
  it('attributes wins by team ref regardless of venue', () => {
    const arsenal = '57';
    const meetings: FdMatch[] = [
      match({ score: { fullTime: { home: 2, away: 0 }, halfTime: { home: 1, away: 0 } } }), // Arsenal home win
      match({
        homeTeam: { id: 61, name: 'Chelsea FC' },
        awayTeam: { id: 57, name: 'Arsenal FC' },
        score: { fullTime: { home: 0, away: 1 }, halfTime: { home: 0, away: 0 } }, // Arsenal away win
      }),
      match({ score: { fullTime: { home: 1, away: 1 }, halfTime: { home: 1, away: 1 } } }), // draw
      match({
        homeTeam: { id: 61, name: 'Chelsea FC' },
        awayTeam: { id: 57, name: 'Arsenal FC' },
        score: { fullTime: { home: 2, away: 0 }, halfTime: { home: 2, away: 0 } }, // Chelsea win
      }),
    ];
    expect(h2hFromMatches(arsenal, meetings)).toEqual({
      homeWins: 2,
      awayWins: 1,
      draws: 1,
      matches: 4,
    });
  });
});
