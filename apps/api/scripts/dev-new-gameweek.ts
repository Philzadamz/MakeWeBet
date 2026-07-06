/* eslint-disable no-console */
/**
 * DEV: seed a fresh set of 5 SCHEDULED fixtures (next weekend) with
 * difficulty ratings, so a new contest can be created and published.
 *
 * Usage: pnpm exec tsx scripts/dev-new-gameweek.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const league = await prisma.league.findFirstOrThrow();
  const teams = await prisma.team.findMany({ take: 10, orderBy: { createdAt: 'asc' } });
  const weights = await prisma.difficultyWeightSet.findFirstOrThrow({ where: { isActive: true } });

  const saturday = new Date();
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
  saturday.setHours(15, 0, 0, 0);

  const fixtureIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    // Rotate pairings so this gameweek differs from the seed.
    const home = teams[(i * 2 + 1) % 10]!;
    const away = teams[(i * 2 + 4) % 10]!;
    const fixture = await prisma.fixture.create({
      data: {
        leagueId: league.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(saturday.getTime() + i * 2 * 3600 * 1000),
      },
    });
    await prisma.fixtureDifficulty.create({
      data: {
        fixtureId: fixture.id,
        stars: ((i + 2) % 5) + 1,
        signals: { seeded: true },
        weightSetId: weights.id,
      },
    });
    fixtureIds.push(fixture.id);
    console.log(`${home.name} vs ${away.name} — ${fixture.kickoffAt.toISOString()} (${fixture.id})`);
  }
  console.log(JSON.stringify(fixtureIds));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
