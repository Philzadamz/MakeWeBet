import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { PredictionsModule } from './modules/predictions/predictions.module';
import { ContestsModule } from './modules/contests/contests.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SportsModule } from './modules/sports/sports.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { EventHandlersModule } from './modules/event-handlers/event-handlers.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { AuditModule } from './modules/audit/audit.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { StatsModule } from './modules/stats/stats.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    OutboxModule,
    HealthModule,
    AuthModule,
    UsersModule,
    NotificationsModule,
    WalletModule,
    ScoringModule,
    PredictionsModule,
    ContestsModule,
    PaymentsModule,
    SportsModule,
    CryptoModule,
    AuditModule,
    SettlementModule,
    LeaderboardModule,
    WithdrawalsModule,
    StatsModule,
    AdminModule,
    EventHandlersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
