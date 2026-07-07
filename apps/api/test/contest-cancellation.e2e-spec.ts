import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { bootstrapApp, buildContestPayload, creditWallet, loginBody, promoteToRole, seedFixtures } from './helpers';

describe('contest cancellation (e2e)', () => {
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

  async function balancedSlip(server: import('http').Server, slug: string) {
    const detail = await request(server).get(`/api/v1/contests/${slug}`).expect(200);
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
    return slots.map((s) => ({
      slotId: s.slotId,
      marketType: marketByTier[s.tier]!,
      selection: selectionByTier[s.tier]!,
    }));
  }

  it('refunds every active entry and zeroes the escrow when a published contest is cancelled', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `cancel-${id}@fiq.test`, username: `cancel_${id}`, password: 'Passw0rdX!' };
    const admin = { email: `canceladmin-${id}@fiq.test`, username: `canceladmin_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerToken = playerReg.body.accessToken as string;
    const playerMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerToken}`)
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

    const ENTRY_FEE_MINOR = 50_000;
    const fixtures = await seedFixtures(app, 5);
    const payload = buildContestPayload(`E2E Cancel Me ${id}`, ENTRY_FEE_MINOR, fixtures);
    const created = await request(server)
      .post('/api/v1/admin/contests')
      .set(adminAuth)
      .send(payload)
      .expect(201);
    const contestId = created.body.id as string;
    await request(server).post(`/api/v1/admin/contests/${contestId}/publish`).set(adminAuth).expect(201);

    const predictions = await balancedSlip(server, created.body.slug);
    await request(server)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ contestId, predictions, idempotencyKey: randomUUID() })
      .expect(201);

    const walletAfterEntry = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterEntry.body.balanceMinor).toBe(String(500_000 - ENTRY_FEE_MINOR));

    await request(server)
      .post(`/api/v1/admin/contests/${contestId}/cancel`)
      .set(adminAuth)
      .send({ reason: 'E2E test cancellation' })
      .expect(201);

    const walletAfterCancel = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterCancel.body.balanceMinor).toBe('500000');

    const entry = await prisma.entry.findFirstOrThrow({ where: { contestId } });
    expect(entry.status).toBe('REFUNDED');

    const escrow = await prisma.ledgerAccount.findUnique({ where: { contestId } });
    expect(escrow?.balanceMinor).toBe(0n);

    const contest = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
    expect(contest.status).toBe('CANCELLED');

    const notification = await prisma.notification.findFirst({
      where: { userId: playerMe.body.id, type: 'contest.cancelled' },
    });
    expect(notification).not.toBeNull();

    // Cancelling an already-cancelled contest is rejected, not a silent no-op.
    const secondCancel = await request(server)
      .post(`/api/v1/admin/contests/${contestId}/cancel`)
      .set(adminAuth)
      .send({ reason: 'Should not work twice' })
      .expect(409);
    expect(secondCancel.body.code).toBe('INVALID_STATUS');
  });
});
