/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  DEFAULT_MARKET_POINTS_X10,
  MARKET_TIER,
  MarketType,
} from '@fiq/contracts';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // ---- Rule set v1: the corrected point math (Easy 5 / Med 10 / Hard 15 / Expert 32.5)
  const ruleSet =
    (await prisma.ruleSet.findFirst({ where: { isActive: true } })) ??
    (await prisma.ruleSet.create({
      data: {
        name: 'Launch rules — 150 max',
        isActive: true,
        marketRules: {
          create: (Object.keys(DEFAULT_MARKET_POINTS_X10) as MarketType[]).map((market) => ({
            marketType: market,
            tier: MARKET_TIER[market],
            pointsX10: DEFAULT_MARKET_POINTS_X10[market],
          })),
        },
      },
    }));
  console.log(`rule set: ${ruleSet.name}`);

  // ---- Payout template: top 3 take 50/30/20 (basis points sum to 10000)
  const payout =
    (await prisma.payoutTemplate.findFirst({ where: { isActive: true } })) ??
    (await prisma.payoutTemplate.create({
      data: {
        name: 'Top 3 — 50/30/20',
        structure: [
          { from: 1, to: 1, shareBps: 5000 },
          { from: 2, to: 2, shareBps: 3000 },
          { from: 3, to: 3, shareBps: 2000 },
        ],
      },
    }));
  console.log(`payout template: ${payout.name}`);

  // ---- Difficulty weight set v1
  if (!(await prisma.difficultyWeightSet.findFirst({ where: { isActive: true } }))) {
    await prisma.difficultyWeightSet.create({
      data: {
        name: 'Launch weights',
        isActive: true,
        weights: {
          form: 0.18,
          homeAdvantage: 0.1,
          leaguePosition: 0.14,
          goalDifference: 0.1,
          headToHead: 0.1,
          recentGoals: 0.08,
          defensiveRecord: 0.1,
          injuries: 0.08,
          suspensions: 0.04,
          historical: 0.08,
        },
      },
    });
    console.log('difficulty weight set created');
  }

  // ---- System ledger accounts (singletons)
  for (const type of ['GATEWAY_CLEARING', 'PLATFORM_REVENUE', 'EXTERNAL'] as const) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { type, userId: null, contestId: null, currency: 'NGN' },
    });
    if (!existing) {
      await prisma.ledgerAccount.create({ data: { type, currency: 'NGN' } });
      console.log(`system account: ${type}`);
    }
  }

  // ---- Admin user
  const adminEmail = 'admin@fiq.local';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        username: 'fiqadmin',
        passwordHash: await argon2.hash('Admin123!ChangeMe'),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        ledgerAccounts: { create: { type: 'USER_AVAILABLE', currency: 'NGN' } },
      },
    });
    console.log(`admin user: ${adminEmail} / Admin123!ChangeMe  ← change immediately`);
  }

  // ---- Demo league, teams, fixtures (kickoffs spread across next weekend)
  if ((await prisma.fixture.count()) === 0) {
    const league = await prisma.league.create({
      data: { name: 'Premier League', country: 'England', season: '2026/27' },
    });
    const teamNames = [
      ['Arsenal', 'ARS'], ['Chelsea', 'CHE'], ['Liverpool', 'LIV'], ['Manchester City', 'MCI'],
      ['Manchester United', 'MUN'], ['Tottenham', 'TOT'], ['Newcastle', 'NEW'], ['Aston Villa', 'AVL'],
      ['Brighton', 'BHA'], ['West Ham', 'WHU'],
    ] as const;
    const teams = [];
    for (const [name, shortName] of teamNames) {
      teams.push(await prisma.team.create({ data: { name, shortName } }));
    }
    const saturday = new Date();
    saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
    saturday.setHours(15, 0, 0, 0);

    const weights = await prisma.difficultyWeightSet.findFirstOrThrow({ where: { isActive: true } });
    for (let i = 0; i < 5; i++) {
      const home = teams[i * 2]!;
      const away = teams[i * 2 + 1]!;
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
          stars: (i % 5) + 1,
          signals: { seeded: true },
          weightSetId: weights.id,
        },
      });
    }
    console.log('seeded 5 fixtures with difficulty stars');
  }

  console.log('seed complete ✅');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
