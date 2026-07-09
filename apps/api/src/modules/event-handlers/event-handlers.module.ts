import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { SettlementModule } from '../settlement/settlement.module';
import { StatsModule } from '../stats/stats.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { DifficultyModule } from '../difficulty/difficulty.module';
import { DomainEventsWorker } from './domain-events.worker';

@Module({
  imports: [ScoringModule, SettlementModule, StatsModule, WithdrawalsModule, DifficultyModule],
  providers: [DomainEventsWorker],
})
export class EventHandlersModule {}
