import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin/reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CONTEST_ADMIN', 'FINANCE_ADMIN', 'SUPPORT')
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform KPIs for the admin dashboard' })
  async overview() {
    const [users, contestsByStatus, entries, revenue, deposits, withdrawalsPaid, pendingWithdrawals] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.contest.groupBy({ by: ['status'], _count: true, where: { deletedAt: null } }),
        this.prisma.entry.count(),
        this.prisma.ledgerAccount.findFirst({
          where: { type: 'PLATFORM_REVENUE', userId: null, contestId: null },
          select: { balanceMinor: true },
        }),
        this.prisma.paymentIntent.aggregate({
          where: { status: 'SUCCEEDED' },
          _sum: { amountMinor: true },
          _count: true,
        }),
        this.prisma.withdrawal.aggregate({
          where: { status: 'PAID' },
          _sum: { amountMinor: true },
        }),
        this.prisma.withdrawal.count({ where: { status: { in: ['REQUESTED', 'UNDER_REVIEW'] } } }),
      ]);

    return {
      users,
      entries,
      contests: Object.fromEntries(contestsByStatus.map((c) => [c.status, c._count])),
      platformRevenueMinor: revenue?.balanceMinor ?? 0n,
      depositVolumeMinor: deposits._sum.amountMinor ?? 0n,
      depositCount: deposits._count,
      withdrawalsPaidMinor: withdrawalsPaid._sum.amountMinor ?? 0n,
      pendingWithdrawals,
    };
  }
}
