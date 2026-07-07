import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { InitiateDepositRequest } from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { throttleLimit } from '../../common/throttle-limit';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DepositsService } from './deposits.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly deposits: DepositsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post('deposits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a wallet deposit; returns hosted checkout URL' })
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(InitiateDepositRequest)) dto: InitiateDepositRequest,
  ) {
    return this.deposits.initiate(user.userId, BigInt(dto.amountMinor));
  }

  @Get('deposits/:reference/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Client callback verification (idempotent with webhook)' })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference', ParseUUIDPipe) reference: string,
  ) {
    await this.deposits.assertOwnership(reference, user.userId);
    return this.deposits.settle(reference);
  }

  /**
   * Provider webhooks: signature-verified against the RAW body, deduped,
   * then settled. Returns 200 fast — providers retry on non-2xx.
   */
  @Post('webhooks/paystack')
  @SkipThrottle()
  @HttpCode(200)
  async paystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException({ code: 'INVALID_WEBHOOK' });
    }
    await this.webhooks.handlePaystack(req.rawBody, signature);
    return { received: true };
  }
}
