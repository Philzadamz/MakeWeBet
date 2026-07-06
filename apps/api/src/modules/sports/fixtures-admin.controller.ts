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

@ApiTags('admin/fixtures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CONTEST_ADMIN')
@Controller('admin/fixtures')
export class FixturesAdminController {
  constructor(
    private readonly results: ResultsService,
    private readonly prisma: PrismaService,
  ) {}

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
