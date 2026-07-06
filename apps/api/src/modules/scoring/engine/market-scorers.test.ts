import { describe, expect, it } from 'vitest';
import { MARKET_SCORERS, scorePrediction } from './market-scorers';
import type { FinalResult } from './types';

/** Chelsea 2-1 Arsenal, 1-0 at HT, home scored first. */
const r = (over: Partial<FinalResult> = {}): FinalResult => ({
  homeGoals: 2,
  awayGoals: 1,
  htHomeGoals: 1,
  htAwayGoals: 0,
  firstToScore: 'HOME',
  ...over,
});

describe('MATCH_WINNER', () => {
  it.each([
    ['HOME', r(), true],
    ['AWAY', r(), false],
    ['DRAW', r({ homeGoals: 1, awayGoals: 1 }), true],
  ])('%s → %s', (sel, result, expected) => {
    expect(MARKET_SCORERS.MATCH_WINNER(sel, result)).toBe(expected);
  });
});

describe('DOUBLE_CHANCE', () => {
  it('HOME_OR_DRAW wins on home win and on draw', () => {
    expect(MARKET_SCORERS.DOUBLE_CHANCE('HOME_OR_DRAW', r())).toBe(true);
    expect(MARKET_SCORERS.DOUBLE_CHANCE('HOME_OR_DRAW', r({ homeGoals: 0, awayGoals: 0 }))).toBe(
      true,
    );
    expect(MARKET_SCORERS.DOUBLE_CHANCE('HOME_OR_DRAW', r({ homeGoals: 0, awayGoals: 2 }))).toBe(
      false,
    );
  });
  it('HOME_OR_AWAY loses on draw', () => {
    expect(MARKET_SCORERS.DOUBLE_CHANCE('HOME_OR_AWAY', r({ homeGoals: 1, awayGoals: 1 }))).toBe(
      false,
    );
  });
});

describe('OVER_UNDER_25', () => {
  it('3 goals is OVER, 2 goals is UNDER', () => {
    expect(MARKET_SCORERS.OVER_UNDER_25('OVER', r())).toBe(true); // 2-1 = 3
    expect(MARKET_SCORERS.OVER_UNDER_25('UNDER', r({ homeGoals: 1 }))).toBe(true); // 1-1 = 2
    expect(MARKET_SCORERS.OVER_UNDER_25('UNDER', r())).toBe(false);
  });
});

describe('BTTS', () => {
  it('both scored', () => {
    expect(MARKET_SCORERS.BTTS('YES', r())).toBe(true);
    expect(MARKET_SCORERS.BTTS('NO', r({ awayGoals: 0 }))).toBe(true);
  });
});

describe('FIRST_HALF_WINNER', () => {
  it('uses half-time score only', () => {
    expect(MARKET_SCORERS.FIRST_HALF_WINNER('HOME', r())).toBe(true);
    expect(
      MARKET_SCORERS.FIRST_HALF_WINNER('DRAW', r({ htHomeGoals: 0, htAwayGoals: 0 })),
    ).toBe(true);
  });
});

describe('FIRST_TEAM_TO_SCORE', () => {
  it('maps NO_GOAL to goalless', () => {
    expect(MARKET_SCORERS.FIRST_TEAM_TO_SCORE('HOME', r())).toBe(true);
    expect(
      MARKET_SCORERS.FIRST_TEAM_TO_SCORE(
        'NO_GOAL',
        r({ homeGoals: 0, awayGoals: 0, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'NONE' }),
      ),
    ).toBe(true);
  });
});

describe('WINNING_MARGIN', () => {
  it.each([
    ['HOME_BY_1', r(), true],
    ['HOME_BY_2', r({ homeGoals: 3 }), true],
    ['HOME_BY_3_PLUS', r({ homeGoals: 5 }), true], // 5-1
    ['AWAY_BY_3_PLUS', r({ homeGoals: 0, awayGoals: 4 }), true],
    ['DRAW', r({ homeGoals: 2, awayGoals: 2 }), true],
    ['HOME_BY_2', r(), false],
  ])('%s', (sel, result, expected) => {
    expect(MARKET_SCORERS.WINNING_MARGIN(sel, result)).toBe(expected);
  });
});

describe('CLEAN_SHEET', () => {
  it.each([
    ['HOME', r({ awayGoals: 0 }), true],
    ['AWAY', r({ homeGoals: 0, awayGoals: 2 }), true],
    ['BOTH', r({ homeGoals: 0, awayGoals: 0 }), true],
    ['NONE', r(), true], // 2-1: both conceded
    ['HOME', r(), false],
  ])('%s', (sel, result, expected) => {
    expect(MARKET_SCORERS.CLEAN_SHEET(sel, result)).toBe(expected);
  });
});

describe('EXACT_GOALS', () => {
  it('bands 5+ together', () => {
    expect(MARKET_SCORERS.EXACT_GOALS('3', r())).toBe(true);
    expect(MARKET_SCORERS.EXACT_GOALS('5_PLUS', r({ homeGoals: 4, awayGoals: 3 }))).toBe(true);
    expect(MARKET_SCORERS.EXACT_GOALS('5_PLUS', r())).toBe(false);
  });
});

describe('CORRECT_SCORE', () => {
  it('exact string match on H-A', () => {
    expect(MARKET_SCORERS.CORRECT_SCORE('2-1', r())).toBe(true);
    expect(MARKET_SCORERS.CORRECT_SCORE('1-2', r())).toBe(false);
  });
});

describe('scorePrediction points', () => {
  it('awards full rule points when correct, zero when wrong (Expert = 325 X10)', () => {
    expect(scorePrediction('CORRECT_SCORE', '2-1', r(), 325)).toEqual({
      isCorrect: true,
      pointsX10: 325,
    });
    expect(scorePrediction('CORRECT_SCORE', '0-0', r(), 325)).toEqual({
      isCorrect: false,
      pointsX10: 0,
    });
  });
});
