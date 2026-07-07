import '../src/infrastructure/bigint-json'; // main.ts's entrypoint patch — tests bypass main.ts
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { VersioningType, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { DifficultyTier } from '@fiq/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { LedgerService } from '../src/modules/wallet/ledger/ledger.service';
import { WalletAccountsService } from '../src/modules/wallet/wallet-accounts.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { applyTestEnv } from './env';

/** Boots the REAL AppModule against the isolated test DB/Redis. */
export async function bootstrapApp(): Promise<INestApplication> {
  // NODE_ENV=test (set here and by Vitest itself before this module even
  // loads) raises every @Throttle() ceiling via throttleLimit() — a single
  // spec file legitimately registers/logs in far more than the real
  // per-route limits allow within their window. Everything else in the
  // request pipeline — guards, DB, Redis, BullMQ — is production-real.
  applyTestEnv();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(cookieParser());
  await app.init();
  return app;
}

/** Credits a wallet exactly like a settled deposit would (mirrors scripts/dev-credit.ts). */
export async function creditWallet(app: INestApplication, userId: string, amountMinor: bigint): Promise<void> {
  const ledger = app.get(LedgerService);
  const accounts = app.get(WalletAccountsService);
  const userAccount = await accounts.userAvailable(userId);
  const external = await accounts.system('EXTERNAL');
  await ledger.post({
    type: 'DEPOSIT',
    idempotencyKey: `e2e-credit:${randomUUID()}`,
    description: 'E2E test wallet credit',
    lines: [
      { accountId: external.id, amountMinor: -amountMinor },
      { accountId: userAccount.id, amountMinor },
    ],
  });
}

/** Reads a fresh OTP straight from the service — the e2e equivalent of "check your email". */
export async function issueOtp(
  app: INestApplication,
  userId: string,
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'WITHDRAWAL' | 'LOGIN',
): Promise<string> {
  return app.get(OtpService).issueCode(userId, purpose);
}

/** POST /auth/login expects {identifier, password} — never the register shape. */
export function loginBody(u: { email: string; password: string }): { identifier: string; password: string } {
  return { identifier: u.email, password: u.password };
}

/**
 * Sum of every journal line, ever — the platform's global money invariant.
 * Postgres's SUM(bigint) returns `numeric` (overflow-safe), which Prisma
 * maps to its Decimal type, not a JS bigint — the explicit ::bigint cast
 * is what makes $queryRaw hand back a real bigint here.
 */
export async function totalLedgerSum(app: INestApplication): Promise<bigint> {
  const prisma = app.get(PrismaService);
  const [{ sum }] = await prisma.$queryRaw<{ sum: bigint }[]>`
    SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS sum FROM journal_lines
  `;
  return sum;
}

export async function promoteToRole(
  app: INestApplication,
  userId: string,
  role: 'CONTEST_ADMIN' | 'FINANCE_ADMIN' | 'SUPPORT' | 'SUPER_ADMIN',
): Promise<void> {
  await app.get(PrismaService).user.update({ where: { id: userId }, data: { role, status: 'ACTIVE' } });
}

interface SeededFixture {
  id: string;
  kickoffAt: Date;
}

/** Creates a league, 10 teams, and N fixtures kicking off `startInMs` from now, 90 min apart. */
export async function seedFixtures(
  app: INestApplication,
  count: number,
  startInMs = 5 * 60_000,
): Promise<SeededFixture[]> {
  const prisma = app.get(PrismaService);
  const league = await prisma.league.create({
    data: { name: `E2E League ${randomUUID().slice(0, 8)}`, country: 'Testland' },
  });
  const fixtures: SeededFixture[] = [];
  for (let i = 0; i < count; i++) {
    const home = await prisma.team.create({ data: { name: `Home FC ${randomUUID().slice(0, 6)}` } });
    const away = await prisma.team.create({ data: { name: `Away FC ${randomUUID().slice(0, 6)}` } });
    const kickoffAt = new Date(Date.now() + startInMs + i * 90 * 60_000);
    const fixture = await prisma.fixture.create({
      data: { leagueId: league.id, homeTeamId: home.id, awayTeamId: away.id, kickoffAt },
    });
    fixtures.push({ id: fixture.id, kickoffAt });
  }
  return fixtures;
}

/**
 * Polls `fn` until it returns a truthy value or the timeout elapses.
 * Settlement is asynchronous (outbox relay -> BullMQ -> scoring ->
 * settlement, each its own event round-trip), so tests observe it by
 * waiting rather than asserting immediately after the triggering request.
 */
export async function waitFor<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 20_000, intervalMs = 400, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastResult: T | undefined;
  while (Date.now() < deadline) {
    lastResult = await fn();
    if (lastResult) return lastResult;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

/** The Balanced Challenge tier template in slot order: 2 Easy / 3 Medium / 3 Hard / 2 Expert. */
export const TIER_TEMPLATE: DifficultyTier[] = [
  'EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HARD', 'HARD', 'HARD', 'EXPERT', 'EXPERT',
];

/** Builds a CreateContestRequest body from 5 fixtures, 2 slots each, in template tier order. */
export function buildContestPayload(
  title: string,
  entryFeeMinor: number,
  fixtures: SeededFixture[],
): {
  title: string;
  entryFeeMinor: number;
  currency: string;
  fixtures: { fixtureId: string; order: number }[];
  slots: { slotNo: number; fixtureId: string; tier: DifficultyTier }[];
} {
  if (fixtures.length !== 5) throw new Error('buildContestPayload expects exactly 5 fixtures');

  return {
    title,
    entryFeeMinor,
    currency: 'NGN',
    fixtures: fixtures.map((f, i) => ({ fixtureId: f.id, order: i + 1 })),
    slots: TIER_TEMPLATE.map((tier, i) => ({
      slotNo: i + 1,
      // 2 slots per fixture, same fixture ordering as TIER_TEMPLATE pairs.
      fixtureId: fixtures[Math.floor(i / 2)]!.id,
      tier,
    })),
  };
}
