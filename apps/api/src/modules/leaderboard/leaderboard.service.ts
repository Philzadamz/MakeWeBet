import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { formatPoints } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { rankEntries } from '../settlement/ranking';

const CACHE_TTL_SEC = 5;

/**
 * Leaderboard read model. Postgres is the source of truth; Redis serves the
 * match-day read burst with a short-TTL cache keyed per contest. Settled
 * contests serve stored finalRank (immutable), live ones rank on the fly
 * with the same comparator settlement uses — the orders can never diverge.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async forContest(slug: string) {
    const cacheKey = `lb:${slug}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown;

    const contest = await this.prisma.contest.findUnique({
      where: { slug, deletedAt: null },
      select: { id: true, status: true, title: true },
    });
    if (!contest || contest.status === 'DRAFT') {
      throw new NotFoundException({ code: 'CONTEST_NOT_FOUND' });
    }

    const entries = await this.prisma.entry.findMany({
      where: { contestId: contest.id, status: { in: ['ACTIVE', 'SETTLED'] } },
      include: { user: { select: { username: true, avatarUrl: true } } },
    });

    const settled = contest.status === 'SETTLED';
    const ordered = settled
      ? [...entries].sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0))
      : rankEntries(
          contest.id,
          entries.map((e) => ({
            entryId: e.id,
            totalPointsX10: e.totalPointsX10,
            correctExpert: e.correctExpert,
            correctHard: e.correctHard,
            submittedAt: e.submittedAt,
          })),
        ).map((r) => entries.find((e) => e.id === r.entryId)!);

    const payload = {
      contest: { slug, title: contest.title, status: contest.status },
      entries: ordered.map((e, i) => ({
        rank: settled ? e.finalRank : i + 1,
        username: e.user.username,
        avatarUrl: e.user.avatarUrl,
        points: formatPoints(e.totalPointsX10),
        pointsX10: e.totalPointsX10,
        correctCount: e.correctCount,
        prizeMinor: settled ? e.prizeMinor.toString() : null,
      })),
    };

    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SEC);
    return payload;
  }
}
