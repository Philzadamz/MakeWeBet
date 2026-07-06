import { z } from 'zod';

/**
 * Environment contract — the process refuses to boot on invalid config.
 * Never read process.env outside this file.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  API_GLOBAL_PREFIX: z.string().default('api'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().default(30 * 24 * 3600),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Run BullMQ workers in this process (true in dev; false on API-only pods). */
  RUN_WORKERS: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  PAYMENT_PRIMARY_PROVIDER: z.enum(['PAYSTACK', 'FLUTTERWAVE', 'MONNIFY']).default('PAYSTACK'),
  PAYSTACK_SECRET_KEY: z.string().optional().default(''),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional().default(''),
  FLUTTERWAVE_SECRET_KEY: z.string().optional().default(''),
  MONNIFY_SECRET_KEY: z.string().optional().default(''),

  SPORTS_PRIMARY_PROVIDER: z
    .enum(['API_FOOTBALL', 'SPORTMONKS', 'FOOTBALL_DATA'])
    .default('API_FOOTBALL'),
  API_FOOTBALL_KEY: z.string().optional().default(''),
  SPORTMONKS_KEY: z.string().optional().default(''),
  FOOTBALL_DATA_KEY: z.string().optional().default(''),

  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, '32-byte hex key required'),

  /** SMTP transport, e.g. smtp://localhost:1025 (Mailpit) or SES SMTP creds. */
  SMTP_URL: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Football IQ <no-reply@fiq.local>'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
