import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatPoints } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Football IQ projections. Rebuilt from source tables (entries + scored
 * predictions) rather than incremented, so replaying `prizes.distributed`
 * events — or a full rebuild after a bug — always converges to truth.
 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recomputeForContest(contestId: string): Promise<void> {
    const entries = await this.prisma.entry.findMany({
      where: { contestId },
      select: { userId: true },
    });
    for (const userId of new Set(entries.map((e) => e.userId))) {
      await this.recomputeForUser(userId);
    }
    this.logger.log(`stats recomputed for ${entries.length} users (contest ${contestId})`);
  }

  async recomputeForUser(userId: string): Promise<void> {
    const entries = await this.prisma.entry.findMany({
      where: { userId, status: 'SETTLED' },
      orderBy: { submittedAt: 'asc' },
      select: {
        totalPointsX10: true,
        finalRank: true,
        prizeMinor: true,
      },
    });

    const predictions = await this.prisma.prediction.findMany({
      where: { entry: { userId }, scoredAt: { not: null } },
      select: {
        marketType: true,
        isCorrect: true,
        pointsX10: true,
        scoredAt: true,
        slot: {
          select: {
            contestMatch: { select: { fixture: { select: { leagueId: true } } } },
          },
        },
      },
    });

    const marketBreakdown: Record<string, { total: number; correct: number }> = {};
    const leagueBreakdown: Record<string, { total: number; correct: number }> = {};
    const monthlyBreakdown: Record<string, { total: number; correct: number; pointsX10: number }> =
      {};
    for (const p of predictions) {
      const market = (marketBreakdown[p.marketType] ??= { total: 0, correct: 0 });
      market.total += 1;
      if (p.isCorrect) market.correct += 1;

      const leagueId = p.slot.contestMatch.fixture.leagueId;
      const league = (leagueBreakdown[leagueId] ??= { total: 0, correct: 0 });
      league.total += 1;
      if (p.isCorrect) league.correct += 1;

      const month = p.scoredAt!.toISOString().slice(0, 7); // YYYY-MM
      const monthly = (monthlyBreakdown[month] ??= { total: 0, correct: 0, pointsX10: 0 });
      monthly.total += 1;
      if (p.isCorrect) monthly.correct += 1;
      monthly.pointsX10 += p.pointsX10;
    }

    // Winning streak over settled contests in chronological order.
    let currentStreak = 0;
    let bestStreak = 0;
    for (const e of entries) {
      currentStreak = e.prizeMinor > 0n ? currentStreak + 1 : 0;
      bestStreak = Math.max(bestStreak, currentStreak);
    }

    const data = {
      contestsPlayed: entries.length,
      contestsWon: entries.filter((e) => e.finalRank === 1).length,
      predictionsTotal: predictions.length,
      predictionsCorrect: predictions.filter((p) => p.isCorrect).length,
      totalPointsX10: BigInt(entries.reduce((s, e) => s + e.totalPointsX10, 0)),
      highestScoreX10: entries.reduce((m, e) => Math.max(m, e.totalPointsX10), 0),
      totalWinningsMinor: entries.reduce((s, e) => s + e.prizeMinor, 0n),
      currentStreak,
      bestStreak,
      marketBreakdown: marketBreakdown as unknown as Prisma.InputJsonValue,
      leagueBreakdown: leagueBreakdown as unknown as Prisma.InputJsonValue,
      monthlyBreakdown: monthlyBreakdown as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.userStats.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  /** Football IQ profile — the user-facing shape. */
  async profile(userId: string) {
    const stats = await this.prisma.userStats.findUnique({ where: { userId } });
    if (!stats) {
      return {
        contestsPlayed: 0,
        contestsWon: 0,
        accuracyPct: null,
        highestScore: '0',
        totalWinningsMinor: '0',
        currentStreak: 0,
        bestStreak: 0,
        bestMarket: null,
        worstMarket: null,
        markets: {},
        monthly: {},
      };
    }

    const markets = stats.marketBreakdown as Record<string, { total: number; correct: number }>;
    const rated = Object.entries(markets)
      .filter(([, v]) => v.total >= 3) // small samples say nothing
      .map(([market, v]) => ({ market, accuracy: v.correct / v.total }));
    rated.sort((a, b) => b.accuracy - a.accuracy);

    return {
      contestsPlayed: stats.contestsPlayed,
      contestsWon: stats.contestsWon,
      accuracyPct:
        stats.predictionsTotal > 0
          ? Math.round((stats.predictionsCorrect / stats.predictionsTotal) * 100)
          : null,
      highestScore: formatPoints(stats.highestScoreX10),
      totalWinningsMinor: stats.totalWinningsMinor.toString(),
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      bestMarket: rated[0]?.market ?? null,
      worstMarket: rated.length > 1 ? rated[rated.length - 1]!.market : null,
      markets,
      monthly: stats.monthlyBreakdown,
    };
  }
}
