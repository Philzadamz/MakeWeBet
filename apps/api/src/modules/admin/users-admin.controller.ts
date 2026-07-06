import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../audit/audit.service';

const ReasonBody = z.object({ reason: z.string().min(3).max(500) });

@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPPORT', 'FINANCE_ADMIN')
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search users by email/username; includes wallet balance' })
  async list(@Query('q') q?: string) {
    const users = await this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q.toLowerCase() } },
              { username: { contains: q.toLowerCase() } },
            ],
            deletedAt: null,
          }
        : { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        ledgerAccounts: {
          where: { type: 'USER_AVAILABLE' },
          select: { balanceMinor: true },
        },
        _count: { select: { entries: true, withdrawals: true } },
      },
    });
    return users.map(({ ledgerAccounts, _count, ...u }) => ({
      ...u,
      balanceMinor: ledgerAccounts[0]?.balanceMinor ?? 0n,
      entries: _count.entries,
      withdrawals: _count.withdrawals,
    }));
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend account (revokes all sessions; audited)' })
  async suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReasonBody)) dto: { reason: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (user.id === admin.userId) {
      throw new ConflictException({ code: 'SELF_SUSPEND', message: 'Cannot suspend yourself' });
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new ConflictException({ code: 'FORBIDDEN_TARGET', message: 'Cannot suspend a super admin' });
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'user.suspend',
      entityType: 'User',
      entityId: id,
      before: { status: user.status },
      after: { status: 'SUSPENDED', reason: dto.reason },
    });
    return { id, status: 'SUSPENDED' };
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended account (audited)' })
  async reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (user.status !== 'SUSPENDED') {
      throw new ConflictException({ code: 'INVALID_STATUS', message: `User is ${user.status}` });
    }
    await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'user.reactivate',
      entityType: 'User',
      entityId: id,
      before: { status: 'SUSPENDED' },
      after: { status: 'ACTIVE' },
    });
    return { id, status: 'ACTIVE' };
  }
}
