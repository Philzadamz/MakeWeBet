import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from '@fiq/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

const RefreshRequest = z.object({ refreshToken: z.string().min(32) });
const VerifyEmailRequest = z.object({ code: z.string().regex(/^[0-9]{6}$/) });
const ResetPasswordBody = ResetPasswordRequest.extend({ userId: z.string().uuid() });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account (wallet is created atomically)' })
  register(@Body(new ZodValidationPipe(RegisterRequest)) dto: RegisterRequest) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(
    @Body(new ZodValidationPipe(LoginRequest)) dto: LoginRequest,
    @Req() req: Request,
  ) {
    return this.auth.login(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token (reuse revokes the family)' })
  refresh(@Body(new ZodValidationPipe(RefreshRequest)) dto: { refreshToken: string }) {
    return this.tokens.rotate(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(RefreshRequest)) dto: { refreshToken: string }) {
    await this.tokens.revokeByToken(dto.refreshToken);
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
