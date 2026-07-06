import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResultsService } from './results.service';
import { FixturesAdminController } from './fixtures-admin.controller';

/**
 * Sports Data bounded context (anti-corruption layer).
 * ResultsService is the single canonical path for finalized results;
 * provider sync adapters (API-Football first) will call it too.
 */
@Module({
  imports: [AuthModule],
  controllers: [FixturesAdminController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class SportsModule {}
