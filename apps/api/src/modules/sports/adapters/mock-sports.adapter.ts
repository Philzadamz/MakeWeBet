import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  SportsDataPort,
  type CanonicalFixture,
  type CanonicalHeadToHead,
  type CanonicalTeamForm,
} from '../ports/sports-data.port';

/**
 * DEV-ONLY provider: fabricates a deterministic football universe from
 * hashes, so the full pipeline (sync → difficulty → lock → results →
 * scoring → settlement) runs end-to-end with zero external calls.
 * Deterministic = same refs always produce the same forms and scores,
 * which keeps difficulty recomputes and rescores stable.
 */
@Injectable()
export class MockSportsAdapter extends SportsDataPort {
  readonly provider = 'API_FOOTBALL' as const; // masquerades for realistic refs
  private readonly logger = new Logger(MockSportsAdapter.name);

  private static readonly TEAMS = [
    ['Lagos United', 'LAG'],
    ['Abuja City', 'ABJ'],
    ['Kano Pillars FC', 'KAN'],
    ['Port Harcourt Rovers', 'PHR'],
    ['Ibadan Athletic', 'IBA'],
    ['Enugu Rangers', 'ENU'],
    ['Benin Warriors', 'BEN'],
    ['Jos Plateau FC', 'JOS'],
    ['Kaduna Crocodiles', 'KAD'],
    ['Calabar Corinthians', 'CAL'],
  ] as const;

  private rand(seed: string, bucket: number): number {
    const h = createHash('sha256').update(seed).digest();
    return h.readUInt32BE(0) % bucket;
  }

  async getFixturesByDate(date: Date): Promise<CanonicalFixture[]> {
    const day = date.toISOString().slice(0, 10);
    this.logger.warn(`MOCK sports: fabricating fixtures for ${day}`);
    const fixtures: CanonicalFixture[] = [];
    // Rotate pairings by date so consecutive gameweeks differ.
    const offset = this.rand(`round:${day}`, 9) + 1;
    for (let i = 0; i < 5; i++) {
      const homeIdx = (i * 2 + offset) % 10;
      const awayIdx = (i * 2 + 1 + offset) % 10;
      const kickoff = new Date(date);
      kickoff.setUTCHours(13 + i * 2, 0, 0, 0);
      fixtures.push({
        providerRef: `mock:fx:${day}:${i}`,
        leagueRef: 'mock:league:npl',
        homeTeam: this.team(homeIdx),
        awayTeam: this.team(awayIdx),
        kickoffAt: kickoff,
        status: 'SCHEDULED',
      });
    }
    return fixtures;
  }

  async getFixture(providerRef: string): Promise<CanonicalFixture | null> {
    // Everything before kickoff is scheduled; after kickoff, a deterministic
    // final score materializes so the result poller can finalize it.
    const [, , day, idxStr] = providerRef.split(':');
    if (!day || idxStr === undefined) return null;
    const list = await this.getFixturesByDate(new Date(`${day}T00:00:00Z`));
    const base = list[Number(idxStr)];
    if (!base) return null;
    if (base.kickoffAt.getTime() > Date.now()) return base;

    const homeGoals = this.rand(`${providerRef}:h`, 5);
    const awayGoals = this.rand(`${providerRef}:a`, 4);
    const htHome = Math.min(homeGoals, this.rand(`${providerRef}:hh`, homeGoals + 1));
    const htAway = Math.min(awayGoals, this.rand(`${providerRef}:ha`, awayGoals + 1));
    return {
      ...base,
      status: 'FINISHED',
      homeGoals,
      awayGoals,
      htHomeGoals: htHome,
      htAwayGoals: htAway,
      firstToScore:
        homeGoals + awayGoals === 0
          ? 'NONE'
          : this.rand(`${providerRef}:f`, homeGoals + awayGoals) < homeGoals
            ? 'HOME'
            : 'AWAY',
    };
  }

  async getTeamForm(teamRef: string): Promise<CanonicalTeamForm> {
    const results = ['W', 'D', 'L'] as const;
    return {
      teamRef,
      last5: Array.from({ length: 5 }, (_, i) => results[this.rand(`${teamRef}:r${i}`, 3)]!),
      leaguePosition: 1 + this.rand(`${teamRef}:pos`, 20),
      goalDifference: this.rand(`${teamRef}:gd`, 41) - 20,
      goalsScoredLast5: this.rand(`${teamRef}:gs`, 12),
      goalsConcededLast5: this.rand(`${teamRef}:gc`, 12),
      injuriesCount: this.rand(`${teamRef}:inj`, 5),
      suspensionsCount: this.rand(`${teamRef}:sus`, 3),
    };
  }

  async getHeadToHead(homeRef: string, awayRef: string): Promise<CanonicalHeadToHead> {
    const homeWins = this.rand(`${homeRef}:${awayRef}:hw`, 6);
    const awayWins = this.rand(`${homeRef}:${awayRef}:aw`, 6);
    const draws = this.rand(`${homeRef}:${awayRef}:d`, 4);
    return { homeWins, awayWins, draws, matches: homeWins + awayWins + draws || 1 };
  }

  private team(idx: number) {
    const [name, shortName] = MockSportsAdapter.TEAMS[idx]!;
    return { providerRef: `mock:team:${idx}`, name, shortName };
  }
}
