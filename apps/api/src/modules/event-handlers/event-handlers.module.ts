import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { SettlementModule } from '../settlement/settlement.module';
import { StatsModule } from '../stats/stats.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { DomainEventsWorker } from './domain-events.worker';

@Module({
  imports: [ScoringModule, SettlementModule, StatsModule, WithdrawalsModule],
  providers: [DomainEventsWorker],
})
export class EventHandlersModule {}
