import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DifficultyModule } from '../difficulty/difficulty.module';
import { SportsDataPort } from './ports/sports-data.port';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { MockSportsAdapter } from './adapters/mock-sports.adapter';
import { ResultsService } from './results.service';
import { SyncService } from './sync.service';
import { ResultsPoller } from './results-poller';
import { FixturesAdminController } from './fixtures-admin.controller';

/**
 * Sports Data bounded context (anti-corruption layer). Port resolution
 * mirrors payments: real provider when a key is configured (mandatory in
 * production), deterministic mock otherwise so local dev needs no key.
 */
@Module({
  imports: [AuthModule, forwardRef(() => DifficultyModule)],
  controllers: [FixturesAdminController],
  providers: [
    ApiFootballAdapter,
    MockSportsAdapter,
    {
      provide: SportsDataPort,
      inject: [ConfigService, ApiFootballAdapter, MockSportsAdapter],
      useFactory: (
        config: ConfigService,
        apiFootball: ApiFootballAdapter,
        mock: MockSportsAdapter,
      ) => {
        if (config.get('API_FOOTBALL_KEY')) return apiFootball;
        if (config.get('NODE_ENV') === 'production') {
          throw new Error('No sports data provider configured for production');
        }
        return mock;
      },
    },
    ResultsService,
    SyncService,
    ResultsPoller,
  ],
  exports: [ResultsService, SyncService, SportsDataPort],
})
export class SportsModule {}
