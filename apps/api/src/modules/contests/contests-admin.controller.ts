import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateContestRequest } from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ContestsService } from './contests.service';

@ApiTags('admin/contests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CONTEST_ADMIN')
@Controller('admin/contests')
export class ContestsAdminController {
  constructor(private readonly contests: ContestsService) {}

  @Get()
  @ApiOperation({ summary: 'All contests, any status, newest first' })
  list() {
    return this.contests.listAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a contest in DRAFT (5–10 fixtures, balanced slots)' })
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateContestRequest)) dto: CreateContestRequest,
  ) {
    return this.contests.create(admin.userId, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish: computes lockAt, creates escrow, schedules lock job' })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.publish(id);
  }

  @Post(':id/lock')
  @ApiOperation({ summary: 'Force-lock immediately (normally the scheduled job does this)' })
  async lock(@Param('id', ParseUUIDPipe) id: string) {
    await this.contests.lock(id);
    return { locked: true };
  }
}
