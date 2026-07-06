import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';

/**
 * Scoring bounded context. Consumes `match.result.finalized`, scores every
 * prediction on affected slots via the pure engine in ./engine, and emits
 * `contest.scored` through the outbox when all results are in.
 *
 * ARCHITECTURAL RULE: this module must never import from @fiq/contracts'
 * risk module — the Risk Meter can never influence points.
 */
@Module({
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
