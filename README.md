# Tunakula

**Any-market, multi-currency food ordering and delivery — powered by NZELA-OS.**
Owned by Groupe Nseya. Built from scratch; StackFood is a public feature benchmark only (clean-room rule).

Tunakula runs in many countries, currencies and brands from one platform. Every market-specific
behaviour is **data** (Country Profile, Currency Registry) or a **plug-in** (adapters and payment
connectors) — never hard-coded. See [`docs/prd`](docs/prd/README.md) for the governing specification
(PRD-NZG-001 v4.2).

## Layout

Three areas with one rule, enforced by `tools/guard-boundaries.ts` in every check: **frontend and backend
depend only on shared; shared depends on neither** (ADR 0011).

### `shared/` — what both sides rely on

| Path | What it is | PRD |
| --- | --- | --- |
| `shared/ts-money` | `Money` (signed 64-bit integer minor units, no floats), exact rational rounding, Currency Registry seeded from official ISO 4217 data with a flag for every currency, FX quotes with volatility-class TTLs and spread, cash rounding | §19, App. A |
| `shared/ts-contracts` | Country Profile types, JSON Schema and validator; Payment Orchestration contracts (method taxonomy, normalised states, reason codes, `PaymentConnector` / `PayoutConnector` ports) | §7.2, §20 |
| `shared/ts-contracts/fixtures` | Synthetic market profiles for the §33 test matrix: dual-currency landmark (CD), single-currency postcode (GB), zero-decimal mobile-money (SN); loaded through `@tunakula/ts-contracts/testing` | §33 |
| `shared/ts-contracts/published` | Figures the website publishes (rider pay ladder, "same meal" comparison). A backend test recomputes them with the pricing engine, so the site cannot drift from the rules | §18 |

### `backend/` — the API, its database and the payment connectors

| Path | What it is | PRD |
| --- | --- | --- |
| `backend/api` — HTTP API and database | NestJS on Fastify over PostgreSQL 16: `/v1` sign-in, catalogue, quotes, orders and custody transitions, payment intents and webhooks, Country Profile administration with dual control; SQL migrations with forced row-level security per country, append-only custody/ledger/audit tables and a commit-time balanced-journal check | §9.5, §19, §21, §25, ADR 0010 |
| `backend/api` — payments, money | Payment routing with safe fallback and circuit breakers; double-entry append-only ledger journals | §19.3, §20.4 |
| `backend/api` — identity | Scoped RBAC policy layer: §8.2 role matrix, deny by default, never crosses the active country | §8.2, §9.5 |
| `backend/api` — accounts | Business accounts (platform, merchants of any kind, fleets) with multiple holders, per-member access levels and branch limits, no privilege escalation; profile and cover pictures; self-service account deletion with blockers, grace period and pseudonymisation | §8.2, §12.4, ADR 0005 |
| `backend/api` — ordering | Event-sourced order aggregate: §10.1 state machine with the §11 chain-of-custody gates, evidence bundle projection, idempotent store | §10, §11, §12.2 |
| `backend/api` — config | Country Config derived from the published profile; versioned publish with §28.10 go-live gate, diff and rollback; brand themes (light/dark, WCAG AA-validated) served at runtime | §17, CFG-002, ADR 0006 |
| `backend/api` — pricing | Zero commission, 10% service charge, §18.3 distance ladder with rural rate and surge, 70/30 rider split, promotions, tips, proportional refunds, all-in display, balanced settlement journal | §18, ADR 0007 |
| `backend/api` — printing | Every printed document carries the Tunakula logo and the business's logo | ADR 0006 |
| `backend/adapters/payments/certification` | Connector certification contract suite every connector must pass | §20.7 |
| `backend/adapters/payments/sandbox` | Reference sandbox connector (passes certification) | §20.7 |
| `backend/adapters/payments/bitripay` | BitriPay connector — group rail: intents, refunds, payouts, settlement statements, HMAC + Ed25519 webhooks, connected accounts | §20, ADR 0008 |
| `backend/adapters/payments/koda` | KODA connector — mobile-money verification by operator SMS reference, hosted checkout, signed webhooks | §20.9, ADR 0008 |
| `backend/adapters/payments/http` | Transport that separates "never sent" from "outcome unknown" | ADR 0003 |

### `frontend/` — what people see

| Path | What it is | PRD |
| --- | --- | --- |
| `frontend/customer` | www.tunakula.com: Next.js static site — landing, Send a Meal Home, restaurants, riders, Kinshasa, how it works, about, 16 policies; contact info@tunakula.com | §2.1, ADR 0009 |

### Repository tooling

| Path | What it is | PRD |
| --- | --- | --- |
| `tools/guard-core.ts` | Blocks market-specific branches in core code and floats in money paths | §7.3, §32.2 |
| `tools/guard-boundaries.ts` | Blocks any dependency or import from frontend to backend, backend to frontend, or shared to either | ADR 0011 |

## Getting started

Requires Node.js ≥ 22.18 (TypeScript runs natively via type stripping; no build step).

```bash
npm install
npm run check            # guards, then shared, backend and frontend in turn
npm run check:shared     # typecheck + tests for shared/
npm run check:backend    # typecheck + unit tests + API end-to-end against PostgreSQL
npm run check:frontend   # typecheck + static build of the website
npm run seed:iso4217 -w @tunakula/ts-money   # regenerate the ISO 4217 seed
```

### API and database

Needs PostgreSQL 16 with a migrating owner role (CREATEDB, not superuser) and an application role
`tunakula_app` (no BYPASSRLS):

```bash
npm run test:api   # end-to-end: HTTP → PostgreSQL, in a throwaway database (TEST_DATABASE_ADMIN_URL)

DATABASE_OWNER_URL=postgres://tunakula:…@localhost/tunakula \
DATABASE_URL=postgres://tunakula_app:…@localhost/tunakula \
TUNAKULA_TOKEN_SECRET=<32+ chars> TUNAKULA_SANDBOX_PAYMENTS=1 TUNAKULA_DEV_OTP=1 \
  npm start -w @tunakula/api            # migrates, then listens on :8080

DATABASE_URL=… npm run bootstrap-admin -w @tunakula/api -- +243810000000 "Name"   # first Super Admin
```

A fresh database has no markets: a country admin drafts a Country Profile
(`POST /v1/admin/countries/drafts`) and a Super Admin publishes it with the §28.10 readiness review.

## Principles enforced here

- **Money** — integer minor units with an ISO 4217 code (MR-1); amounts with more precision than the
  currency allows are rejected; rounding happens once with an explicit mode (MR-8); `allocate` never
  creates or loses a minor unit (property-tested); currencies never net against each other in a journal.
- **Currency Registry** — every currency, including all 42 in PRD Appendix A, comes from the official
  ISO 4217 List One; names and symbols come from CLDR via `Intl`; redenominations (SLL→SLE, MRO→MRU,
  STD→STN) are recorded as retired currencies.
- **FX** — quotes are immutable snapshots with source, mid rate, spread and an expiry set by the stricter
  volatility class (§19.5). The platform records rates from licensed partners; it does not execute FX.
- **Payments** — eligibility and ranking come only from the Country Profile and connector capabilities.
  Fallback happens only when provably safe (request never sent, or a terminal route failure); customer
  declines are not re-routed, and an ambiguous outcome stops routing until status is known (§20.4).
- **Any market** — a new market is a validated Country Profile plus certified connectors. `guard-core`
  fails the build on `if country === "XX"` in core code.

## Architecture decisions

See [`docs/adr`](docs/adr). Flutter apps and other web surfaces land in `frontend/`, agents in `backend/`, and infrastructure in
`infra/` as they are built.
