import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/**
 * Access JWTs are short-lived and stateless. Refresh tokens are opaque
 * random values stored hashed, rotated on every use, and grouped into
 * FAMILIES: presenting an already-consumed token is treated as theft and
 * revokes the whole family (RFC 6819 refresh-token reuse detection).
 */
@Injectable()
export class TokenService {
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.accessTtlSec = config.getOrThrow<number>('JWT_ACCESS_TTL_SEC');
    this.refreshTtlSec = config.getOrThrow<number>('JWT_REFRESH_TTL_SEC');
  }

  async issue(
    userId: string,
    role: UserRole,
    meta: { deviceId?: string; ip?: string; userAgent?: string; familyId?: string } = {},
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role } satisfies AccessTokenPayload,
      { expiresIn: this.accessTtlSec },
    );
    const raw = randomBytes(48).toString('hex');
    await this.prisma.session.create({
      data: {
        userId,
        deviceId: meta.deviceId,
        familyId: meta.familyId ?? randomUUID(),
        refreshTokenHash: hashToken(raw),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
      },
    });
    return { accessToken, refreshToken: raw, expiresIn: this.accessTtlSec };
  }

  async rotate(rawRefreshToken: string): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
      include: { user: { select: { id: true, role: true, status: true } } },
    });
    if (!session) throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN' });

    if (session.revokedAt || session.consumedAt) {
      // Reuse detected — burn the whole family.
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REUSE' });
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_EXPIRED' });
    }
    if (session.user.status === 'BANNED' || session.user.status === 'SUSPENDED') {
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED' });
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { consumedAt: new Date() },
    });
    return this.issue(session.user.id, session.user.role, {
      familyId: session.familyId,
      deviceId: session.deviceId ?? undefined,
    });
  }

  /** Logout: revoke the presented session's entire family. */
  async revokeByToken(rawRefreshToken: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
      select: { familyId: true },
    });
    if (!session) return; // logout is idempotent
    await this.prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
