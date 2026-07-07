/**
 * Per-route throttle limits are tuned for real traffic (a handful of
 * register/login attempts per minute is already generous for a human).
 * A single e2e spec file legitimately creates far more accounts than that
 * in seconds, so raise the ceiling under NODE_ENV=test — production and
 * dev behavior are untouched. (Vitest sets NODE_ENV=test before any source
 * file — including this one — is imported.)
 */
export function throttleLimit(prodLimit: number): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : prodLimit;
}
