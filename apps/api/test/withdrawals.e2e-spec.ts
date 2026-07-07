import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { bootstrapApp, creditWallet, issueOtp, loginBody, promoteToRole, totalLedgerSum } from './helpers';

describe('withdrawals (e2e)', () => {
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

  async function addBankAccount(token: string) {
    const res = await request(server)
      .post('/api/v1/bank-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Test Player' })
      .expect(201);
    return res.body as { id: string; accountNumberMasked: string };
  }

  it('masks the account number and never returns the raw digits', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `bank-${id}@fiq.test`, username: `bank_${id}`, password: 'Passw0rdX!' };
    const reg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const bank = await addBankAccount(reg.body.accessToken);
    expect(bank.accountNumberMasked).toBe('••••••6789');

    const list = await request(server)
      .get('/api/v1/bank-accounts')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('0123456789');
  });

  it('places a ledger hold on request, pays out via the mock gateway, and clears the hold', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `wd-${id}@fiq.test`, username: `wd_${id}`, password: 'Passw0rdX!' };
    const financeAdmin = { email: `fadmin-${id}@fiq.test`, username: `fadmin_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerToken = playerReg.body.accessToken as string;
    const playerMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    await creditWallet(app, playerMe.body.id, 200_000n);
    const bank = await addBankAccount(playerToken);

    const adminReg = await request(server).post('/api/v1/auth/register').send(financeAdmin).expect(201);
    const adminMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, adminMe.body.id, 'FINANCE_ADMIN');
    const adminLogin = await request(server).post('/api/v1/auth/login').send(loginBody(financeAdmin)).expect(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.accessToken}` };

    // Exercise the real OTP-request endpoint for coverage, then mint a known
    // code the same way (issueCode supersedes the emailed one — we can't
    // read email in a test, so this is the e2e equivalent of "check inbox").
    await request(server)
      .post('/api/v1/withdrawals/otp')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(202);
    const otpCode = await issueOtp(app, playerMe.body.id, 'WITHDRAWAL');

    const WITHDRAW_MINOR = 80_000; // below the fraud-score amount threshold -> stays REQUESTED
    const withdrawal = await request(server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ amountMinor: WITHDRAW_MINOR, bankAccountId: bank.id, otpCode })
      .expect(201);
    expect(withdrawal.body.status).toBe('REQUESTED');
    const withdrawalId = withdrawal.body.id as string;

    // Hold placed: available debited immediately, before any admin action.
    const walletAfterHold = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterHold.body.balanceMinor).toBe(String(200_000 - WITHDRAW_MINOR));

    // A non-finance-admin (or unauthenticated) request must be refused.
    await request(server)
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/approve`)
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(403);

    // Mock gateway resolves PAID synchronously — no outbox round-trip needed.
    const approved = await request(server)
      .post(`/api/v1/admin/withdrawals/${withdrawalId}/approve`)
      .set(adminAuth)
      .expect(201);
    expect(approved.body.status).toBe('PAID');

    const mine = await request(server)
      .get('/api/v1/withdrawals/my')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(mine.body.find((w: { id: string }) => w.id === withdrawalId).status).toBe('PAID');

    // PAID settles pending -> external; available balance is unaffected by settlement itself.
    const walletAfterPaid = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterPaid.body.balanceMinor).toBe(String(200_000 - WITHDRAW_MINOR));

    const pendingAccount = await prisma.ledgerAccount.findUnique({
      where: {
        userId_type_currency: {
          userId: playerMe.body.id,
          type: 'USER_WITHDRAWAL_PENDING',
          currency: 'NGN',
        },
      },
    });
    expect(pendingAccount?.balanceMinor).toBe(0n);

    const paidNotification = await prisma.notification.findFirst({
      where: { userId: playerMe.body.id, type: 'withdrawal.paid' },
    });
    expect(paidNotification).not.toBeNull();

    expect(await totalLedgerSum(app)).toBe(0n);
  });

  it('reverses the hold and returns funds in full when an admin rejects', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `wdreject-${id}@fiq.test`, username: `wdreject_${id}`, password: 'Passw0rdX!' };
    const financeAdmin = { email: `fadmin2-${id}@fiq.test`, username: `fadmin2_${id}`, password: 'Passw0rdX!' };

    const playerReg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerToken = playerReg.body.accessToken as string;
    const playerMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    await creditWallet(app, playerMe.body.id, 200_000n);
    const bank = await addBankAccount(playerToken);

    const adminReg = await request(server).post('/api/v1/auth/register').send(financeAdmin).expect(201);
    const adminMe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${adminReg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, adminMe.body.id, 'FINANCE_ADMIN');
    const adminLogin = await request(server).post('/api/v1/auth/login').send(loginBody(financeAdmin)).expect(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.accessToken}` };

    const otpCode = await issueOtp(app, playerMe.body.id, 'WITHDRAWAL');
    const withdrawal = await request(server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ amountMinor: 60_000, bankAccountId: bank.id, otpCode })
      .expect(201);

    await request(server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.body.id}/reject`)
      .set(adminAuth)
      .send({ reason: 'Could not verify bank details' })
      .expect(201);

    const walletAfterReject = await request(server)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(walletAfterReject.body.balanceMinor).toBe('200000'); // fully restored

    const mine = await request(server)
      .get('/api/v1/withdrawals/my')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    expect(mine.body.find((w: { id: string }) => w.id === withdrawal.body.id).status).toBe('REJECTED');

    const failedNotification = await prisma.notification.findFirst({
      where: { userId: playerMe.body.id, type: 'withdrawal.failed' },
    });
    expect(failedNotification).not.toBeNull();
  });

  it('blocks an admin from approving their own withdrawal (maker-checker)', async () => {
    const id = randomUUID().slice(0, 8);
    const financeAdmin = { email: `selfapprove-${id}@fiq.test`, username: `selfapprove_${id}`, password: 'Passw0rdX!' };

    const reg = await request(server).post('/api/v1/auth/register').send(financeAdmin).expect(201);
    const me = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
    await promoteToRole(app, me.body.id, 'FINANCE_ADMIN');
    const login = await request(server).post('/api/v1/auth/login').send(loginBody(financeAdmin)).expect(200);
    const token = login.body.accessToken as string;

    await creditWallet(app, me.body.id, 200_000n);
    const bank = await addBankAccount(token);
    const otpCode = await issueOtp(app, me.body.id, 'WITHDRAWAL');
    const withdrawal = await request(server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: 60_000, bankAccountId: bank.id, otpCode })
      .expect(201);

    const res = await request(server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(res.body.code).toBe('SELF_APPROVAL');
  });

  it('rejects an invalid OTP code', async () => {
    const id = randomUUID().slice(0, 8);
    const player = { email: `badotp-${id}@fiq.test`, username: `badotp_${id}`, password: 'Passw0rdX!' };
    const reg = await request(server).post('/api/v1/auth/register').send(player).expect(201);
    const playerToken = reg.body.accessToken as string;
    const me = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    await creditWallet(app, me.body.id, 200_000n);
    const bank = await addBankAccount(playerToken);

    const res = await request(server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({ amountMinor: 60_000, bankAccountId: bank.id, otpCode: '000000' })
      .expect(400);
    expect(res.body.code).toBe('OTP_INVALID');
  });
});
