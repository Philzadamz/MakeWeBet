import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SportsDataPort } from './ports/sports-data.port';
import { ResultsService } from './results.service';

/**
 * Polls the provider for finished matches and finalizes results through the
 * same canonical path admins use — one road into the scoring engine.
 * Fixtures without a provider ref (hand-seeded) are left to manual entry.
 */
@Injectable()
export class ResultsPoller {
  private readonly logger = new Logger(ResultsPoller.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsDataPort,
    private readonly results: ResultsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('RUN_WORKERS') ?? false;
  }

  @Interval(120_000)
  async poll(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const candidates = await this.prisma.fixture.findMany({
        where: {
          resultFinalizedAt: null,
          kickoffAt: { lte: new Date(Date.now() - 105 * 60 * 1000) }, // FT earliest ~105min
          status: { in: ['SCHEDULED', 'LIVE'] },
          providerRefs: { some: { provider: this.sports.provider } },
        },
        include: { providerRefs: { where: { provider: this.sports.provider } } },
        take: 25,
      });

      for (const fixture of candidates) {
        const ref = fixture.providerRefs[0]?.providerRef;
        if (!ref) continue;
        try {
          const remote = await this.sports.getFixture(ref);
          if (!remote) continue;
          if (remote.status === 'LIVE' && fixture.status !== 'LIVE') {
            await this.prisma.fixture.update({
              where: { id: fixture.id },
              data: { status: 'LIVE' },
            });
          }
          if (
            remote.status === 'FINISHED' &&
            remote.homeGoals !== undefined &&
            remote.awayGoals !== undefined
          ) {
            await this.results.finalize(fixture.id, {
              homeGoals: remote.homeGoals,
              awayGoals: remote.awayGoals,
              htHomeGoals: remote.htHomeGoals ?? 0,
              htAwayGoals: remote.htAwayGoals ?? 0,
              firstToScore: remote.firstToScore ?? 'NONE',
            });
            this.logger.log(
              `auto-finalized fixture ${fixture.id}: ${remote.homeGoals}-${remote.awayGoals}`,
            );
          }
        } catch (err) {
          this.logger.warn(`poll failed for fixture ${fixture.id}: ${String(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
