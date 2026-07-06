import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettlementService } from './settlement.service';

@Module({
  imports: [WalletModule, NotificationsModule],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
