# Tunakula

**Any-market, multi-currency food ordering and delivery — powered by NZELA-OS.**
Owned by Groupe Nseya. Built from scratch; StackFood is a public feature benchmark only (clean-room rule).

Tunakula runs in many countries, currencies and brands from one platform. Every market-specific
behaviour is **data** (Country Profile, Currency Registry) or a **plug-in** (adapters and payment
connectors) — never hard-coded. See [`docs/prd`](docs/prd/README.md) for the governing specification
(PRD-NZG-001 v4.2).

## What is in this repository today

This is the platform foundation: the parts every other context depends on, written so that the
"Money is sacred" and "Any market by design" principles (PRD §2.3) are enforced by code and tests.

| Path | What it is | PRD |
| --- | --- | --- |
| `packages/ts-money` | `Money` (signed 64-bit integer minor units, no floats), exact rational rounding, Currency Registry seeded from official ISO 4217 data, FX quotes with volatility-class TTLs and spread, cash rounding | §19 |
| `packages/ts-contracts` | Country Profile types, JSON Schema and validator; Payment Orchestration contracts (method taxonomy, normalised states, reason codes, `PaymentConnector` / `PayoutConnector` ports) | §7.2, §20 |
| `packages/ts-contracts/fixtures` | Synthetic market profiles for the §33 test matrix: dual-currency landmark (CD), single-currency postcode (GB), zero-decimal mobile-money (SN) | §33 |
| `services/api` — payments, money | Payment routing with safe fallback and circuit breakers; double-entry append-only ledger journals | §19.3, §20.4 |
| `services/api` — identity | Scoped RBAC policy layer: §8.2 role matrix, deny by default, never crosses the active country | §8.2, §9.5 |
| `services/api` — ordering | Event-sourced order aggregate: §10.1 state machine with the §11 chain-of-custody gates, evidence bundle projection, idempotent store | §10, §11, §12.2 |
| `adapters/payments/certification` | Connector certification contract suite every connector must pass | §20.7 |
| `adapters/payments/sandbox` | Reference sandbox connector (passes certification) | §20.7 |
| `tools/guard-core.ts` | Blocks market-specific branches in core code and floats in money paths | §7.3, §32.2 |

## Getting started

Requires Node.js ≥ 22.18 (TypeScript runs natively via type stripping; no build step).

```bash
npm install
npm run check      # typecheck + core guard + all tests
npm test           # tests only
npm run seed:iso4217 -w @tunakula/ts-money   # regenerate the ISO 4217 seed
```

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

See [`docs/adr`](docs/adr). Layout follows PRD §32.1; Flutter apps, Next.js surfaces, agents and
infrastructure land in `apps/`, `web/`, `services/agents` and `infra/` as they are built.
