import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FinalizeResultRequest } from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ResultsService } from './results.service';
import { SyncService } from './sync.service';
import { DifficultyService } from '../difficulty/difficulty.service';
import { z } from 'zod';

const SyncRequest = z.object({
  /** ISO date (YYYY-MM-DD); defaults to today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

@ApiTags('admin/fixtures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CONTEST_ADMIN')
@Controller('admin/fixtures')
export class FixturesAdminController {
  constructor(
    private readonly results: ResultsService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly difficulty: DifficultyService,
  ) {}

  @Post('sync')
  @ApiOperation({ summary: 'Pull fixtures for a date from the sports provider' })
  syncDate(@Body(new ZodValidationPipe(SyncRequest)) dto: { date?: string }) {
    return this.sync.syncDate(dto.date ? new Date(`${dto.date}T00:00:00Z`) : new Date());
  }

  @Post(':id/difficulty/recompute')
  @ApiOperation({ summary: 'Recompute the difficulty heatmap (override survives)' })
  async recompute(@Param('id', ParseUUIDPipe) id: string) {
    const stars = await this.difficulty.computeForFixture(id);
    return { fixtureId: id, stars };
  }

  @Get()
  @ApiOperation({ summary: 'Fixtures for contest building / result entry' })
  list(@Query('pending') pending?: string) {
    return this.prisma.fixture.findMany({
      where:
        pending === 'results'
          ? { resultFinalizedAt: null, kickoffAt: { lte: new Date() } }
          : pending === 'schedulable'
            ? { status: 'SCHEDULED', kickoffAt: { gt: new Date() } }
            : {},
      orderBy: { kickoffAt: 'asc' },
      take: 100,
      include: {
        homeTeam: { select: { name: true, shortName: true } },
        awayTeam: { select: { name: true, shortName: true } },
        league: { select: { name: true } },
        difficulty: { select: { stars: true, overrideStars: true } },
      },
    });
  }

  @Post(':id/result')
  @HttpCode(202)
  @ApiOperation({ summary: 'Finalize a result — triggers scoring via the outbox' })
  async finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(FinalizeResultRequest)) dto: FinalizeResultRequest,
  ) {
    await this.results.finalize(id, dto);
    return { queued: true };
  }
}
