import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DifficultyService } from '../difficulty/difficulty.service';
import { SportsDataPort, type CanonicalFixture, type CanonicalTeam } from './ports/sports-data.port';

/**
 * Pulls provider fixtures into the canonical tables. Everything is keyed by
 * (provider, providerRef) mapping rows, so re-syncing is idempotent and a
 * future provider swap never orphans historical data.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsDataPort,
    private readonly difficulty: DifficultyService,
  ) {}

  async syncDate(date: Date): Promise<{ created: number; updated: number }> {
    const fixtures = await this.sports.getFixturesByDate(date);
    let created = 0;
    let updated = 0;

    for (const canonical of fixtures) {
      const isNew = await this.upsertFixture(canonical);
      if (isNew) created += 1;
      else updated += 1;
    }
    this.logger.log(
      `sync ${date.toISOString().slice(0, 10)}: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  }

  private async upsertFixture(canonical: CanonicalFixture): Promise<boolean> {
    const provider = this.sports.provider;

    const existingRef = await this.prisma.fixtureProviderRef.findUnique({
      where: { provider_providerRef: { provider, providerRef: canonical.providerRef } },
    });

    const leagueId = await this.resolveLeague(canonical.leagueRef);
    const homeTeamId = await this.resolveTeam(canonical.homeTeam);
    const awayTeamId = await this.resolveTeam(canonical.awayTeam);

    const data: Prisma.FixtureUncheckedUpdateInput = {
      kickoffAt: canonical.kickoffAt,
      status: canonical.status,
      homeGoals: canonical.homeGoals ?? null,
      awayGoals: canonical.awayGoals ?? null,
      htHomeGoals: canonical.htHomeGoals ?? null,
      htAwayGoals: canonical.htAwayGoals ?? null,
    };

    if (existingRef) {
      await this.prisma.fixture.update({ where: { id: existingRef.fixtureId }, data });
      return false;
    }

    const fixture = await this.prisma.fixture.create({
      data: {
        leagueId,
        homeTeamId,
        awayTeamId,
        kickoffAt: canonical.kickoffAt,
        status: canonical.status,
        providerRefs: { create: { provider, providerRef: canonical.providerRef } },
      },
    });
    await this.difficulty.computeForFixture(fixture.id);
    return true;
  }

  private async resolveLeague(leagueRef: string): Promise<string> {
    const provider = this.sports.provider;
    const existing = await this.prisma.leagueProviderRef.findUnique({
      where: { provider_providerRef: { provider, providerRef: leagueRef } },
    });
    if (existing) return existing.leagueId;
    const league = await this.prisma.league.create({
      data: {
        name: `League ${leagueRef}`, // enriched by a later metadata sync
        country: 'Unknown',
        providerRefs: { create: { provider, providerRef: leagueRef } },
      },
    });
    return league.id;
  }

  private async resolveTeam(team: CanonicalTeam): Promise<string> {
    const provider = this.sports.provider;
    const existing = await this.prisma.teamProviderRef.findUnique({
      where: { provider_providerRef: { provider, providerRef: team.providerRef } },
    });
    if (existing) return existing.teamId;
    const created = await this.prisma.team.create({
      data: {
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl,
        providerRefs: { create: { provider, providerRef: team.providerRef } },
      },
    });
    return created.id;
  }
}
