import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AccessTokenPayload } from '../token.service';

export interface AuthenticatedUser {
  userId: string;
  role: string;
  emailVerified: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Status check hits the DB per request; when p95 demands it, swap for a
   * Redis-cached lookup invalidated on suspend/ban — never remove the check.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED' });
    }
    return { userId: user.id, role: user.role, emailVerified: user.emailVerifiedAt !== null };
  }
}
