/**
 * Single source of truth for the e2e test environment. Deliberately
 * isolated from dev: a separate database (fiq_test) and a separate Redis
 * logical DB index, so running the suite can never race with — or pollute
 * — data you're poking at manually in the dev stack.
 *
 * WHY THIS IS WIRED THROUGH vitest's `test.env` (see vitest.e2e.config.ts)
 * AND NOT ONLY applied inside bootstrapApp():
 *   - Vitest loads apps/api/.env into process.env at worker startup.
 *   - @nestjs/config's forRoot() executes AT IMPORT TIME of app.module and
 *     snapshots {...envFile, ...process.env} into its validated config,
 *     which ConfigService.get() prefers ever after.
 *   - So anything set after import (e.g. in bootstrapApp) is too late: the
 *     dev .env's real Paystack key leaked into e2e (real payout API calls
 *     with fake bank data → 400s), and worse, the dev REDIS_URL leaked in,
 *     letting a running dev server steal the test app's BullMQ jobs — the
 *     "worker silently drops jobs" mystery was exactly this.
 * `test.env` is applied by vitest BEFORE test files (and app.module) are
 * imported, so the snapshot is taken with these values.
 */

const PG_ROOT = process.env.TEST_PG_ROOT_URL ?? 'postgresql://fiq:fiq_dev_password@localhost:5432';
export const TEST_DATABASE_URL = `${PG_ROOT}/fiq_test?schema=public`;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/2';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '4001',
  API_GLOBAL_PREFIX: 'api',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  JWT_ACCESS_SECRET: 'e2e-test-secret-do-not-use-in-prod-32c',
  JWT_ACCESS_TTL_SEC: '900',
  JWT_REFRESH_TTL_SEC: '2592000',
  CORS_ORIGINS: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
  RUN_WORKERS: 'true',
  // Keys pinned EMPTY → mock gateway/sports adapters are always selected,
  // no matter what real keys live in the dev .env.
  PAYMENT_PRIMARY_PROVIDER: 'PAYSTACK',
  PAYSTACK_SECRET_KEY: '',
  PAYSTACK_WEBHOOK_SECRET: '',
  SPORTS_PRIMARY_PROVIDER: 'API_FOOTBALL',
  API_FOOTBALL_KEY: '',
  FOOTBALL_DATA_KEY: '',
  SPORTMONKS_KEY: '',
  PII_ENCRYPTION_KEY: '0'.repeat(64),
  SMTP_URL: '', // log-only EmailService in test
  EMAIL_FROM: 'Football IQ <no-reply@fiq.local>',
};

/** Belt-and-braces for code paths that read process.env directly (Prisma). */
export function applyTestEnv(): void {
  Object.assign(process.env, TEST_ENV);
}
