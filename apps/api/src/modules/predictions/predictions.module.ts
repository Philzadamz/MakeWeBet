import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { EntriesService } from './entries.service';
import { PredictionsController } from './predictions.controller';

/**
 * Predictions bounded context. Owns slip submission (validate → charge entry
 * fee via WalletModule → persist entry+predictions in one transaction) and
 * enforces immutability after contest lock (status guard, no update path).
 */
@Module({
  imports: [WalletModule],
  controllers: [PredictionsController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class PredictionsModule {}
