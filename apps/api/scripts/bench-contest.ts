/* eslint-disable no-console */
/**
 * Capacity benchmark: how many entries can a single contest carry?
 *
 * Drives the REAL service layer (EntriesService.submitSlip — the exact
 * code path behind POST /entries, minus HTTP/throttling, which a real
 * crowd spreads across IPs anyway) against the dev database, then locks
 * the contest, finalizes results over HTTP and times the scoring →
 * settlement chain executed by the running dev server's workers.
 *
 * Usage: pnpm exec tsx scripts/bench-contest.ts [entries] [concurrency]
 */
process.env.RUN_WORKERS = 'false'; // scoring runs on the dev server, not here

const N = Number(process.argv[2] ?? 100);
const CONCURRENCY = Number(process.argv[3] ?? 20);
const ENTRY_FEE = 100_000n; // ₦1,000

async function main(): Promise<void> {
  // Hand-wired services (tsx/esbuild emits no decorator metadata, so Nest
  // DI can't run here) — these are the SAME classes the API serves with.
  const { PrismaClient } = await import('@prisma/client');
  const { default: Redis } = await import('ioredis');
  const { LedgerService } = await import('../src/modules/wallet/ledger/ledger.service');
  const { WalletAccountsService } = await import('../src/modules/wallet/wallet-accounts.service');
  const { OutboxService } = await import('../src/infrastructure/outbox/outbox.service');
  const { ContestQueue } = await import('../src/modules/contests/contest.queue');
  const { ContestsService } = await import('../src/modules/contests/contests.service');
  const { EntriesService } = await import('../src/modules/predictions/entries.service');
  const { randomUUID } = await import('node:crypto');

  const prisma = new PrismaClient() as never as import('../src/infrastructure/prisma/prisma.service').PrismaService;
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  const ledger = new LedgerService(prisma);
  const walletAccounts = new WalletAccountsService(prisma);
  const outbox = new OutboxService();
  const queue = new ContestQueue(redis);
  const contestsService = new ContestsService(prisma, outbox, queue, ledger);
  const entriesService = new EntriesService(prisma, ledger, walletAccounts, outbox);
  const cleanup = async () => {
    await queue.onModuleDestroy();
    await redis.quit();
    await (prisma as never as InstanceType<typeof PrismaClient>).$disconnect();
  };

  const run = randomUUID().slice(0, 6);
  console.log(`\n=== bench: ${N} entries, concurrency ${CONCURRENCY} (run ${run}) ===`);

  // ---- fixtures + contest -------------------------------------------------
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
  const league = await prisma.league.create({
    data: { name: `Bench League ${run}`, country: 'Benchland' },
  });
  const fixtureIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const home = await prisma.team.create({ data: { name: `Bench H${i} ${run}` } });
    const away = await prisma.team.create({ data: { name: `Bench A${i} ${run}` } });
    const f = await prisma.fixture.create({
      data: {
        leagueId: league.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(Date.now() + 2 * 3600_000),
      },
    });
    fixtureIds.push(f.id);
  }
  const tiers = ['EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HARD', 'HARD', 'HARD', 'EXPERT', 'EXPERT'] as const;
  const contest = await contestsService.create(admin.id, {
    title: `Bench Contest ${run}`,
    entryFeeMinor: Number(ENTRY_FEE),
    currency: 'NGN',
    fixtures: fixtureIds.map((fixtureId, i) => ({ fixtureId, order: i + 1 })),
    slots: tiers.map((tier, i) => ({ slotNo: i + 1, fixtureId: fixtureIds[Math.floor(i / 2)]!, tier })),
  });
  await contestsService.publish(contest.id);
  const slots = await prisma.contestSlot.findMany({
    where: { contestId: contest.id },
    orderBy: { slotNo: 'asc' },
  });

  // ---- users + wallets (bulk) ---------------------------------------------
  const t0 = Date.now();
  const passwordHash = '$argon2id$v=19$m=65536,t=3,p=4$YmVuY2hiZW5jaGJlbmNo$u1v5oJ5C5cQ0uS5H1o0F0m5o5g5h5i5j5k5l5m5n5oQ'; // never logged into
  const userRows = Array.from({ length: N }, (_, i) => ({
    id: randomUUID(),
    email: `bench-${run}-${i}@fiq.bench`,
    username: `bench_${run}_${i}`,
    passwordHash,
    status: 'ACTIVE' as const,
  }));
  await prisma.user.createMany({ data: userRows });
  await prisma.ledgerAccount.createMany({
    data: userRows.map((u) => ({ userId: u.id, type: 'USER_AVAILABLE' as const, currency: 'NGN' })),
  });
  // Fund everyone with ONE balanced journal (EXTERNAL -N×fee, each user +fee).
  const external = await prisma.ledgerAccount.findFirstOrThrow({
    where: { type: 'EXTERNAL', userId: null, contestId: null },
  });
  const accounts = await prisma.ledgerAccount.findMany({
    where: { userId: { in: userRows.map((u) => u.id) }, type: 'USER_AVAILABLE' },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.create({
      data: {
        type: 'DEPOSIT',
        idempotencyKey: `bench-fund-${run}`,
        description: 'Bench funding',
        lines: {
          create: [
            { accountId: external.id, amountMinor: -(ENTRY_FEE * BigInt(N)) },
            ...accounts.map((a) => ({ accountId: a.id, amountMinor: ENTRY_FEE })),
          ],
        },
      },
    });
    await tx.ledgerAccount.update({
      where: { id: external.id },
      data: { balanceMinor: { decrement: ENTRY_FEE * BigInt(N) } },
    });
    await tx.ledgerAccount.updateMany({
      where: { id: { in: accounts.map((a) => a.id) } },
      data: { balanceMinor: { increment: ENTRY_FEE } },
    });
  }, { timeout: 60_000 });
  console.log(`setup: ${N} funded users in ${Date.now() - t0}ms`);

  // ---- concurrent entry submission ----------------------------------------
  const marketByTier: Record<string, [string, string][]> = {
    EASY: [['MATCH_WINNER', 'HOME'], ['DOUBLE_CHANCE', 'HOME_OR_DRAW']],
    MEDIUM: [['OVER_UNDER_25', 'OVER'], ['BTTS', 'YES'], ['FIRST_HALF_WINNER', 'DRAW']],
    HARD: [['WINNING_MARGIN', 'HOME_BY_1'], ['CLEAN_SHEET', 'NONE'], ['EXACT_GOALS', '3']],
    EXPERT: [['CORRECT_SCORE', '2-1'], ['CORRECT_SCORE', '1-0']],
  };
  const buildSlip = (seed: number) => {
    const used: Record<string, number> = { EASY: 0, MEDIUM: 0, HARD: 0, EXPERT: 0 };
    return slots.map((s) => {
      const options = marketByTier[s.tier]!;
      const [marketType, selection] = options[(used[s.tier]!++ + seed) % options.length]!;
      return { slotId: s.id, marketType: marketType as never, selection };
    });
  };

  const latencies: number[] = [];
  const errors = new Map<string, number>();
  let next = 0;
  const tSubmit = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const i = next++;
        if (i >= N) return;
        const start = Date.now();
        try {
          await entriesService.submitSlip(userRows[i]!.id, {
            contestId: contest.id,
            predictions: buildSlip(i) as never,
            idempotencyKey: randomUUID(),
          });
          latencies.push(Date.now() - start);
        } catch (err) {
          const key = err instanceof Error ? err.constructor.name : 'unknown';
          errors.set(key, (errors.get(key) ?? 0) + 1);
        }
      }
    }),
  );
  const submitMs = Date.now() - tSubmit;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  console.log(
    `entries: ${latencies.length}/${N} ok in ${(submitMs / 1000).toFixed(1)}s ` +
      `(${(latencies.length / (submitMs / 1000)).toFixed(0)}/s) — ` +
      `p50 ${pct(50)}ms, p95 ${pct(95)}ms, max ${latencies[latencies.length - 1]}ms` +
      (errors.size ? ` — ERRORS: ${JSON.stringify(Object.fromEntries(errors))}` : ''),
  );

  const escrow = await prisma.ledgerAccount.findUniqueOrThrow({ where: { contestId: contest.id } });
  const escrowOk = escrow.balanceMinor === ENTRY_FEE * BigInt(latencies.length);
  console.log(`escrow: ${escrow.balanceMinor} kobo — ${escrowOk ? 'EXACT ✓' : 'MISMATCH ✗'}`);

  // ---- lock, finalize results over HTTP, time scoring → settlement --------
  const axios = (await import('axios')).default;
  const api = axios.create({ baseURL: 'http://localhost:4000/api/v1' });
  const login = await api.post('/auth/login', { identifier: 'admin@fiq.local', password: 'Admin123!ChangeMe' });
  const headers = { Authorization: `Bearer ${login.data.accessToken}` };
  await api.post(`/admin/contests/${contest.id}/lock`, {}, { headers });

  const results = [
    { homeGoals: 2, awayGoals: 1, htHomeGoals: 1, htAwayGoals: 0, firstToScore: 'HOME' },
    { homeGoals: 0, awayGoals: 0, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'NONE' },
    { homeGoals: 1, awayGoals: 0, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'HOME' },
    { homeGoals: 3, awayGoals: 1, htHomeGoals: 2, htAwayGoals: 0, firstToScore: 'HOME' },
    { homeGoals: 1, awayGoals: 1, htHomeGoals: 1, htAwayGoals: 1, firstToScore: 'HOME' },
  ];
  const tScore = Date.now();
  for (let i = 0; i < fixtureIds.length; i++) {
    await api.post(`/admin/fixtures/${fixtureIds[i]}/result`, results[i], { headers });
  }
  // Poll until the dev server's workers settle the contest.
  const deadline = Date.now() + 180_000;
  let settled = false;
  while (Date.now() < deadline) {
    const c = await prisma.contest.findUniqueOrThrow({ where: { id: contest.id }, select: { status: true } });
    if (c.status === 'SETTLED') { settled = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    settled
      ? `scoring+settlement: SETTLED in ${((Date.now() - tScore) / 1000).toFixed(1)}s for ${latencies.length} entries`
      : `scoring+settlement: NOT settled within 180s — CEILING HIT`,
  );

  const [{ sum }] = await prisma.$queryRaw<{ sum: bigint }[]>`
    SELECT COALESCE(SUM("amountMinor"),0)::bigint AS sum FROM journal_lines
  `;
  console.log(`global ledger sum: ${sum} ${sum === 0n ? '✓' : '✗'}`);

  const top = await prisma.entry.findMany({
    where: { contestId: contest.id, finalRank: { lte: 3 } },
    orderBy: { finalRank: 'asc' },
    select: { finalRank: true, totalPointsX10: true, prizeMinor: true },
  });
  console.log('podium:', top.map((e) => `#${e.finalRank} ${e.totalPointsX10 / 10}pts ₦${Number(e.prizeMinor) / 100}`).join(' | '));

  await cleanup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
