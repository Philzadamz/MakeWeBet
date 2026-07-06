import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentGatewayPort,
  type InitializeDepositInput,
  type InitializeDepositResult,
  type PayoutInput,
  type PayoutResult,
  type VerifyDepositResult,
  type WebhookVerification,
} from '../ports/payment-gateway.port';

@Injectable()
export class PaystackAdapter extends PaymentGatewayPort {
  readonly provider = 'PAYSTACK' as const;
  private readonly http: AxiosInstance;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    super();
    this.http = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: { Authorization: `Bearer ${config.get('PAYSTACK_SECRET_KEY')}` },
      timeout: 15_000,
    });
    this.webhookSecret =
      config.get('PAYSTACK_WEBHOOK_SECRET') || config.get('PAYSTACK_SECRET_KEY') || '';
  }

  async initializeDeposit(input: InitializeDepositInput): Promise<InitializeDepositResult> {
    const { data } = await this.http.post('/transaction/initialize', {
      email: input.email,
      amount: Number(input.amountMinor), // Paystack expects kobo
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
    });
    return {
      provider: this.provider,
      authorizationUrl: data.data.authorization_url,
      providerRef: data.data.reference,
    };
  }

  async verifyDeposit(reference: string): Promise<VerifyDepositResult> {
    const { data } = await this.http.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    const tx = data.data;
    return {
      provider: this.provider,
      providerRef: tx.reference,
      status: tx.status === 'success' ? 'SUCCEEDED' : tx.status === 'failed' ? 'FAILED' : 'PENDING',
      amountMinor: BigInt(tx.amount),
      currency: tx.currency,
      channel: tx.channel,
      paidAt: tx.paid_at ? new Date(tx.paid_at) : undefined,
    };
  }

  async initiatePayout(input: PayoutInput): Promise<PayoutResult> {
    const recipient = await this.http.post('/transferrecipient', {
      type: 'nuban',
      name: input.accountName,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency,
    });
    const { data } = await this.http.post('/transfer', {
      source: 'balance',
      amount: Number(input.amountMinor),
      recipient: recipient.data.data.recipient_code,
      reference: input.reference,
      reason: `FIQ withdrawal ${input.withdrawalId}`,
    });
    const status = data.data.status;
    return {
      provider: this.provider,
      providerRef: data.data.reference ?? input.reference,
      status: status === 'success' ? 'PAID' : status === 'failed' ? 'FAILED' : 'PROCESSING',
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): WebhookVerification {
    const expected = createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature ?? '');
    const valid = a.length === b.length && timingSafeEqual(a, b);
    return { valid };
  }
}
