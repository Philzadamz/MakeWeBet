import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentGatewayPort,
  type InitializeDepositInput,
  type InitializeDepositResult,
  type PayoutInput,
  type PayoutResult,
  type VerifyDepositResult,
  type WebhookVerification,
} from '../ports/payment-gateway.port';

/**
 * DEV-ONLY gateway: every deposit verifies as paid, every payout succeeds.
 * Selected automatically when no PAYSTACK_SECRET_KEY is configured outside
 * production; the module factory refuses to use it in production.
 */
@Injectable()
export class MockPaymentAdapter extends PaymentGatewayPort {
  readonly provider = 'PAYSTACK' as const; // masquerades so records stay realistic
  private readonly logger = new Logger(MockPaymentAdapter.name);
  private readonly amounts = new Map<string, bigint>();

  async initializeDeposit(input: InitializeDepositInput): Promise<InitializeDepositResult> {
    this.amounts.set(input.reference, input.amountMinor);
    this.logger.warn(`MOCK deposit init ${input.reference} for ${input.amountMinor} kobo`);
    return {
      provider: this.provider,
      authorizationUrl: `http://localhost:3000/dev/mock-checkout?reference=${input.reference}`,
      providerRef: input.reference,
    };
  }

  async verifyDeposit(reference: string): Promise<VerifyDepositResult> {
    return {
      provider: this.provider,
      providerRef: reference,
      status: 'SUCCEEDED',
      amountMinor: this.amounts.get(reference) ?? 0n,
      currency: 'NGN',
      channel: 'mock',
      paidAt: new Date(),
    };
  }

  async initiatePayout(input: PayoutInput): Promise<PayoutResult> {
    this.logger.warn(`MOCK payout ${input.reference}: ${input.amountMinor} kobo → ${input.accountName}`);
    return { provider: this.provider, providerRef: input.reference, status: 'PAID' };
  }

  verifyWebhook(): WebhookVerification {
    return { valid: false }; // mock never accepts real webhooks
  }
}
