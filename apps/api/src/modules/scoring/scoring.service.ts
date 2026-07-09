import { Injectable, Logger } from '@nestjs/common';
import { EventTopics } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { scorePrediction } from './engine/market-scorers';
import type { FinalResult } from './engine/types';

/**
 * Scores predictions when a fixture's result is finalized. Fully idempotent:
 * scoring recomputes from the stored result and rule set, so replaying the
 * event (at-least-once delivery) converges to the same state.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async onResultFinalized(fixtureId: string): Promise<void> {
    const fixture = await this.prisma.fixture.findUnique({ where: { id: fixtureId } });
    if (!fixture || !fixture.resultFinalizedAt) return;

    const result: FinalResult = {
      homeGoals: fixture.homeGoals ?? 0,
      awayGoals: fixture.awayGoals ?? 0,
      htHomeGoals: fixture.htHomeGoals ?? 0,
      htAwayGoals: fixture.htAwayGoals ?? 0,
      firstToScore: (fixture.firstToScore ?? 'NONE') as FinalResult['firstToScore'],
    };

    const contestMatches = await this.prisma.contestMatch.findMany({
      where: { fixtureId, contest: { status: { in: ['LOCKED', 'SCORING'] } } },
      select: { id: true, contestId: true },
    });

    for (const cm of contestMatches) {
      await this.scoreContestMatch(cm.contestId, cm.id, result);
      await this.finalizeContestIfComplete(cm.contestId);
    }
  }

  private async scoreContestMatch(
    contestId: string,
    contestMatchId: string,
    result: FinalResult,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Serialize scoring PER CONTEST (held until tx end). Without this,
        // two workers scoring different fixtures of the same contest race on
        // the entry-aggregate recompute below: each reads a snapshot that
        // can't see the other's uncommitted prediction updates, and the
        // later write erases the earlier fixture's points — contests
        // observably settled at 120.0 instead of 150.0 under concurrency.
        // Different contests still score in parallel.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contestId})::bigint)`;

        // First result flips the contest into SCORING (idempotent).
        await tx.contest.updateMany({
          where: { id: contestId, status: 'LOCKED' },
          data: { status: 'SCORING' },
        });

        const contest = await tx.contest.findUniqueOrThrow({
          where: { id: contestId },
          include: { ruleSet: { include: { marketRules: true } } },
        });
        const pointsByMarket = new Map(
          contest.ruleSet.marketRules.map((r) => [r.marketType, r.pointsX10]),
        );

        const predictions = await tx.prediction.findMany({
          where: { slot: { contestMatchId } },
          select: { id: true, marketType: true, selection: true },
        });

        // Statement count must not scale with entry count (a popular
        // contest = thousands of predictions per match; one UPDATE per row
        // blows straight past any transaction timeout). Correctness is a
        // pure function of (market, selection, result), so group identical
        // picks and write each group with a single updateMany — dozens of
        // statements at most, regardless of entries.
        const groups = new Map<string, { ids: string[]; isCorrect: boolean; pointsX10: number }>();
        for (const p of predictions) {
          const key = `${p.marketType}|${p.selection}`;
          let group = groups.get(key);
          if (!group) {
            const scored = scorePrediction(
              p.marketType,
              p.selection,
              result,
              pointsByMarket.get(p.marketType) ?? 0,
            );
            group = { ids: [], isCorrect: scored.isCorrect, pointsX10: scored.pointsX10 };
            groups.set(key, group);
          }
          group.ids.push(p.id);
        }
        const scoredAt = new Date();
        for (const group of groups.values()) {
          await tx.prediction.updateMany({
            where: { id: { in: group.ids } },
            data: { isCorrect: group.isCorrect, pointsX10: group.pointsX10, scoredAt },
          });
        }

        // Recompute every affected entry's aggregates from scratch in ONE
        // set-based statement — replay-safe by construction, O(1) round trips.
        await tx.$executeRaw`
          UPDATE entries e SET
            "totalPointsX10" = s.total,
            "correctCount"   = s.correct,
            "correctExpert"  = s.expert,
            "correctHard"    = s.hard
          FROM (
            SELECT
              p."entryId" AS entry_id,
              COALESCE(SUM(p."pointsX10"), 0)::int AS total,
              (COUNT(*) FILTER (WHERE p."isCorrect"))::int AS correct,
              (COUNT(*) FILTER (WHERE p."isCorrect" AND cs.tier = 'EXPERT'))::int AS expert,
              (COUNT(*) FILTER (WHERE p."isCorrect" AND cs.tier = 'HARD'))::int AS hard
            FROM predictions p
            JOIN contest_slots cs ON cs.id = p."slotId"
            WHERE p."scoredAt" IS NOT NULL
              AND cs."contestId" = ${contestId}::uuid
            GROUP BY p."entryId"
          ) s
          WHERE e.id = s.entry_id
        `;

        // Lets live leaderboards tick mid-scoring, one event per match scored.
        await this.outbox.emit(tx, EventTopics.PredictionScored, { contestId });

        this.logger.log(
          `scored ${predictions.length} predictions for contest ${contestId} match ${contestMatchId}`,
        );
      },
      // Generous ceiling: the statement count is bounded by pick-diversity,
      // not entries, but a huge contest still moves real data.
      { timeout: 60_000 },
    );
  }

  /**
   * When every fixture is final AND every prediction has actually been
   * scored → SCORED, emit contest.scored. Both checks matter: an admin (or
   * the results poller) can finalize several fixtures in quick succession,
   * and resultFinalizedAt is set synchronously per request while the
   * scoring worker processes each fixture's event asynchronously — so
   * "all fixtures have results" can be briefly true before "all
   * predictions are scored" is. Checking only the former let the contest
   * jump to SCORED (and settlement run) on partial points.
   */
  private async finalizeContestIfComplete(contestId: string): Promise<void> {
    const [pendingFixtures, pendingPredictions] = await Promise.all([
      this.prisma.contestMatch.count({
        where: { contestId, fixture: { resultFinalizedAt: null } },
      }),
      this.prisma.prediction.count({
        where: { entry: { contestId }, scoredAt: null },
      }),
    ]);
    if (pendingFixtures > 0 || pendingPredictions > 0) return;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contest.updateMany({
        where: { id: contestId, status: 'SCORING' },
        data: { status: 'SCORED', scoredAt: new Date() },
      });
      if (count === 1) {
        await this.outbox.emit(tx, EventTopics.ContestScored, { contestId });
        this.logger.log(`contest ${contestId} fully scored`);
      }
    });
  }
}
