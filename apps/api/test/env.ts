/**
 * Single source of truth for the e2e test environment. Deliberately
 * isolated from dev: a separate database (fiq_test) and a separate Redis
 * logical DB index, so running the suite can never race with — or pollute
 * — data you're poking at manually in the dev stack.
 */

const PG_ROOT = process.env.TEST_PG_ROOT_URL ?? 'postgresql://fiq:fiq_dev_password@localhost:5432';
export const TEST_DATABASE_URL = `${PG_ROOT}/fiq_test?schema=public`;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/2';

/**
 * Set every env var the app validates before compiling a Nest testing
 * module. dotenv (used internally by @nestjs/config) never overwrites a
 * process.env key that's already set, so calling this before `.compile()`
 * guarantees the test DB/Redis win over whatever apps/api/.env has.
 */
export function applyTestEnv(): void {
  Object.assign(process.env, {
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
    PAYMENT_PRIMARY_PROVIDER: 'PAYSTACK', // no key configured -> MockPaymentAdapter
    SPORTS_PRIMARY_PROVIDER: 'API_FOOTBALL', // no key configured -> MockSportsAdapter
    PII_ENCRYPTION_KEY: '0'.repeat(64),
    SMTP_URL: '', // log-only EmailService in test
    EMAIL_FROM: 'Football IQ <no-reply@fiq.local>',
  });
}
