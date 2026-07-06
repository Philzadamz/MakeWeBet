# Football IQ Challenge — Phase 1: Product Architecture

**Document status:** v1.0 — Foundation document for all subsequent phases
**Audience:** Engineering, Product, DevOps, Security
**Last updated:** 2026-07-06

---

## 1. Product Summary

Football IQ Challenge is a **skill-based football prediction contest platform**. Users pay an
entry fee to join admin-curated contests of 5–10 matches, submit exactly 10 predictions across a
balanced difficulty ladder (2 Easy / 3 Medium / 3 Hard / 2 Expert), and compete for a prize pool
funded by 85% of total entry fees (15% platform commission). Maximum contest score: **150 points**.

It is explicitly **not a betting product**: users never wager on odds, never play against the
house, and outcomes are ranked by prediction skill against other users.

### 1.1 Scale & quality targets (design inputs)

| Dimension | Target |
|---|---|
| Registered users | 500,000+ |
| Concurrent users (match-day peak) | 25,000–50,000 |
| Predictions per contest lock window | ~100k writes in final 30 min before kickoff |
| Leaderboard read QPS during live matches | 5,000+ (cache-served) |
| API p95 latency | < 250 ms (reads), < 500 ms (writes) |
| Wallet consistency | Zero tolerance — double-entry ledger, no drift |
| Availability | 99.9% (contest lock & settlement paths 99.95%) |
| RPO / RTO | 5 min / 30 min |

These targets drive every decision below. The dominant load pattern is **bursty**: quiet
mid-week, extreme spikes in the hour before popular kickoffs and during live scoring.

---

## 2. Architecture Style: Modular Monolith with Event-Driven Core

### 2.1 The decision

**A single NestJS modular monolith, structured by DDD bounded contexts, communicating internally
via an event bus, with BullMQ/Redis for async workloads — deliberately *not* microservices on day one.**

### 2.2 Justification (trade-off analysis)

| Option | Verdict | Reasoning |
|---|---|---|
| Microservices from day one | ❌ Rejected | Distributed transactions across Wallet + Contest + Payments are the hardest part of this domain. Splitting them prematurely turns a database transaction into a saga, multiplies failure modes for money movement, and burns team velocity on infra instead of product. DraftKings and FPL both started monolithic. |
| Classic layered monolith | ❌ Rejected | Without enforced module boundaries, the codebase decays into a big ball of mud and can never be split later. |
| **Modular monolith (chosen)** | ✅ | Each bounded context is a NestJS module with a **public facade + events only** contract. Modules never import each other's internals (enforced by ESLint `import/no-restricted-paths` + Nx-style boundary rules). Any module can be extracted to a service later because it already communicates via events and explicit interfaces. |

**Extraction path (pre-planned):** the first candidates to split under load are (1) the
**Scoring/Settlement worker**, (2) the **Sports Data ingestion service**, and (3) the
**Leaderboard read service** — all three are already isolated behind queues/events, so extraction
is a deployment change, not a rewrite.

### 2.3 Where CQRS applies (and where it doesn't)

CQRS is applied **selectively**, not globally:

| Context | CQRS? | Why |
|---|---|---|
| Leaderboard | ✅ Full | Writes (score events) and reads (rankings) have wildly different shapes and volumes. Read model lives in Redis sorted sets, rebuilt from Postgres on demand. |
| Statistics / Football IQ Profile | ✅ Full | Denormalized read models updated by projection workers off domain events. |
| Wallet | ✅ Write-side only | Commands go through the ledger aggregate; balance reads come from a materialized balance row updated in the same transaction. No eventual consistency for money. |
| Contests, Predictions, Users, Admin | ❌ Plain repository pattern | CRUD-shaped; CQRS here is ceremony without benefit. |

### 2.4 Hexagonal architecture (ports & adapters)

Every integration with the outside world sits behind a **port** (TypeScript interface) with
swappable **adapters**:

```
Domain Core (entities, value objects, domain services, domain events)
        │  depends on nothing
        ▼
Application Layer (use cases / command & query handlers)
        │  depends on domain + ports
        ▼
Ports (interfaces):  PaymentGatewayPort · SportsDataPort · NotificationPort
                     CachePort · QueuePort · StoragePort · ClockPort
        ▼
Adapters:  Paystack | Flutterwave | Monnify        (payments)
           API-Football | Sportmonks | Football-data (sports)
           SES/Resend | Termii SMS | FCM             (notifications)
           Redis · BullMQ · S3 · Prisma              (infrastructure)
```

**Rule:** the words `paystack`, `api-football`, etc. appear *only* inside their adapter folder
and configuration. The application layer speaks `PaymentGatewayPort.initializeDeposit(...)` and
`SportsDataPort.getFixture(...)`. Provider selection is config-driven per environment, with a
**routing strategy** (e.g., Paystack primary, Flutterwave fallback on failure) implemented as a
composite adapter.

---

## 3. Bounded Context Map (DDD)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FOOTBALL IQ CHALLENGE                          │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐     │
│  │   IDENTITY   │   │   CONTEST    │   │        FINANCE           │     │
│  │              │   │  (core)      │   │  (core, strictest)       │     │
│  │ Auth         │   │ Contests     │   │ Wallet (ledger)          │     │
│  │ Users        │   │ Matches      │   │ Transactions             │     │
│  │ Devices      │   │ Predictions  │   │ Payments (gateway)       │     │
│  │ Sessions     │   │ Entry mgmt   │   │ Withdrawals              │     │
│  └──────┬───────┘   └──────┬───────┘   │ Prize distribution       │     │
│         │                  │           └──────────┬───────────────┘     │
│         │                  │                      │                     │
│  ┌──────┴───────┐   ┌──────┴───────┐   ┌──────────┴───────────────┐     │
│  │  ENGAGEMENT  │   │  COMPETITION │   │       PLATFORM           │     │
│  │              │   │  (compute)   │   │  (supporting)            │     │
│  │ Notifications│   │ Scoring      │   │ Admin & RBAC             │     │
│  │ Achievements*│   │ Difficulty   │   │ Settings (dynamic rules) │     │
│  │ Referrals*   │   │ Risk Meter   │   │ Audit Logs               │     │
│  │              │   │ Leaderboard  │   │ Reports & Analytics      │     │
│  │              │   │ Stats / IQ   │   │ Fraud Detection          │     │
│  └──────────────┘   └──────────────┘   └──────────────────────────┘     │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │  SPORTS DATA (anti-corruption layer)                          │      │
│  │  Fixtures · Results · Team stats · Provider adapters · Sync   │      │
│  └───────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
   * = future modules; interfaces reserved now, implemented later
```

**Context relationship rules**

- **Finance** is the strictest context: nothing writes to the ledger except its own command
  handlers; every other context requests money movement via commands/events
  (`PrizeAwarded`, `EntryFeeCharged`, `RefundRequested`) and receives confirmation events.
- **Sports Data** is an **anti-corruption layer**: external provider payloads are translated
  into internal canonical models (`Fixture`, `MatchResult`, `TeamForm`) at the boundary. Internal
  IDs are ours; provider IDs are stored as mappings (`provider_ref` table), which is what makes
  providers swappable *with historical data intact*.
- **Competition** (scoring, difficulty, leaderboard) is pure computation over Contest +
  Sports Data — it owns no user-facing writes except its read models, making it the easiest
  context to scale horizontally.

---

## 4. Module Inventory & Responsibilities

| Module | Context | Key responsibilities | Notable patterns |
|---|---|---|---|
| `auth` | Identity | Register, login, JWT + rotating refresh tokens, OTP, email verification, forgot password, device management, session revocation | Passport strategies; refresh token family detection (reuse ⇒ revoke family) |
| `users` | Identity | Profile, KYC-lite (name/phone/bank for withdrawals), preferences | Soft delete; PII encryption at field level |
| `wallet` | Finance | Double-entry ledger, balance materialization, holds (entry fee reservation), refunds | Ledger aggregate; SERIALIZABLE tx or row-lock on account; idempotency keys |
| `payments` | Finance | Gateway abstraction, deposit init/verify, webhook processing, reconciliation | `PaymentGatewayPort`; webhook signature verification; outbox for events |
| `withdrawals` | Finance | Request → fraud check → admin approval → payout → settlement | State machine; maker-checker (admin approval) |
| `contests` | Contest | Contest lifecycle (draft → published → locked → scoring → settled → archived), entry management, prize pool calculation | State machine; lock job scheduled at first kickoff |
| `matches` | Contest | Contest-match association, market configuration per match | References Sports Data fixtures by internal ID |
| `predictions` | Contest | Submission, validation of balanced-challenge rule, immutability after lock | Optimistic UI on frontend; hard lock enforced server-side by contest status + DB constraint |
| `scoring` | Competition | Rule-driven scoring engine; consumes `MatchResultFinalized`, emits `PredictionScored`, `ContestScored` | Strategy pattern per market; rules loaded from DB (Settings), versioned per contest |
| `difficulty` | Competition | Heatmap engine (1–5 stars) from weighted signals; admin-tunable weights | Pluggable signal providers; weights in Settings with versioning |
| `risk` | Competition | Risk meter (Safe/Balanced/Aggressive, risk %, max potential score) — display only, never affects scoring | Pure function over prediction slip + difficulty data |
| `leaderboard` | Competition | Live rankings (Redis ZSET), rank deltas, tie-breaking, prize positions, historical & season rankings | CQRS; Postgres = source of truth, Redis = serving layer |
| `stats` / `iq-profile` | Competition | Accuracy by market/league, streaks, winnings, monthly/yearly performance, best/worst markets | Event-sourced projections, recomputable |
| `notifications` | Engagement | In-app, email, SMS, push-ready; templated; per-user preferences | `NotificationPort` per channel; BullMQ fan-out |
| `admin` | Platform | Dashboards, contest management, user/wallet management, withdrawal approvals | RBAC guards; every mutation audit-logged |
| `settings` | Platform | Dynamic configuration: scoring rules, market point values, difficulty weights, commission %, contest templates | Versioned config; contests snapshot the rule version at publish time |
| `audit` | Platform | Append-only audit trail of admin + financial actions | Write-only API; hash-chained rows (tamper evidence) |
| `reports` | Platform | Revenue, contest performance, user growth, export | Read replicas / scheduled aggregation |
| `fraud` | Platform | Multi-account signals, velocity checks, device fingerprint overlap, withdrawal risk score | Rules engine + manual review queue |
| `sports-data` | Sports Data | Fixture sync, live scores, result finalization, team form/H2H/injuries ingestion | ACL; provider adapters; scheduled + webhook-driven sync |

---

## 5. Event-Driven Architecture

### 5.1 Transport & delivery guarantees

- **In-process domain events** (NestJS event emitter) for same-transaction side effects that are
  cheap and safe.
- **Transactional Outbox → BullMQ** for anything that must survive a crash: the event row is
  written in the *same Postgres transaction* as the state change; a relay publishes it to BullMQ.
  This gives **at-least-once delivery**, so **every consumer is idempotent** (dedupe on event ID).
- **Why not Kafka now:** BullMQ on Redis covers this scale (tens of thousands of events/min at
  peak) with far less operational cost. The outbox pattern means the transport can be swapped for
  Kafka/SQS later without touching producers' business logic.

### 5.2 Core event catalogue (excerpt)

| Event | Producer | Consumers |
|---|---|---|
| `contest.published` | Contests | Notifications (reminders), Leaderboard (init) |
| `contest.locked` | Contest Lock job | Predictions (freeze), Notifications, Risk (finalize slips) |
| `entry.paid` | Wallet | Contests (confirm entry), Prize pool projector, Fraud |
| `match.result.finalized` | Sports Data | Scoring |
| `prediction.scored` | Scoring | Leaderboard, Stats |
| `contest.scored` | Scoring | Prize Distribution, Notifications |
| `prizes.distributed` | Finance | Wallet (credit), Notifications, Stats, Audit |
| `wallet.debited` / `wallet.credited` | Wallet | Transactions view, Fraud, Audit |
| `withdrawal.approved` | Admin | Payments (payout), Notifications |
| `payment.webhook.received` | Payments | Wallet (settle), Reconciliation |

### 5.3 The money path (sequence of record)

```
Deposit:   Gateway webhook ─▶ verify signature ─▶ idempotency check (provider ref)
           ─▶ ledger tx [gateway_clearing → user_available] ─▶ outbox: wallet.credited

Entry:     Join contest ─▶ ledger tx [user_available → contest_escrow]  (single DB tx
           with entry row; insufficient funds rejects atomically)

Settle:    contest.scored ─▶ prize distribution job ─▶ ONE ledger tx:
           [contest_escrow → platform_revenue (15%)] + [contest_escrow → each winner]
           ─▶ escrow must zero out, else tx aborts and alerts (invariant check)

Withdraw:  Request ─▶ hold [user_available → withdrawal_pending] ─▶ fraud score
           ─▶ admin approval ─▶ gateway payout ─▶ on success: [withdrawal_pending →
           external]; on failure: reverse hold + notify
```

Every arrow above is a **double-entry journal** (equal debits and credits, immutable rows).
Balances are derived, never directly mutated. Full ledger design lands in Phase 2.

---

## 6. Contest Domain Model (core rules as invariants)

Contest lifecycle state machine:

```
DRAFT ──publish──▶ PUBLISHED ──first kickoff──▶ LOCKED ──all results final──▶
SCORING ──▶ SCORED ──prize job──▶ SETTLED ──▶ ARCHIVED
                 └──admin cancel (any pre-LOCKED state)──▶ CANCELLED (full refunds)
```

Domain invariants (enforced in the domain layer *and* by DB constraints where possible):

1. A contest holds **5–10 matches**, admin-selected.
2. A contest exposes exactly **10 prediction slots**: 2 Easy, 3 Medium, 3 Hard, 2 Expert
   (the *Balanced Challenge Rule*). An entry is only valid when all 10 slots are filled and the
   difficulty distribution matches — validated as a whole slip, not per prediction.
3. **Lock time = earliest kickoff** among contest matches; recomputed if admin swaps a fixture
   pre-publish; a scheduled BullMQ job (plus a lazy check on every write) enforces the lock —
   the DB-level guard is the contest status, so a delayed job can never allow late edits.
4. Predictions are **immutable after lock** (no update path exists post-lock; enforced by status
   guard + trigger).
5. Max score **150 points**; per-market point values come from the **rule version snapshotted at
   publish** — admin rule changes never retroactively affect live contests.
6. Prize pool = `entries × fee × 0.85`, **projected live** to users as "estimated prize pool";
   commission (15%) and payout table are frozen at lock.

Market difficulty taxonomy (point values are Settings-driven; these are launch defaults):

| Tier | Markets | Default pts | Slots |
|---|---|---|---|
| Easy | Match Winner, Double Chance | 5 | 2 → 10 |
| Medium | Over/Under 2.5, BTTS, First Half Winner, First Team To Score | 10 | 3 → 30 |
| Hard | Winning Margin, Clean Sheet, Exact Goals | 15 | 3 → 45 |
| Expert | Correct Score | 32.5 → *see note* | 2 → 65 |

> **DECIDED (2026-07-06):** Expert = **32.5 points each** (2 × 32.5 = 65), completing exactly
> 150. All point values are stored as integers scaled ×10 (`pointsX10`: 50 / 100 / 150 / 325,
> max slip = 1500) so no floating-point arithmetic ever touches scoring, ranking, or prizes.
> Implemented in `packages/contracts/src/scoring.ts` and the `MarketRule.pointsX10` column;
> remains admin-configurable via versioned RuleSets.

### 6.1 Tie-breaking (ordered comparator)

Applied in order until resolved: **1)** highest total points → **2)** most correct
Expert/Correct-Score predictions → **3)** most correct Hard predictions → **4)** earliest slip
submission timestamp (server receive time, microsecond precision) → **5)** seeded random draw
(seed = contest ID + final results hash, recorded in audit log so the draw is reproducible and
provably fair).

---

## 7. Difficulty Engine & Risk Meter (architecture)

**Difficulty Heatmap (per match, 1–5 ⭐):** a weighted scoring pipeline. Each *signal provider*
(Form, Home Advantage, League Position gap, Goal Difference, H2H, Recent Goals, Defensive Record,
Injuries, Suspensions, Historical Performance) returns a normalized 0–1 "unpredictability"
contribution; the engine computes `Σ(weight_i × signal_i)` and maps to star bands. Weights live
in Settings (admin-tunable, versioned); each contest snapshots the weight version. Signals are
computed by a BullMQ job when fixtures sync, cached, and recomputed on squad-news updates.
Admins can **manually override** a star rating (override is stored alongside, audit-logged, and
displayed as the effective value).

**Risk Meter (per user slip):** a pure, deterministic function over the user's chosen markets ×
match difficulty: outputs profile (Safe / Balanced / Aggressive), risk % and max potential score.
It is computed client-side for instant feedback and recomputed server-side at submission for the
stored record. **It never feeds the scoring engine** — enforced structurally: the scoring module
has no dependency on the risk module.

---

## 8. System Topology (deployment view)

```
                    Cloudflare (CDN · WAF · DDoS · TLS)
                                  │
                       ┌──────────┴──────────┐
                       │   Nginx / ALB       │
                       └──────────┬──────────┘
              ┌───────────────────┼───────────────────────┐
              ▼                   ▼                       ▼
     Next.js (SSR/ISR)     NestJS API (N pods,      NestJS WS Gateway
     Vercel-style or        stateless, HPA)         (Socket.IO + Redis
     containerized                │                  adapter, sticky-free)
                                  │
        ┌────────────┬────────────┼──────────────┬────────────────┐
        ▼            ▼            ▼              ▼                ▼
   PostgreSQL    Redis        BullMQ         S3 (avatars,    Sports/Payment
   (primary +    (cache,      Workers        exports,        provider APIs
   read replica, sessions,    (separate      invoices)       (egress only)
   PITR)         leaderboard, deployment,
                 rate limits) own scaling)
```

- **API and workers are the same codebase, different entrypoints** (`main.api.ts` /
  `main.worker.ts`) — deployed and scaled independently.
- **WebSockets** (live leaderboard, score ticks, prize pool ticker) run on a dedicated gateway
  deployment using the Redis pub/sub adapter so any pod can serve any client.
- **Environments:** DigitalOcean (dev/staging, Docker Compose → small k8s or Docker Swarm) and
  AWS (production: ECS Fargate or EKS, RDS Postgres, ElastiCache, S3, CloudFront behind
  Cloudflare). Full detail in Phase 8.

### 8.1 Caching strategy (summary)

| Data | Store | TTL / invalidation |
|---|---|---|
| Leaderboards | Redis ZSET | Updated by scoring events; rebuilt from Postgres on cache loss |
| Contest lists / details | Redis + Next.js ISR | 30–60 s TTL; explicit bust on admin edits |
| Fixture & live score data | Redis | Provider sync job is the only writer |
| User balance | **No cache** | Always read from Postgres materialized balance — money is never stale |
| Sessions / refresh state / rate limits / idempotency keys | Redis | Native TTLs |

---

## 9. Security Architecture (summary — full treatment in later phases)

- **AuthN:** short-lived access JWT (15 min) + rotating refresh tokens (httpOnly cookie on web /
  secure storage on Flutter), refresh-token-family reuse detection, OTP for sensitive actions
  (withdrawals, bank changes), device registry with per-device revocation.
- **AuthZ:** RBAC (`user`, `support`, `finance_admin`, `contest_admin`, `super_admin`) via
  guards + policy checks in application layer; maker-checker on withdrawals above thresholds.
- **Money safety:** idempotency keys on every payment mutation; webhook HMAC verification +
  replay protection; ledger invariant checks; daily automated reconciliation vs gateway reports.
- **Platform:** Helmet, strict CORS allowlist, Zod/class-validator on every input, Prisma
  parameterization (no raw SQL without review), rate limiting per-IP and per-user in Redis,
  CSRF-safe by design (bearer tokens for API, SameSite=Strict cookies for refresh), field-level
  encryption for PII/bank details, append-only hash-chained audit log.
- **Fraud:** device fingerprinting, multi-account clustering, deposit/withdraw velocity rules,
  anomaly flags feeding a manual review queue before payouts.

---

## 10. Monorepo Layout (top level — detailed trees in Phases 3–4)

```
football-iq-challenge/
├── apps/
│   ├── api/          # NestJS (API + worker entrypoints)
│   └── web/          # Next.js (user app + admin panel)
├── packages/
│   ├── contracts/    # Shared Zod schemas + TS types (API DTOs, events) — consumed by
│   │                 # web now, source of truth for the Flutter client's OpenAPI later
│   ├── config/       # Shared ESLint, TS, Prettier configs
│   └── ui/           # (optional) extracted shadcn component library
├── infra/            # Docker, compose, nginx, terraform, github actions
├── docs/             # This documentation set
└── scripts/          # DB seeding, ops scripts
```

Tooling: **pnpm workspaces + Turborepo**, TypeScript strict everywhere, ESLint boundary rules
between modules, Husky + CommitLint (conventional commits).

**Mobile readiness:** the API is the only product surface Flutter needs — versioned REST
(`/api/v1`), OpenAPI generated from NestJS Swagger decorators, cursor pagination, push-ready
notification abstraction, and zero web-session coupling (token auth works identically for mobile).

---

## 11. Key Architectural Decisions Register (ADR summary)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| ADR-1 | Modular monolith, event-driven internally | Microservices; plain monolith | §2.2 — money-path transactionality + velocity; pre-planned extraction seams |
| ADR-2 | Double-entry ledger for all money | Balance column with +/- updates | Auditability, zero-drift, refund/settlement correctness; non-negotiable for real money |
| ADR-3 | Transactional outbox + BullMQ | Direct event publish; Kafka | Crash-safe delivery without Kafka ops burden; transport swappable later |
| ADR-4 | Rules-as-data with versioned snapshots | Hardcoded scoring rules | Admin edits rules without deploys; snapshots protect live contests from retroactive changes |
| ADR-5 | Redis read models for leaderboard/live data, Postgres as truth | Compute rankings in SQL per request | Match-day read bursts; rebuildable cache = safe |
| ADR-6 | Anti-corruption layer + provider ref mapping for sports data | Store provider IDs as primary keys | Provider swap without data migration; multi-provider fallback |
| ADR-7 | Composite payment adapter with failover routing | Single gateway | Nigerian gateway reliability varies; failover protects deposit conversion |
| ADR-8 | Same codebase, separate API/worker/WS deployments | One process does everything | Independent scaling of bursty workloads (scoring, notifications) |

---

## 12. Open Questions for Product (non-blocking)

1. Expert-tier point split (2 × 32.5 vs 30 + completion bonus) — engine supports both.
2. Payout table shapes (winner-take-all vs top-N %) — architecture supports per-contest payout
   templates; defaults needed for launch.
3. Currency scope — designed NGN-first with minor-unit integer storage (kobo); multi-currency is
   a schema flag away but out of launch scope.
4. Regulatory posture (skill-gaming classification in target markets) — affects KYC depth on
   withdrawals; ledger and audit design already assume the stricter path.

---

**Next phase:** Phase 2 — Database Design (ER diagram, full Prisma schema, ledger tables,
indexes, constraints, soft deletes, audit fields, migration strategy).
