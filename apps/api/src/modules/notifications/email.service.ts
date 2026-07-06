import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Email adapter behind the notification abstraction. Transport comes from
 * SMTP_URL — Mailpit (smtp://localhost:1025) in dev, SES/any SMTP relay in
 * production. Without a configured URL it logs in dev and warns loudly in
 * production; email failures never break the calling flow (OTPs can be
 * re-requested; money paths must not depend on SMTP availability).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transport?: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const smtpUrl = config.get<string>('SMTP_URL');
    if (smtpUrl) this.transport = createTransport(smtpUrl);
    this.from = config.get<string>('EMAIL_FROM') ?? 'Football IQ <no-reply@fiq.local>';
    if (!smtpUrl && config.get('NODE_ENV') === 'production') {
      this.logger.error('SMTP_URL not configured — production emails will be dropped');
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transport) {
      this.logger.log(`✉️  (no transport) to=${to} subject="${subject}"\n${body}`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text: body });
      this.logger.log(`✉️  sent to=${to} subject="${subject}"`);
    } catch (err) {
      this.logger.error(`email to ${to} failed: ${String(err)}`);
    }
  }
}
