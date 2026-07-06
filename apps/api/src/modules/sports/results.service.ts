import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventTopics, type FinalizeResultRequest } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';

/**
 * Canonical entry point for finalized results. Both the admin endpoint and
 * (later) the provider sync job land here — one path into scoring.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async finalize(fixtureId: string, result: FinalizeResultRequest): Promise<void> {
    const fixture = await this.prisma.fixture.findUnique({ where: { id: fixtureId } });
    if (!fixture) throw new NotFoundException({ code: 'FIXTURE_NOT_FOUND' });
    if (fixture.resultFinalizedAt) {
      throw new ConflictException({
        code: 'RESULT_ALREADY_FINAL',
        message: 'Result corrections require the dedicated rescore flow (audited)',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.fixture.update({
        where: { id: fixtureId },
        data: {
          status: 'FINISHED',
          homeGoals: result.homeGoals,
          awayGoals: result.awayGoals,
          htHomeGoals: result.htHomeGoals,
          htAwayGoals: result.htAwayGoals,
          firstToScore: result.firstToScore,
          resultFinalizedAt: new Date(),
        },
      });
      await this.outbox.emit(tx, EventTopics.MatchResultFinalized, { fixtureId });
    });
  }
}
