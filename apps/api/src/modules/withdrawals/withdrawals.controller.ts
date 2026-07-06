import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AddBankAccountRequest, RequestWithdrawalRequest } from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { WithdrawalsService } from './withdrawals.service';
import { BankAccountsService } from './bank-accounts.service';

@ApiTags('withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly bankAccounts: BankAccountsService,
  ) {}

  // ---- bank accounts

  @Post('bank-accounts')
  addBank(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(AddBankAccountRequest)) dto: AddBankAccountRequest,
  ) {
    return this.bankAccounts.add(user.userId, dto);
  }

  @Get('bank-accounts')
  listBanks(@CurrentUser() user: AuthenticatedUser) {
    return this.bankAccounts.list(user.userId);
  }

  @Delete('bank-accounts/:id')
  @HttpCode(204)
  async removeBank(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.bankAccounts.remove(user.userId, id);
  }

  // ---- withdrawals

  @Post('withdrawals/otp')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a step-up OTP for withdrawal confirmation' })
  async otp(@CurrentUser() user: AuthenticatedUser) {
    await this.withdrawals.requestOtp(user.userId);
    return { sent: true };
  }

  @Post('withdrawals')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a withdrawal (OTP-gated; places a ledger hold)' })
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RequestWithdrawalRequest)) dto: RequestWithdrawalRequest,
  ) {
    return this.withdrawals.request(user.userId, dto);
  }

  @Get('withdrawals/my')
  my(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawals.myWithdrawals(user.userId);
  }
}
