import { BadRequestException, Injectable } from '@nestjs/common';
import type { OtpPurpose } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const hash = (v: string): string => createHash('sha256').update(v).digest('hex');

const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  /** 6-digit numeric code (email/SMS-friendly). Invalidates prior codes. */
  async issueCode(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.persist(userId, purpose, hash(code));
    return code;
  }

  /** Long opaque token for password-reset links. */
  async issueToken(userId: string, purpose: OtpPurpose): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.persist(userId, purpose, hash(token));
    return token;
  }

  private async persist(userId: string, purpose: OtpPurpose, codeHash: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() }, // supersede older codes
      }),
      this.prisma.otpCode.create({
        data: { userId, purpose, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      }),
    ]);
  }

  /** Verify and consume. Throws on invalid/expired/too many attempts. */
  async consume(userId: string, purpose: OtpPurpose, value: string): Promise<void> {
    const record = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Code is invalid or expired' });
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException({ code: 'OTP_LOCKED', message: 'Too many attempts — request a new code' });
    }
    if (record.codeHash !== hash(value)) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Code is invalid or expired' });
    }
    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }
}
