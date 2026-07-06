import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from '@fiq/contracts';
import { EventTopics } from '@fiq/contracts';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { EmailService } from '../notifications/email.service';
import { OtpService } from './otp.service';
import { TokenService, type IssuedTokens } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly email: EmailService,
    private readonly outbox: OutboxService,
  ) {}

  async register(dto: RegisterRequest): Promise<IssuedTokens> {
    const email = dto.email.toLowerCase();
    const username = dto.username.toLowerCase();
    const passwordHash = await argon2.hash(dto.password);

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            username,
            phone: dto.phone,
            passwordHash,
            // Wallet account is born with the user — no lazy-create races.
            ledgerAccounts: { create: { type: 'USER_AVAILABLE', currency: 'NGN' } },
          },
          select: { id: true },
        });
        await this.outbox.emit(tx, EventTopics.UserRegistered, { userId: user.id, email });
        return user.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_EXISTS',
          message: 'Email or username is already taken',
        });
      }
      throw err;
    }

    const code = await this.otp.issueCode(userId, 'EMAIL_VERIFY');
    await this.email.send(email, 'Verify your Football IQ account', `Your verification code is ${code}. It expires in 15 minutes.`);

    return this.tokens.issue(userId, 'USER');
  }

  async login(dto: LoginRequest, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const identifier = dto.identifier.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
        deletedAt: null,
      },
    });
    // argon2.verify on a dummy hash keeps timing uniform for unknown users.
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : (await argon2.hash(dto.password), false);
    if (!user || !valid) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password' });
    }
    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED', message: 'This account is disabled' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.tokens.issue(user.id, user.role, meta);
  }

  async verifyEmail(userId: string, code: string): Promise<void> {
    await this.otp.consume(userId, 'EMAIL_VERIFY', code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  /** Always succeeds from the caller's perspective — no account enumeration. */
  async forgotPassword(dto: ForgotPasswordRequest): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) return;
    const token = await this.otp.issueToken(user.id, 'PASSWORD_RESET');
    await this.email.send(
      user.email,
      'Reset your Football IQ password',
      `Use this link to reset your password: https://app.footballiq.example/reset-password?token=${token}&uid=${user.id}`,
    );
  }

  async resetPassword(dto: ResetPasswordRequest & { userId: string }): Promise<void> {
    await this.otp.consume(dto.userId, 'PASSWORD_RESET', dto.token);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: dto.userId },
        data: { passwordHash: await argon2.hash(dto.password) },
      }),
      // Credential change kills every live session.
      this.prisma.session.updateMany({
        where: { userId: dto.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Stable device fingerprint from client hints; real fingerprinting can replace this. */
  static fingerprint(ip?: string, userAgent?: string): string {
    return createHash('sha256').update(`${ip ?? ''}|${userAgent ?? ''}`).digest('hex');
  }
}
