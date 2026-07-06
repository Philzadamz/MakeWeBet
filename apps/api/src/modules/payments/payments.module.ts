import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentGatewayPort } from './ports/payment-gateway.port';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { MockPaymentAdapter } from './adapters/mock.adapter';
import { DepositsService } from './deposits.service';
import { WebhooksService } from './webhooks.service';
import { PaymentsController } from './payments.controller';

/**
 * Payments bounded context. Port resolution:
 *   - Paystack when a secret key is configured (always in production).
 *   - Mock adapter in dev/test without keys, so local e2e needs no gateway.
 * Flutterwave/Monnify adapters + composite failover router land here later.
 */
@Module({
  imports: [WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaystackAdapter,
    MockPaymentAdapter,
    {
      provide: PaymentGatewayPort,
      inject: [ConfigService, PaystackAdapter, MockPaymentAdapter],
      useFactory: (config: ConfigService, paystack: PaystackAdapter, mock: MockPaymentAdapter) => {
        const hasKeys = Boolean(config.get('PAYSTACK_SECRET_KEY'));
        if (hasKeys) return paystack;
        if (config.get('NODE_ENV') === 'production') {
          throw new Error('No payment gateway configured for production');
        }
        return mock;
      },
    },
    DepositsService,
    WebhooksService,
  ],
  exports: [PaymentGatewayPort],
})
export class PaymentsModule {}
