import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * EmailPort placeholder adapter. In development it logs (Mailpit SMTP wiring
 * lands with the full NotificationsModule); the interface is what matters —
 * callers never know the transport. Swap for SES/Resend in production.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly isDev: boolean;

  constructor(config: ConfigService) {
    this.isDev = config.get('NODE_ENV') !== 'production';
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (this.isDev) {
      this.logger.log(`✉️  to=${to} subject="${subject}"\n${body}`);
      return;
    }
    // TODO(production): SES/Resend adapter behind NotificationPort.
    this.logger.warn(`email transport not configured; dropping mail to ${to}`);
  }
}
