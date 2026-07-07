import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SCORE_X10 } from '@fiq/contracts';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  bootstrapApp,
  buildContestPayload,
  creditWallet,
  loginBody,
  promoteToRole,
  seedFixtures,
  totalLedgerSum,
  waitFor,
} from './helpers';

/**
 * Drives the ENTIRE contest lifecycle exactly as production events would:
 * register -> credit wallet -> admin creates/publishes a contest -> user
 * submits a 100%-correct slip -> admin force-locks -> admin finalizes all
 * 5 results -> outbox/BullMQ chain scores every prediction, settles the
 * contest, and pays the sole winner their full share of the pool.
 *
 * Every prediction is deliberately correct so the expected total is the
 * platform's hard invariant, MAX_SCORE_X10 (150.0 points) — not just "some
 * number that happens to match a hand calculation".
 */
describe('contest lifecycle (e2e)', () => {
  let app: INestApplication;
  let server: import('http').Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('scores a perfect slip at exactly 150.0 points and pays the full pool to the sole winner', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `player-${id}@fiq.test`, username: `player_${id}`, password: 'Passw0rdX!' };
    const admin = { email: `admin-${id}@fiq.test`, username: `admin_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerToken = playerReg.body.accessToken as string;
    const playerMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);

    const adminReg = await request(server).post('/api/v1/auth/register').send(admin).expect(201);
    const adminMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, adminMe.body.id, 'CONTEST_ADMIN');
    const adminLogin = await request(server).post('/api/v1/auth/login').send(loginBody(admin)).expect(200);
    const adminToken = adminLogin.body.accessToken as string;
    const adminAuth = { Authorization: `Bearer ${adminToken}` };

    const ENTRY_FEE_MINOR = 100_000; // ₦1,000
    await creditWallet(app, playerMe.body.id, 500_000n);

    const fixtures = await seedFixtures(app, 5);
    const payload = buildContestPayload(`E2E Perfect Slip ${id}`, ENTRY_FEE_MINOR, fixtures);

    const created = await request(server)
      .post('/api/v1/admin/contests')
      .set(adminAuth)
      .send(payload)
      .expect(201);
    const contestId = created.body.id as string;
    const slug = created.body.slug as string;

    await request(server).post(`/api/v1/admin/contests/${contestId}/publish`).set(adminAuth).expect(201);

    const detail = await request(server).get(`/api/v1/contests/${slug}`).expect(200);
    const slotIdByNo = new Map<number, string>(
      (detail.body.slots as { slotNo: number; slotId: string }[]).map((s) => [s.slotNo, s.slotId]),
    );

    // Slots pair to fixtures by floor(slotIndex/2), but the tier template is
    // 2 Easy/3 Medium/3 Hard/2 Expert (asymmetric) — so fixture pairings
    // don't land on tier boundaries evenly. The real layout: F1=[1,2]EASY,
    // F2=[3,4]MEDIUM, F3=[5]MEDIUM+[6]HARD, F4=[7,8]HARD, F5=[9,10]EXPERT.
    // Every one of these is correct against the results finalized below.
    const predictions = [
      { slotNo: 1, marketType: 'MATCH_WINNER', selection: 'HOME' }, // F1
      { slotNo: 2, marketType: 'DOUBLE_CHANCE', selection: 'HOME_OR_DRAW' }, // F1
      { slotNo: 3, marketType: 'OVER_UNDER_25', selection: 'UNDER' }, // F2
      { slotNo: 4, marketType: 'BTTS', selection: 'NO' }, // F2
      { slotNo: 5, marketType: 'FIRST_HALF_WINNER', selection: 'DRAW' }, // F3
      { slotNo: 6, marketType: 'CLEAN_SHEET', selection: 'HOME' }, // F3
      { slotNo: 7, marketType: 'WINNING_MARGIN', selection: 'HOME_BY_2' }, // F4
      { slotNo: 8, marketType: 'EXACT_GOALS', selection: '4' }, // F4
      { slotNo: 9, marketType: 'CORRECT_SCORE', selection: '1-1' }, // F5
      { slotNo: 10, marketType: 'CORRECT_SCORE', selection: '1-1' }, // F5
    ].map((p) => ({ slotId: slotIdByNo.get(p.slotNo)!, marketType: p.marketType, selection: p.selection }));

    const entryRes = await request(server)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ contestId, predictions, idempotencyKey: randomUUID() })
      .expect(201);
    expect(entryRes.body.risk.profile).toBeTypeOf('string');

    const walletAfterEntry = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterEntry.body.balanceMinor).toBe(String(500_000 - ENTRY_FEE_MINOR));

    await request(server).post(`/api/v1/admin/contests/${contestId}/lock`).set(adminAuth).expect(201);

    // Results engineered so every one of the 10 predictions above is correct.
    const results = [
      { homeGoals: 2, awayGoals: 0, htHomeGoals: 1, htAwayGoals: 0, firstToScore: 'HOME' }, // F1
      { homeGoals: 0, awayGoals: 0, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'NONE' }, // F2
      { homeGoals: 1, awayGoals: 0, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'HOME' }, // F3
      { homeGoals: 3, awayGoals: 1, htHomeGoals: 1, htAwayGoals: 0, firstToScore: 'HOME' }, // F4
      { homeGoals: 1, awayGoals: 1, htHomeGoals: 0, htAwayGoals: 0, firstToScore: 'HOME' }, // F5
    ];
    for (let i = 0; i < fixtures.length; i++) {
      await request(server)
        .post(`/api/v1/admin/fixtures/${fixtures[i]!.id}/result`)
        .set(adminAuth)
        .send(results[i])
        .expect(202);
    }

    const settled = await waitFor(
      async () => {
        const lb = await request(server).get(`/api/v1/contests/${slug}/leaderboard`).expect(200);
        return lb.body.contest.status === 'SETTLED' ? lb.body : undefined;
      },
      { label: 'contest settled' },
    );

    expect(settled.entries).toHaveLength(1);
    expect(settled.entries[0].pointsX10).toBe(MAX_SCORE_X10);
    expect(settled.entries[0].correctCount).toBe(10);
    const expectedPrize = Math.floor((ENTRY_FEE_MINOR * 8500) / 10000); // 85% commission split
    expect(settled.entries[0].prizeMinor).toBe(String(expectedPrize));

    const walletAfter = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfter.body.balanceMinor).toBe(String(500_000 - ENTRY_FEE_MINOR + expectedPrize));

    // The invariant that matters most: escrow zeroed, and the WHOLE ledger
    // (every account, every contest, ever) still sums to exactly zero.
    const escrow = await prisma.ledgerAccount.findUnique({ where: { contestId } });
    expect(escrow?.balanceMinor).toBe(0n);
    expect(await totalLedgerSum(app)).toBe(0n);
  });

  it('rejects a slip with a tier/market mismatch as a 400', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `bad-${id}@fiq.test`, username: `bad_${id}`, password: 'Passw0rdX!' };
    const admin = { email: `badadmin-${id}@fiq.test`, username: `badadmin_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerReg.body.accessToken}`)
      .expect(200);
    await creditWallet(app, playerMe.body.id, 500_000n);

    const adminReg = await request(server).post('/api/v1/auth/register').send(admin).expect(201);
    const adminMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, adminMe.body.id, 'CONTEST_ADMIN');
    const adminLogin = await request(server).post('/api/v1/auth/login').send(loginBody(admin)).expect(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.accessToken}` };

    const fixtures = await seedFixtures(app, 5);
    const payload = buildContestPayload(`E2E Bad Slip ${id}`, 100_000, fixtures);
    const created = await request(server)
      .post('/api/v1/admin/contests')
      .set(adminAuth)
      .send(payload)
      .expect(201);
    await request(server).post(`/api/v1/admin/contests/${created.body.id}/publish`).set(adminAuth).expect(201);

    const detail = await request(server).get(`/api/v1/contests/${created.body.slug}`).expect(200);
    const slots = detail.body.slots as { slotNo: number; slotId: string; tier: string }[];

    // Slot 1 is EASY; CORRECT_SCORE is an EXPERT-only market -> mismatch.
    const predictions = slots
      .sort((a, b) => a.slotNo - b.slotNo)
      .map((s) => ({ slotId: s.slotId, marketType: 'MATCH_WINNER', selection: 'HOME' }));
    predictions[0] = { slotId: slots[0]!.slotId, marketType: 'CORRECT_SCORE', selection: '1-0' };

    const res = await request(server)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${playerReg.body.accessToken}`)
      .send({ contestId: created.body.id, predictions, idempotencyKey: randomUUID() })
      .expect(400);
    expect(res.body.code).toBe('INVALID_SLIP');
  });

  it('rejects an entry when the wallet balance is insufficient', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `poor-${id}@fiq.test`, username: `poor_${id}`, password: 'Passw0rdX!' };
    const admin = { email: `pooradmin-${id}@fiq.test`, username: `pooradmin_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const adminReg = await request(server).post('/api/v1/auth/register').send(admin).expect(201);
    const adminMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, adminMe.body.id, 'CONTEST_ADMIN');
    const adminLogin = await request(server).post('/api/v1/auth/login').send(loginBody(admin)).expect(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.accessToken}` };

    const fixtures = await seedFixtures(app, 5);
    const payload = buildContestPayload(`E2E Poor ${id}`, 1_000_000, fixtures); // huge fee, zero balance
    const created = await request(server)
      .post('/api/v1/admin/contests')
      .set(adminAuth)
      .send(payload)
      .expect(201);
    await request(server).post(`/api/v1/admin/contests/${created.body.id}/publish`).set(adminAuth).expect(201);

    const detail = await request(server).get(`/api/v1/contests/${created.body.slug}`).expect(200);
    const slots = (detail.body.slots as { slotNo: number; slotId: string; tier: string }[]).sort(
      (a, b) => a.slotNo - b.slotNo,
    );
    const marketByTier: Record<string, string> = {
      EASY: 'MATCH_WINNER',
      MEDIUM: 'BTTS',
      HARD: 'CLEAN_SHEET',
      EXPERT: 'CORRECT_SCORE',
    };
    const selectionByTier: Record<string, string> = {
      EASY: 'HOME',
      MEDIUM: 'YES',
      HARD: 'NONE',
      EXPERT: '1-1',
    };
    const predictions = slots.map((s) => ({
      slotId: s.slotId,
      marketType: marketByTier[s.tier]!,
      selection: selectionByTier[s.tier]!,
    }));

    const res = await request(server)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${playerReg.body.accessToken}`)
      .send({ contestId: created.body.id, predictions, idempotencyKey: randomUUID() })
      .expect(400);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });
});
