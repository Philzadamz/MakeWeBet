import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SubmitSlipRequest } from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { throttleLimit } from '../../common/throttle-limit';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { EntriesService } from './entries.service';

@ApiTags('predictions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('entries')
export class PredictionsController {
  constructor(private readonly entries: EntriesService) {}

  @Post()
  @Throttle({ default: { limit: throttleLimit(20), ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a Balanced Challenge slip (10 predictions, charges entry fee)',
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SubmitSlipRequest)) dto: SubmitSlipRequest,
  ) {
    return this.entries.submitSlip(user.userId, dto);
  }

  @Get('my')
  my(@CurrentUser() user: AuthenticatedUser) {
    return this.entries.myEntries(user.userId);
  }
}
