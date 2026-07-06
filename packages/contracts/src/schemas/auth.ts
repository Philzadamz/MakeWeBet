import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a digit');

export const RegisterRequest = z.object({
  email: z.string().email().max(254),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscore only'),
  password,
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/)
    .optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  identifier: z.string().min(3).max(254), // email or username
  password: z.string().min(1).max(128),
  deviceName: z.string().max(100).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const VerifyOtpRequest = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
  purpose: z.enum(['EMAIL_VERIFY', 'PASSWORD_RESET', 'WITHDRAWAL', 'LOGIN']),
});
export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequest>;

export const ForgotPasswordRequest = z.object({ email: z.string().email() });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.object({
  token: z.string().min(20),
  password,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const AuthTokensResponse = z.object({
  accessToken: z.string(),
  /** Refresh token is set as an httpOnly cookie on web; returned in body for mobile. */
  refreshToken: z.string().optional(),
  expiresIn: z.number(),
});
export type AuthTokensResponse = z.infer<typeof AuthTokensResponse>;
