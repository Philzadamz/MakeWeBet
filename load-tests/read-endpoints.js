import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Load test for the read-heavy public surface — the paths the architecture
 * doc's scale targets are about: contest list, contest detail, and the
 * leaderboard (target: 5,000+ QPS during live matches, cache-served;
 * p95 < 250ms for reads).
 *
 * setup() bootstraps a real contest via the seeded dev admin
 * (admin@fiq.local, from prisma/seed.ts) so every VU hits real data, not a
 * cache-miss-only synthetic slug. Requires the API + a seeded dev/staging
 * DB to be reachable at BASE_URL.
 *
 * Usage:
 *   k6 run load-tests/read-endpoints.js                      # quick local smoke run
 *   k6 run -e VUS=200 -e DURATION=2m -e BASE_URL=https://staging.example/api/v1 load-tests/read-endpoints.js
 *
 * IMPORTANT — the global per-IP rate limit (120 req/60s, see AppModule's
 * ThrottlerModule) applies here exactly as it would to any real client,
 * and a k6 process is a SINGLE source IP no matter how many VUs it runs.
 * At 4 requests/iteration that ceiling is ~30 iterations/min from one IP
 * — realistic production traffic spreads that across many user IPs, but a
 * local/staging load run from one machine will get 429s well before any
 * real backend capacity limit if VUS is pushed high. The default here
 * stays comfortably under that ceiling for a correctness smoke run;
 * genuine throughput/capacity testing needs the target's rate limiter
 * temporarily raised (or the test runner's IP allowlisted) — coordinate
 * with whoever owns that environment before cranking VUS up.
 */

const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:4000/api/v1';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL ?? 'admin@fiq.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD ?? 'Admin123!ChangeMe';
const VUS = Number(__ENV.VUS ?? 3);
const DURATION = __ENV.DURATION ?? '10s';

const leaderboardDuration = new Trend('leaderboard_duration', true);
const contestDetailDuration = new Trend('contest_detail_duration', true);

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:health}': ['p(95)<100'],
    'http_req_duration{endpoint:contests_list}': ['p(95)<250'],
    'http_req_duration{endpoint:contest_detail}': ['p(95)<250'],
    'http_req_duration{endpoint:leaderboard}': ['p(95)<250'],
  },
};

const TIER_TEMPLATE = ['EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HARD', 'HARD', 'HARD', 'EXPERT', 'EXPERT'];

/** Runs once before the load starts: build a real, published contest to hammer. */
export function setup() {
  const login = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(login, { 'admin login succeeded': (r) => r.status === 200 });
  const adminToken = login.json('accessToken');
  const auth = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // Pull tomorrow's date so fixtures kick off in the future regardless of
  // what time this runs — the mock provider fabricates deterministic
  // fixtures per calendar date.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  http.post(`${BASE_URL}/admin/fixtures/sync`, JSON.stringify({ date: tomorrow }), { headers: auth });

  const fixturesRes = http.get(`${BASE_URL}/admin/fixtures?pending=schedulable`, { headers: auth });
  const fixtures = fixturesRes.json().slice(0, 5);
  if (fixtures.length < 5) {
    throw new Error(`load-test setup: need 5 schedulable fixtures, got ${fixtures.length}`);
  }

  const payload = {
    title: `Load Test ${new Date().toISOString()}`,
    entryFeeMinor: 100_00,
    currency: 'NGN',
    fixtures: fixtures.map((f, i) => ({ fixtureId: f.id, order: i + 1 })),
    slots: TIER_TEMPLATE.map((tier, i) => ({
      slotNo: i + 1,
      fixtureId: fixtures[Math.floor(i / 2)].id,
      tier,
    })),
  };
  const created = http.post(`${BASE_URL}/admin/contests`, JSON.stringify(payload), { headers: auth });
  check(created, { 'contest created': (r) => r.status === 201 });
  const slug = created.json('slug');
  const contestId = created.json('id');

  const published = http.post(`${BASE_URL}/admin/contests/${contestId}/publish`, null, { headers: auth });
  check(published, { 'contest published': (r) => r.status === 201 });

  return { slug };
}

export default function (data) {
  const health = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
  check(health, { 'health 200': (r) => r.status === 200 });

  const list = http.get(`${BASE_URL}/contests`, { tags: { endpoint: 'contests_list' } });
  check(list, { 'contests list 200': (r) => r.status === 200 });

  const detail = http.get(`${BASE_URL}/contests/${data.slug}`, { tags: { endpoint: 'contest_detail' } });
  check(detail, { 'contest detail 200': (r) => r.status === 200 });
  contestDetailDuration.add(detail.timings.duration);

  const leaderboard = http.get(`${BASE_URL}/contests/${data.slug}/leaderboard`, {
    tags: { endpoint: 'leaderboard' },
  });
  check(leaderboard, { 'leaderboard 200': (r) => r.status === 200 });
  leaderboardDuration.add(leaderboard.timings.duration);

  sleep(0.5);
}
