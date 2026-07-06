import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin/audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FINANCE_ADMIN') // + SUPER_ADMIN implicitly
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Recent audit trail (hash-chained, append-only)' })
  async list(@Query('entityType') entityType?: string, @Query('action') action?: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
    // Resolve actor names in one query for display.
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true },
    });
    const nameById = new Map(actors.map((a) => [a.id, a.username]));
    return rows.map((r) => ({
      id: r.id.toString(),
      actor: r.actorId ? (nameById.get(r.actorId) ?? r.actorId) : 'system',
      actorType: r.actorType,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      hash: r.hash.slice(0, 12),
      at: r.createdAt,
    }));
  }
}
