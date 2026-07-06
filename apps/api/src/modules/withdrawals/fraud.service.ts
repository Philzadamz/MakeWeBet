import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Withdrawal risk scoring (0–100). Launch heuristics; the rules engine and
 * device-cluster analysis replace this incrementally. Scores ≥ 70 route the
 * withdrawal to UNDER_REVIEW instead of the normal approval queue.
 */
@Injectable()
export class FraudService {
  constructor(private readonly prisma: PrismaService) {}

  async scoreWithdrawal(userId: string, amountMinor: bigint): Promise<number> {
    let score = 0;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { createdAt: true, emailVerifiedAt: true },
    });

    // Young accounts are riskier.
    const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
    if (ageDays < 1) score += 35;
    else if (ageDays < 7) score += 20;

    if (!user.emailVerifiedAt) score += 20;

    // Velocity: many withdrawals in 24h.
    const recent = await this.prisma.withdrawal.count({
      where: { userId, requestedAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    score += Math.min(30, recent * 10);

    // Draining: withdrawing nearly everything ever deposited is a signal
    // when combined with the above (harmless alone).
    const wins = await this.prisma.entry.aggregate({
      where: { userId, prizeMinor: { gt: 0n } },
      _sum: { prizeMinor: true },
    });
    if ((wins._sum.prizeMinor ?? 0n) === 0n && amountMinor > 100_000n) score += 15;

    return Math.min(100, score);
  }
}
