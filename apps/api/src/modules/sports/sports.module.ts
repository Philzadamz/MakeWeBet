import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DifficultyModule } from '../difficulty/difficulty.module';
import { SportsDataPort } from './ports/sports-data.port';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { FootballDataAdapter } from './adapters/football-data.adapter';
import { MockSportsAdapter } from './adapters/mock-sports.adapter';
import { ResultsService } from './results.service';
import { SyncService } from './sync.service';
import { ResultsPoller } from './results-poller';
import { FixturesSyncScheduler } from './fixtures-sync.scheduler';
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
    FootballDataAdapter,
    MockSportsAdapter,
    {
      provide: SportsDataPort,
      inject: [ConfigService, ApiFootballAdapter, FootballDataAdapter, MockSportsAdapter],
      useFactory: (
        config: ConfigService,
        apiFootball: ApiFootballAdapter,
        footballData: FootballDataAdapter,
        mock: MockSportsAdapter,
      ) => {
        const primary = config.get<string>('SPORTS_PRIMARY_PROVIDER');
        const hasApiFootball = Boolean(config.get('API_FOOTBALL_KEY'));
        const hasFootballData = Boolean(config.get('FOOTBALL_DATA_KEY'));

        // Honor the configured primary when its key exists; otherwise fall
        // back to whichever real provider has a key.
        if (primary === 'FOOTBALL_DATA' && hasFootballData) return footballData;
        if (primary === 'API_FOOTBALL' && hasApiFootball) return apiFootball;
        if (hasFootballData) return footballData;
        if (hasApiFootball) return apiFootball;

        if (config.get('NODE_ENV') === 'production') {
          throw new Error('No sports data provider configured for production');
        }
        return mock;
      },
    },
    ResultsService,
    SyncService,
    ResultsPoller,
    FixturesSyncScheduler,
  ],
  exports: [ResultsService, SyncService, SportsDataPort],
})
export class SportsModule {}
