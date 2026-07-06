import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventTopics } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PaymentGatewayPort } from './ports/payment-gateway.port';
import { DepositsService } from './deposits.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayPort,
    private readonly deposits: DepositsService,
    private readonly outbox: OutboxService,
  ) {}

  async handlePaystack(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.gateway.verifyWebhook(rawBody, signature).valid) {
      throw new UnauthorizedException({ code: 'BAD_WEBHOOK_SIGNATURE' });
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      data: { reference?: string };
    };
    const reference = payload.data?.reference ?? 'unknown';
    const dedupeRef = `${payload.event}:${reference}`;

    // Exactly-once processing via the unique (provider, providerRef) key.
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'PAYSTACK',
          providerRef: dedupeRef,
          signature,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`duplicate webhook ignored: ${dedupeRef}`);
        return;
      }
      throw err;
    }

    let error: string | null = null;
    try {
      if (payload.event === 'charge.success' && payload.data.reference) {
        await this.deposits.settle(payload.data.reference);
      } else if (payload.event.startsWith('transfer.') && payload.data.reference) {
        // Withdrawal settlement is routed via the outbox → domain-events
        // worker (avoids a payments ↔ withdrawals module cycle).
        await this.outbox.emit(this.prisma, EventTopics.PaymentWebhookReceived, {
          provider: 'PAYSTACK',
          event: payload.event,
          reference: payload.data.reference,
        });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.logger.error(`webhook processing failed for ${dedupeRef}: ${error}`);
    }

    await this.prisma.webhookEvent.update({
      where: { provider_providerRef: { provider: 'PAYSTACK', providerRef: dedupeRef } },
      data: { processedAt: new Date(), error },
    });
  }
}
