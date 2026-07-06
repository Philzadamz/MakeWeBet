import { Module } from '@nestjs/common';
import { LedgerService } from './ledger/ledger.service';
import { WalletAccountsService } from './wallet-accounts.service';
import { WalletController } from './wallet.controller';

/**
 * Finance bounded context — wallet + ledger. The LedgerService is the only
 * exported money-moving API; no other module may write to ledger tables.
 */
@Module({
  controllers: [WalletController],
  providers: [LedgerService, WalletAccountsService],
  exports: [LedgerService, WalletAccountsService],
})
export class WalletModule {}
