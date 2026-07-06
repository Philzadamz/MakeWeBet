import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { TokenService, type IssuedTokens } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

const RefreshRequest = z.object({ refreshToken: z.string().min(32).optional() });
const VerifyEmailRequest = z.object({ code: z.string().regex(/^[0-9]{6}$/) });
const ResetPasswordBody = ResetPasswordRequest.extend({ userId: z.string().uuid() });

export const REFRESH_COOKIE = 'fiq_rt';

/**
 * Token delivery strategy:
 *   - Web: refresh token travels ONLY in an httpOnly SameSite=Strict cookie,
 *     path-scoped to the auth routes — it never touches JS-readable storage.
 *   - Mobile (Flutter): send `X-Client: mobile` to receive the refresh token
 *     in the response body for secure native storage.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookiePath: string;
  private readonly cookieMaxAgeMs: number;
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    config: ConfigService,
  ) {
    this.cookiePath = `/${config.getOrThrow<string>('API_GLOBAL_PREFIX')}/v1/auth`;
    this.cookieMaxAgeMs = config.getOrThrow<number>('JWT_REFRESH_TTL_SEC') * 1000;
    this.secureCookies = config.get('NODE_ENV') === 'production';
  }

  private deliver(res: Response, req: Request, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.secureCookies,
      path: this.cookiePath,
      maxAge: this.cookieMaxAgeMs,
    });
    const isMobile = req.headers['x-client'] === 'mobile';
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      ...(isMobile ? { refreshToken: tokens.refreshToken } : {}),
    };
  }

  private refreshTokenFrom(req: Request, body: { refreshToken?: string }): string {
    const token = body.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) throw new UnauthorizedException({ code: 'NO_REFRESH_TOKEN' });
    return token;
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({ name: 'x-client', required: false, description: '"mobile" to receive refreshToken in body' })
  @ApiOperation({ summary: 'Create an account (wallet is created atomically)' })
  async register(
    @Body(new ZodValidationPipe(RegisterRequest)) dto: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(res, req, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(LoginRequest)) dto: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.deliver(res, req, tokens);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token — cookie (web) or body (mobile); reuse revokes the family' })
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequest)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rotated = await this.tokens.rotate(this.refreshTokenFrom(req, body));
    return this.deliver(res, req, rotated);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(RefreshRequest)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (token) await this.tokens.revokeByToken(token);
    res.clearCookie(REFRESH_COOKIE, { path: this.cookiePath });
  }

  @Post('verify-email')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async verifyEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(VerifyEmailRequest)) dto: { code: string },
  ) {
    await this.auth.verifyEmail(user.userId, dto.code);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequest)) dto: ForgotPasswordRequest,
  ) {
    await this.auth.forgotPassword(dto);
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordBody))
    dto: ResetPasswordRequest & { userId: string },
  ) {
    await this.auth.resetPassword(dto);
  }
}
