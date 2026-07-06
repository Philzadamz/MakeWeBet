import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WithdrawalsService } from './withdrawals.service';
import { BankAccountsService } from './bank-accounts.service';
import { FraudService } from './fraud.service';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsAdminController } from './withdrawals-admin.controller';

@Module({
  imports: [AuthModule, WalletModule, PaymentsModule, NotificationsModule],
  controllers: [WithdrawalsController, WithdrawalsAdminController],
  providers: [WithdrawalsService, BankAccountsService, FraudService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
