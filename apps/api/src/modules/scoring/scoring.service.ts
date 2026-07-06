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
    await this.prisma.$transaction(async (tx) => {
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
        include: { slot: { select: { tier: true } } },
      });

      const affectedEntries = new Set<string>();
      for (const p of predictions) {
        const scored = scorePrediction(
          p.marketType,
          p.selection,
          result,
          pointsByMarket.get(p.marketType) ?? 0,
        );
        await tx.prediction.update({
          where: { id: p.id },
          data: { isCorrect: scored.isCorrect, pointsX10: scored.pointsX10, scoredAt: new Date() },
        });
        affectedEntries.add(p.entryId);
      }

      // Recompute aggregates from scratch — replay-safe by construction.
      for (const entryId of affectedEntries) {
        const scoredPredictions = await tx.prediction.findMany({
          where: { entryId, scoredAt: { not: null } },
          include: { slot: { select: { tier: true } } },
        });
        await tx.entry.update({
          where: { id: entryId },
          data: {
            totalPointsX10: scoredPredictions.reduce((s, p) => s + p.pointsX10, 0),
            correctCount: scoredPredictions.filter((p) => p.isCorrect).length,
            correctExpert: scoredPredictions.filter((p) => p.isCorrect && p.slot.tier === 'EXPERT')
              .length,
            correctHard: scoredPredictions.filter((p) => p.isCorrect && p.slot.tier === 'HARD')
              .length,
          },
        });
      }

      // Lets live leaderboards tick mid-scoring, one event per match scored.
      await this.outbox.emit(tx, EventTopics.PredictionScored, { contestId });

      this.logger.log(
        `scored ${predictions.length} predictions for contest ${contestId} match ${contestMatchId}`,
      );
    });
  }

  /** When every fixture in the contest is final → SCORED, emit contest.scored. */
  private async finalizeContestIfComplete(contestId: string): Promise<void> {
    const pending = await this.prisma.contestMatch.count({
      where: { contestId, fixture: { resultFinalizedAt: null } },
    });
    if (pending > 0) return;

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
