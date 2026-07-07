import { execSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './env';

/**
 * Runs once before the whole e2e suite (vitest `globalSetup`):
 *   1. Create the fiq_test database if it doesn't exist.
 *   2. Apply migrations exactly as production would (`prisma migrate deploy`).
 *   3. Seed the reference rows every test relies on: an active rule set
 *      (launch point values), an active payout template, an active
 *      difficulty weight set, and the three singleton system ledger
 *      accounts (GATEWAY_CLEARING, PLATFORM_REVENUE, EXTERNAL).
 * Mirrors prisma/seed.ts, scoped to the test database.
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    const ruleSet =
      (await prisma.ruleSet.findFirst({ where: { isActive: true } })) ??
      (await prisma.ruleSet.create({
        data: {
          name: 'E2E launch rules — 150 max',
          isActive: true,
          marketRules: {
            create: [
              { marketType: 'MATCH_WINNER', tier: 'EASY', pointsX10: 50 },
              { marketType: 'DOUBLE_CHANCE', tier: 'EASY', pointsX10: 50 },
              { marketType: 'OVER_UNDER_25', tier: 'MEDIUM', pointsX10: 100 },
              { marketType: 'BTTS', tier: 'MEDIUM', pointsX10: 100 },
              { marketType: 'FIRST_HALF_WINNER', tier: 'MEDIUM', pointsX10: 100 },
              { marketType: 'FIRST_TEAM_TO_SCORE', tier: 'MEDIUM', pointsX10: 100 },
              { marketType: 'WINNING_MARGIN', tier: 'HARD', pointsX10: 150 },
              { marketType: 'CLEAN_SHEET', tier: 'HARD', pointsX10: 150 },
              { marketType: 'EXACT_GOALS', tier: 'HARD', pointsX10: 150 },
              { marketType: 'CORRECT_SCORE', tier: 'EXPERT', pointsX10: 325 },
            ],
          },
        },
      }));

    if (!(await prisma.payoutTemplate.findFirst({ where: { isActive: true } }))) {
      await prisma.payoutTemplate.create({
        data: {
          name: 'E2E Top 3 — 50/30/20',
          isActive: true,
          structure: [
            { from: 1, to: 1, shareBps: 5000 },
            { from: 2, to: 2, shareBps: 3000 },
            { from: 3, to: 3, shareBps: 2000 },
          ],
        },
      });
    }

    if (!(await prisma.difficultyWeightSet.findFirst({ where: { isActive: true } }))) {
      await prisma.difficultyWeightSet.create({
        data: {
          name: 'E2E launch weights',
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
    }

    for (const type of ['GATEWAY_CLEARING', 'PLATFORM_REVENUE', 'EXTERNAL'] as const) {
      const existing = await prisma.ledgerAccount.findFirst({
        where: { type, userId: null, contestId: null, currency: 'NGN' },
      });
      if (!existing) await prisma.ledgerAccount.create({ data: { type, currency: 'NGN' } });
    }

    void ruleSet;
  } finally {
    await prisma.$disconnect();
  }
}
