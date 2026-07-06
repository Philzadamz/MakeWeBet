/**
 * Difficulty Heatmap engine — pure computation, no I/O.
 *
 * Each signal expresses UNPREDICTABILITY in 0..1 (1 = coin flip, 0 = walkover).
 * The engine takes whatever signals the provider could supply, renormalizes
 * the admin-tunable weights over the signals that are present, and maps the
 * weighted sum to 1–5 stars. Weight sets are versioned in the database
 * (DifficultyWeightSet); admins tune them without code changes.
 */

export interface TeamFormInput {
  last5: ('W' | 'D' | 'L')[];
  leaguePosition?: number;
  goalDifference?: number;
  goalsScoredLast5?: number;
  goalsConcededLast5?: number;
  injuriesCount?: number;
  suspensionsCount?: number;
}

export interface DifficultyInput {
  home?: TeamFormInput;
  away?: TeamFormInput;
  headToHead?: { homeWins: number; awayWins: number; draws: number; matches: number };
  /** Home side's historical home win rate 0..1, if known. */
  homeWinRate?: number;
  tableSize?: number;
}

export type SignalName =
  | 'form'
  | 'homeAdvantage'
  | 'leaguePosition'
  | 'goalDifference'
  | 'headToHead'
  | 'recentGoals'
  | 'defensiveRecord'
  | 'injuries'
  | 'suspensions'
  | 'historical';

export type Weights = Partial<Record<SignalName, number>>;
export type Signals = Partial<Record<SignalName, number>>;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const formPoints = (last5: ('W' | 'D' | 'L')[]): number =>
  last5.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);

/** Extract every signal the input allows; absent data → absent signal. */
export function computeSignals(input: DifficultyInput): Signals {
  const signals: Signals = {};
  const { home, away, headToHead: h2h } = input;

  if (home && away && home.last5.length > 0 && away.last5.length > 0) {
    // Evenly-matched recent form is the essence of unpredictability.
    const diff = Math.abs(formPoints(home.last5) - formPoints(away.last5));
    signals.form = clamp01(1 - diff / 15);
  }

  if (input.homeWinRate !== undefined) {
    // A 50% home win rate says nothing; extremes say a lot.
    signals.homeAdvantage = clamp01(1 - Math.abs(input.homeWinRate - 0.5) * 2);
  }

  if (home?.leaguePosition !== undefined && away?.leaguePosition !== undefined) {
    const span = Math.max(2, (input.tableSize ?? 20) - 1);
    signals.leaguePosition = clamp01(
      1 - Math.abs(home.leaguePosition - away.leaguePosition) / span,
    );
  }

  if (home?.goalDifference !== undefined && away?.goalDifference !== undefined) {
    signals.goalDifference = clamp01(
      1 - Math.abs(home.goalDifference - away.goalDifference) / 30,
    );
  }

  if (h2h && h2h.matches > 0) {
    const dominance = Math.abs(h2h.homeWins - h2h.awayWins) / h2h.matches;
    signals.headToHead = clamp01(1 - dominance);
  }

  if (home?.goalsScoredLast5 !== undefined && away?.goalsScoredLast5 !== undefined) {
    signals.recentGoals = clamp01(
      1 - Math.abs(home.goalsScoredLast5 - away.goalsScoredLast5) / 10,
    );
  }

  if (home?.goalsConcededLast5 !== undefined && away?.goalsConcededLast5 !== undefined) {
    signals.defensiveRecord = clamp01(
      1 - Math.abs(home.goalsConcededLast5 - away.goalsConcededLast5) / 10,
    );
  }

  if (home?.injuriesCount !== undefined && away?.injuriesCount !== undefined) {
    // Missing players inject noise regardless of which side is missing them.
    signals.injuries = clamp01((home.injuriesCount + away.injuriesCount) / 10);
  }

  if (home?.suspensionsCount !== undefined && away?.suspensionsCount !== undefined) {
    signals.suspensions = clamp01((home.suspensionsCount + away.suspensionsCount) / 6);
  }

  return signals;
}

/** Weighted score over PRESENT signals, weights renormalized to sum 1. */
export function weightedScore(signals: Signals, weights: Weights): number {
  const present = (Object.keys(signals) as SignalName[]).filter(
    (k) => signals[k] !== undefined && (weights[k] ?? 0) > 0,
  );
  const weightSum = present.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (weightSum === 0) return 0.5; // nothing to go on → neutral 3 stars
  return present.reduce((s, k) => s + signals[k]! * (weights[k]! / weightSum), 0);
}

/** 0..1 → 1..5 stars. */
export function scoreToStars(score: number): number {
  if (score < 0.2) return 1;
  if (score < 0.4) return 2;
  if (score < 0.6) return 3;
  if (score < 0.8) return 4;
  return 5;
}

export function computeStars(
  input: DifficultyInput,
  weights: Weights,
): { stars: number; score: number; signals: Signals } {
  const signals = computeSignals(input);
  const score = weightedScore(signals, weights);
  return { stars: scoreToStars(score), score, signals };
}
