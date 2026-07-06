# Football IQ Challenge

Skill-based football prediction contest platform. Users pay an entry fee, submit a
**Balanced Challenge** slip of 10 predictions (2 Easy / 3 Medium / 3 Hard / 2 Expert) on
admin-curated fixtures, and compete for 85% of the pool (15% platform commission).
Maximum slip score: **150 points** (Easy 5 · Medium 10 · Hard 15 · Expert 32.5 — all
stored as integers ×10 to avoid float drift).

**Not a betting product** — no odds, no house; users compete on prediction skill.

## Monorepo

```
apps/api        NestJS — REST API + BullMQ workers (same code, separate entrypoints)
apps/web        Next.js — user app + admin panel
packages/
  contracts     Shared domain: enums, zod DTO schemas, scoring defaults, risk meter
docs/           Architecture documentation (start at docs/architecture/01-*.md)
```

## Quick start

```bash
pnpm install
docker compose up -d              # postgres :5432, redis :6379, mailpit :8025
cp apps/api/.env.example apps/api/.env
pnpm db:generate && pnpm db:migrate
pnpm dev                          # api :4000 (+ /docs swagger), web :3000
```

## Verify

```bash
pnpm test        # unit tests (scoring engine, slip validator, ledger, risk meter)
pnpm typecheck
```

## Non-negotiable invariants

1. **Money** moves only through `LedgerService` (double-entry; journal lines sum to 0;
   append-only; idempotency keys).
2. **Predictions** are immutable once a contest locks at first kickoff.
3. **Risk Meter never affects scoring** — the scoring module must not import risk code.
4. **Scoring rules are data** (versioned RuleSets); contests snapshot the version at
   publish, so rule edits never retroactively change live contests.
5. **Provider IDs** (payments/sports) never leak past adapter + mapping tables.
