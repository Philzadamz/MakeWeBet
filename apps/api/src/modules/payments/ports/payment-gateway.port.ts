import type { PaymentProvider } from '@prisma/client';

/**
 * PaymentGatewayPort — the ONLY surface the application layer sees.
 * Provider names (Paystack/Flutterwave/Monnify) appear exclusively inside
 * ../adapters. A composite router adapter implements failover: primary
 * provider first, fallback on initialization failure.
 */

export interface InitializeDepositInput {
  userId: string;
  email: string;
  amountMinor: bigint;
  currency: string;
  /** Our PaymentIntent id — becomes the provider reference. */
  reference: string;
  callbackUrl: string;
}

export interface InitializeDepositResult {
  provider: PaymentProvider;
  /** Hosted checkout URL the client redirects to. */
  authorizationUrl: string;
  providerRef: string;
}

export interface VerifyDepositResult {
  provider: PaymentProvider;
  providerRef: string;
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  amountMinor: bigint;
  currency: string;
  channel?: string;
  paidAt?: Date;
}

export interface PayoutInput {
  withdrawalId: string;
  amountMinor: bigint;
  currency: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  reference: string;
}

export interface PayoutResult {
  provider: PaymentProvider;
  providerRef: string;
  status: 'PROCESSING' | 'PAID' | 'FAILED';
  failReason?: string;
}

export interface WebhookVerification {
  valid: boolean;
  eventRef?: string;
}

export abstract class PaymentGatewayPort {
  abstract readonly provider: PaymentProvider;
  abstract initializeDeposit(input: InitializeDepositInput): Promise<InitializeDepositResult>;
  abstract verifyDeposit(reference: string): Promise<VerifyDepositResult>;
  abstract initiatePayout(input: PayoutInput): Promise<PayoutResult>;
  /** HMAC-verify a raw webhook body. Never trust an unverified webhook. */
  abstract verifyWebhook(rawBody: Buffer, signature: string): WebhookVerification;
}
