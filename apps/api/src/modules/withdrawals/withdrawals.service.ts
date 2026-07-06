import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventTopics, type RequestWithdrawalRequest } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { LedgerService } from '../wallet/ledger/ledger.service';
import { InsufficientFundsError } from '../wallet/ledger/ledger.errors';
import { WalletAccountsService } from '../wallet/wallet-accounts.service';
import { PaymentGatewayPort } from '../payments/ports/payment-gateway.port';
import { OtpService } from '../auth/otp.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { BankAccountsService } from './bank-accounts.service';
import { FraudService } from './fraud.service';

const REVIEW_THRESHOLD = 70;

/**
 * Withdrawal state machine:
 *   REQUESTED/UNDER_REVIEW ──approve──▶ APPROVED ──payout──▶ PROCESSING|PAID
 *                          └──reject──▶ REJECTED (hold reversed)
 *   PROCESSING ──webhook──▶ PAID | FAILED (hold reversed)
 *
 * Money: request places a HOLD (available → withdrawal_pending); PAID settles
 * (pending → external); reject/failure reverses (pending → available).
 * Funds are therefore never in limbo and never double-spendable.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: WalletAccountsService,
    private readonly gateway: PaymentGatewayPort,
    private readonly otp: OtpService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly bankAccounts: BankAccountsService,
    private readonly fraud: FraudService,
    private readonly outbox: OutboxService,
  ) {}

  async requestOtp(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const code = await this.otp.issueCode(userId, 'WITHDRAWAL');
    await this.email.send(
      user.email,
      'Confirm your withdrawal',
      `Your withdrawal confirmation code is ${code}. It expires in 15 minutes.`,
    );
  }

  async request(userId: string, dto: RequestWithdrawalRequest) {
    await this.otp.consume(userId, 'WITHDRAWAL', dto.otpCode);
    // Ownership check — throws if the bank account isn't the caller's.
    await this.bankAccounts.decryptedFor(userId, dto.bankAccountId);

    const amountMinor = BigInt(dto.amountMinor);
    const fraudScore = await this.fraud.scoreWithdrawal(userId, amountMinor);

    try {
      const withdrawal = await this.prisma.$transaction(async (tx) => {
        const available = await this.accounts.userAvailable(userId, tx);
        const pending = await this.getOrCreatePendingAccount(userId, tx);

        const w = await tx.withdrawal.create({
          data: {
            userId,
            bankAccountId: dto.bankAccountId,
            amountMinor,
            fraudScore,
            status: fraudScore >= REVIEW_THRESHOLD ? 'UNDER_REVIEW' : 'REQUESTED',
          },
        });
        await this.ledger.post(
          {
            type: 'WITHDRAWAL_HOLD',
            idempotencyKey: `withdrawal-hold:${w.id}`,
            description: 'Withdrawal hold',
            lines: [
              { accountId: available.id, amountMinor: -amountMinor },
              { accountId: pending.id, amountMinor },
            ],
            metadata: { withdrawalId: w.id },
          },
          tx,
        );
        await this.outbox.emit(tx, EventTopics.WithdrawalRequested, {
          withdrawalId: w.id,
          userId,
          amountMinor: amountMinor.toString(),
          fraudScore,
        });
        return w;
      });
      return { id: withdrawal.id, status: withdrawal.status, fraudScore };
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_FUNDS',
          message: 'Withdrawal exceeds your available balance',
        });
      }
      throw err;
    }
  }

  async myWithdrawals(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amountMinor: true,
        status: true,
        requestedAt: true,
        resolvedAt: true,
        failReason: true,
      },
    });
  }

  // ------------------------------------------------------------- admin

  async listForReview(status?: string) {
    return this.prisma.withdrawal.findMany({
      where: status
        ? { status: status as never }
        : { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'PROCESSING'] } },
      orderBy: { requestedAt: 'asc' },
      include: {
        user: { select: { username: true, email: true } },
        bankAccount: { select: { bankName: true, accountName: true } },
      },
    });
  }

  async approve(adminId: string, withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal) throw new NotFoundException({ code: 'WITHDRAWAL_NOT_FOUND' });
    if (withdrawal.status !== 'REQUESTED' && withdrawal.status !== 'UNDER_REVIEW') {
      throw new ConflictException({ code: 'INVALID_STATUS', message: `Cannot approve from ${withdrawal.status}` });
    }
    // Maker-checker: the requester can never approve their own payout.
    if (withdrawal.userId === adminId) {
      throw new ConflictException({ code: 'SELF_APPROVAL', message: 'Cannot approve your own withdrawal' });
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'APPROVED', reviewedById: adminId },
    });
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: 'withdrawal.approve',
      entityType: 'Withdrawal',
      entityId: withdrawalId,
      before: { status: withdrawal.status },
      after: { status: 'APPROVED' },
    });

    return this.initiatePayout(withdrawalId);
  }

  async reject(adminId: string, withdrawalId: string, reason: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundException({ code: 'WITHDRAWAL_NOT_FOUND' });
    if (withdrawal.status !== 'REQUESTED' && withdrawal.status !== 'UNDER_REVIEW') {
      throw new ConflictException({ code: 'INVALID_STATUS' });
    }

    await this.reverseHold(withdrawalId, 'REJECTED', reason);
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: 'withdrawal.reject',
      entityType: 'Withdrawal',
      entityId: withdrawalId,
      after: { status: 'REJECTED', reason },
    });
    return { id: withdrawalId, status: 'REJECTED' };
  }

  /** Called after approval and by transfer webhooks (idempotent transitions). */
  private async initiatePayout(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
    const bank = await this.bankAccounts.decryptedFor(withdrawal.userId, withdrawal.bankAccountId);

    const result = await this.gateway.initiatePayout({
      withdrawalId,
      amountMinor: withdrawal.amountMinor,
      currency: 'NGN',
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      reference: withdrawalId,
    });

    if (result.status === 'FAILED') {
      await this.reverseHold(withdrawalId, 'FAILED', result.failReason ?? 'Gateway rejected transfer');
      return { id: withdrawalId, status: 'FAILED' };
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'PROCESSING', provider: result.provider, providerRef: result.providerRef },
    });
    if (result.status === 'PAID') await this.settle(withdrawalId, true);
    return { id: withdrawalId, status: result.status };
  }

  /** Terminal settlement from gateway confirmation (webhook or sync result). */
  async settle(withdrawalId: string, success: boolean, failReason?: string): Promise<void> {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || withdrawal.status === 'PAID' || withdrawal.status === 'FAILED') return;

    if (!success) {
      await this.reverseHold(withdrawalId, 'FAILED', failReason ?? 'Transfer failed');
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const pending = await this.getOrCreatePendingAccount(withdrawal.userId, tx);
      const external = await this.accounts.system('EXTERNAL', tx);
      await this.ledger.post(
        {
          type: 'WITHDRAWAL_SETTLE',
          idempotencyKey: `withdrawal-settle:${withdrawalId}`,
          description: 'Withdrawal paid out',
          lines: [
            { accountId: pending.id, amountMinor: -withdrawal.amountMinor },
            { accountId: external.id, amountMinor: withdrawal.amountMinor },
          ],
          metadata: { withdrawalId },
        },
        tx,
      );
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PAID', resolvedAt: new Date() },
      });
      await this.notifications.notify(
        withdrawal.userId,
        'withdrawal.paid',
        'Withdrawal completed 💸',
        'Your withdrawal has been paid to your bank account.',
        { withdrawalId, amountMinor: withdrawal.amountMinor.toString() },
        tx,
      );
      await this.outbox.emit(tx, EventTopics.WithdrawalPaid, {
        withdrawalId,
        userId: withdrawal.userId,
        amountMinor: withdrawal.amountMinor.toString(),
      });
    });
    this.logger.log(`withdrawal ${withdrawalId} paid`);
  }

  private async reverseHold(
    withdrawalId: string,
    status: 'REJECTED' | 'FAILED' | 'REVERSED',
    reason: string,
  ): Promise<void> {
    const withdrawal = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await this.prisma.$transaction(async (tx) => {
      const pending = await this.getOrCreatePendingAccount(withdrawal.userId, tx);
      const available = await this.accounts.userAvailable(withdrawal.userId, tx);
      await this.ledger.post(
        {
          type: 'WITHDRAWAL_REVERSAL',
          // One hold per withdrawal ⇒ at most one reversal — replay-safe.
          idempotencyKey: `withdrawal-reverse:${withdrawalId}`,
          description: `Withdrawal ${status.toLowerCase()} — funds returned`,
          lines: [
            { accountId: pending.id, amountMinor: -withdrawal.amountMinor },
            { accountId: available.id, amountMinor: withdrawal.amountMinor },
          ],
          metadata: { withdrawalId, reason },
        },
        tx,
      );
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status, failReason: reason, resolvedAt: new Date() },
      });
      await this.notifications.notify(
        withdrawal.userId,
        'withdrawal.failed',
        'Withdrawal returned',
        `Your withdrawal was ${status.toLowerCase()}: ${reason}. Funds are back in your wallet.`,
        { withdrawalId },
        tx,
      );
    });
  }

  private async getOrCreatePendingAccount(userId: string, tx: Parameters<LedgerService['post']>[1]) {
    const db = tx ?? this.prisma;
    const existing = await db!.ledgerAccount.findUnique({
      where: {
        userId_type_currency: { userId, type: 'USER_WITHDRAWAL_PENDING', currency: 'NGN' },
      },
    });
    if (existing) return existing;
    return db!.ledgerAccount.create({
      data: { userId, type: 'USER_WITHDRAWAL_PENDING', currency: 'NGN' },
    });
  }
}
