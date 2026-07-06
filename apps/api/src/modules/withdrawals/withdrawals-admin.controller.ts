import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { WithdrawalsService } from './withdrawals.service';

const RejectBody = z.object({ reason: z.string().min(3).max(500) });

@ApiTags('admin/withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FINANCE_ADMIN')
@Controller('admin/withdrawals')
export class WithdrawalsAdminController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  @ApiOperation({ summary: 'Approval queue (REQUESTED / UNDER_REVIEW / PROCESSING)' })
  list(@Query('status') status?: string) {
    return this.withdrawals.listForReview(status);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve and initiate payout (maker-checker enforced)' })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.withdrawals.approve(admin.userId, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject and return the held funds' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RejectBody)) dto: { reason: string },
  ) {
    return this.withdrawals.reject(admin.userId, id, dto.reason);
  }
}
