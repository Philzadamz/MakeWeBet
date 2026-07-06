import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SportsDataPort } from '../sports/ports/sports-data.port';
import { computeStars, type DifficultyInput, type Weights } from './difficulty-engine';

/**
 * Computes and stores the difficulty heatmap for fixtures. Uses the active
 * versioned weight set; stores the signal breakdown for admin explainability.
 * Admin overrides (FixtureDifficulty.overrideStars) always survive recompute.
 */
@Injectable()
export class DifficultyService {
  private readonly logger = new Logger(DifficultyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsDataPort,
  ) {}

  async computeForFixture(fixtureId: string): Promise<number | null> {
    const fixture = await this.prisma.fixture.findUnique({
      where: { id: fixtureId },
      include: {
        homeTeam: { include: { providerRefs: { where: { provider: this.sports.provider } } } },
        awayTeam: { include: { providerRefs: { where: { provider: this.sports.provider } } } },
      },
    });
    if (!fixture) return null;

    // Fall back to internal ids so the dev mock works on seeded fixtures.
    const homeRef = fixture.homeTeam.providerRefs[0]?.providerRef ?? fixture.homeTeamId;
    const awayRef = fixture.awayTeam.providerRefs[0]?.providerRef ?? fixture.awayTeamId;

    let input: DifficultyInput = {};
    try {
      const [home, away, h2h] = await Promise.all([
        this.sports.getTeamForm(homeRef),
        this.sports.getTeamForm(awayRef),
        this.sports.getHeadToHead(homeRef, awayRef),
      ]);
      input = {
        home: home ?? undefined,
        away: away ?? undefined,
        headToHead: h2h ?? undefined,
      };
    } catch (err) {
      this.logger.warn(`form data unavailable for fixture ${fixtureId}: ${String(err)}`);
      // Engine degrades gracefully to neutral 3 stars.
    }

    const weightSet = await this.prisma.difficultyWeightSet.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!weightSet) {
      this.logger.error('no active difficulty weight set — seed one');
      return null;
    }

    const result = computeStars(input, weightSet.weights as Weights);

    await this.prisma.fixtureDifficulty.upsert({
      where: { fixtureId },
      create: {
        fixtureId,
        stars: result.stars,
        signals: { score: result.score, ...result.signals } as Prisma.InputJsonValue,
        weightSetId: weightSet.id,
      },
      update: {
        stars: result.stars,
        signals: { score: result.score, ...result.signals } as Prisma.InputJsonValue,
        weightSetId: weightSet.id,
        computedAt: new Date(),
        // overrideStars intentionally untouched — admin judgment wins.
      },
    });
    return result.stars;
  }
}
