import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventTopics } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { LedgerService } from '../wallet/ledger/ledger.service';
import { WalletAccountsService } from '../wallet/wallet-accounts.service';
import { PaymentGatewayPort } from './ports/payment-gateway.port';

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayPort,
    private readonly ledger: LedgerService,
    private readonly accounts: WalletAccountsService,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  async initiate(userId: string, amountMinor: bigint) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId,
        provider: this.gateway.provider,
        providerRef: '', // set below — our intent id doubles as the reference
        amountMinor,
        status: 'INITIATED',
      },
    });
    const init = await this.gateway.initializeDeposit({
      userId,
      email: user.email,
      amountMinor,
      currency: 'NGN',
      reference: intent.id,
      callbackUrl: `${this.appUrl}/wallet/deposit/callback`,
    });
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { providerRef: init.providerRef, status: 'PENDING' },
    });
    return { reference: intent.id, authorizationUrl: init.authorizationUrl };
  }

  /**
   * Settle a deposit by reference. Called from BOTH the webhook and the
   * client callback verifier — safe because the ledger idempotency key
   * makes double settlement a no-op.
   */
  async settle(reference: string): Promise<{ status: string }> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: reference } });
    if (!intent) throw new NotFoundException({ code: 'INTENT_NOT_FOUND' });
    if (intent.status === 'SUCCEEDED') return { status: 'SUCCEEDED' };

    const verification = await this.gateway.verifyDeposit(reference);
    if (verification.status === 'PENDING') return { status: 'PENDING' };

    if (verification.status === 'FAILED') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'FAILED', failReason: 'Provider reported failure' },
      });
      return { status: 'FAILED' };
    }

    // Amount check: credit what the PROVIDER says was paid, never the intent.
    if (verification.amountMinor !== intent.amountMinor) {
      this.logger.warn(
        `deposit ${reference}: amount mismatch intent=${intent.amountMinor} provider=${verification.amountMinor}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const userAccount = await this.accounts.userAvailable(intent.userId, tx);
      const clearing = await this.accounts.system('GATEWAY_CLEARING', tx);
      await this.ledger.post(
        {
          type: 'DEPOSIT',
          idempotencyKey: `deposit:${intent.id}`,
          description: `Wallet deposit via ${verification.provider}`,
          lines: [
            { accountId: clearing.id, amountMinor: -verification.amountMinor },
            { accountId: userAccount.id, amountMinor: verification.amountMinor },
          ],
          metadata: { intentId: intent.id, channel: verification.channel },
        },
        tx,
      );
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'SUCCEEDED',
          settledAt: new Date(),
          channel: verification.channel,
          amountMinor: verification.amountMinor,
        },
      });
      await this.outbox.emit(tx, EventTopics.WalletCredited, {
        userId: intent.userId,
        amountMinor: verification.amountMinor.toString(),
        source: 'DEPOSIT',
        reference: intent.id,
      });
    });
    return { status: 'SUCCEEDED' };
  }

  async assertOwnership(reference: string, userId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: reference },
      select: { userId: true },
    });
    if (!intent || intent.userId !== userId) {
      throw new BadRequestException({ code: 'INTENT_NOT_FOUND' });
    }
  }
}
