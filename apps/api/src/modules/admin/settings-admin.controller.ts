import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MARKET_TIER, MarketType, SLOT_DISTRIBUTION, type DifficultyTier } from '@fiq/contracts';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../audit/audit.service';

const ALL_MARKETS = Object.values(MarketType);

const CreateRuleSetBody = z.object({
  name: z.string().min(3).max(80),
  rules: z
    .array(
      z.object({
        marketType: z.nativeEnum(MarketType),
        pointsX10: z.number().int().min(1).max(10_000),
      }),
    )
    .refine(
      (rules) =>
        rules.length === ALL_MARKETS.length &&
        new Set(rules.map((r) => r.marketType)).size === ALL_MARKETS.length,
      { message: 'Exactly one rule per market is required (all 10 markets)' },
    ),
  activate: z.boolean().default(true),
});

const SIGNAL_KEYS = [
  'form',
  'homeAdvantage',
  'leaguePosition',
  'goalDifference',
  'headToHead',
  'recentGoals',
  'defensiveRecord',
  'injuries',
  'suspensions',
  'historical',
] as const;

const CreateWeightSetBody = z.object({
  name: z.string().min(3).max(80),
  weights: z.record(z.enum(SIGNAL_KEYS), z.number().min(0).max(1)),
  activate: z.boolean().default(true),
});

/**
 * Rules-as-data administration. Versions are IMMUTABLE — editing always
 * creates a new version; published contests keep the version they
 * snapshotted, so past/live contests can never be re-scored by a config
 * change. Activation only affects contests created afterwards.
 */
@ApiTags('admin/settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CONTEST_ADMIN')
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------ scoring rule sets

  @Get('rule-sets')
  @ApiOperation({ summary: 'All scoring rule-set versions, newest first' })
  async listRuleSets() {
    const sets = await this.prisma.ruleSet.findMany({
      orderBy: { version: 'desc' },
      include: { marketRules: true, _count: { select: { contests: true } } },
    });
    return sets.map((s) => ({
      id: s.id,
      version: s.version,
      name: s.name,
      isActive: s.isActive,
      contestsUsing: s._count.contests,
      maxSlipScoreX10: this.maxSlipScore(s.marketRules),
      rules: s.marketRules
        .map((r) => ({ marketType: r.marketType, tier: r.tier, pointsX10: r.pointsX10 }))
        .sort((a, b) => ALL_MARKETS.indexOf(a.marketType) - ALL_MARKETS.indexOf(b.marketType)),
    }));
  }

  @Post('rule-sets')
  @ApiOperation({ summary: 'Create a new immutable rule-set version (optionally activate)' })
  async createRuleSet(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateRuleSetBody)) dto: z.infer<typeof CreateRuleSetBody>,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.activate) {
        await tx.ruleSet.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      return tx.ruleSet.create({
        data: {
          name: dto.name,
          isActive: dto.activate,
          marketRules: {
            create: dto.rules.map((r) => ({
              marketType: r.marketType,
              tier: MARKET_TIER[r.marketType],
              pointsX10: r.pointsX10,
            })),
          },
        },
        include: { marketRules: true },
      });
    });
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'settings.rule_set.create',
      entityType: 'RuleSet',
      entityId: created.id,
      after: { name: dto.name, activated: dto.activate, rules: dto.rules },
    });
    return {
      id: created.id,
      version: created.version,
      maxSlipScoreX10: this.maxSlipScore(created.marketRules),
    };
  }

  @Post('rule-sets/:id/activate')
  @ApiOperation({ summary: 'Make a version the default for NEW contests' })
  async activateRuleSet(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const target = await this.prisma.ruleSet.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ code: 'RULE_SET_NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.ruleSet.updateMany({ where: { isActive: true }, data: { isActive: false } }),
      this.prisma.ruleSet.update({ where: { id }, data: { isActive: true } }),
    ]);
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'settings.rule_set.activate',
      entityType: 'RuleSet',
      entityId: id,
      after: { version: target.version },
    });
    return { id, isActive: true };
  }

  // -------------------------------------------------- difficulty weight sets

  @Get('difficulty-weights')
  @ApiOperation({ summary: 'All difficulty weight-set versions, newest first' })
  listWeightSets() {
    return this.prisma.difficultyWeightSet.findMany({
      orderBy: { version: 'desc' },
      select: { id: true, version: true, name: true, weights: true, isActive: true, createdAt: true },
    });
  }

  @Post('difficulty-weights')
  @ApiOperation({ summary: 'Create a new weight-set version (optionally activate)' })
  async createWeightSet(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateWeightSetBody)) dto: z.infer<typeof CreateWeightSetBody>,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.activate) {
        await tx.difficultyWeightSet.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      return tx.difficultyWeightSet.create({
        data: {
          name: dto.name,
          isActive: dto.activate,
          createdById: admin.userId,
          weights: dto.weights as Prisma.InputJsonValue,
        },
      });
    });
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'settings.weight_set.create',
      entityType: 'DifficultyWeightSet',
      entityId: created.id,
      after: { name: dto.name, activated: dto.activate, weights: dto.weights },
    });
    return { id: created.id, version: created.version };
  }

  @Post('difficulty-weights/:id/activate')
  async activateWeightSet(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const target = await this.prisma.difficultyWeightSet.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ code: 'WEIGHT_SET_NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.difficultyWeightSet.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.difficultyWeightSet.update({ where: { id }, data: { isActive: true } }),
    ]);
    await this.audit.record({
      actorId: admin.userId,
      actorType: 'ADMIN',
      action: 'settings.weight_set.activate',
      entityType: 'DifficultyWeightSet',
      entityId: id,
      after: { version: target.version },
    });
    return { id, isActive: true };
  }

  /** Best-case slip score: top-points market per tier × slots in that tier. */
  private maxSlipScore(rules: { marketType: MarketType; pointsX10: number }[]): number {
    let total = 0;
    for (const [tier, slots] of Object.entries(SLOT_DISTRIBUTION)) {
      const best = Math.max(
        0,
        ...rules
          .filter((r) => MARKET_TIER[r.marketType] === (tier as DifficultyTier))
          .map((r) => r.pointsX10),
      );
      total += best * slots;
    }
    return total;
  }
}
