# ADR 0011 — Three areas: shared, backend, frontend

- Status: Accepted
- Date: 2026-10-04
- Supersedes the layout in ADR 0001 (`packages/`, `services/`, `adapters/`, `web/`)

## Context
The repository grew a website next to the API, and the two started to share facts: the site published
rider pay and fee comparisons that the pricing engine alone defines. With everything side by side, nothing
stopped the site from importing server code, or the server from depending on the site, and nothing tied
the published figures to the engine. One figure had already drifted (a comparison total off by a cent, and
a "3.00 to 6.00" commission range that should have read 5.00 to 6.00).

## Decision
- **`shared/`** holds what both sides rely on and nothing else: `ts-money` (Money, Currency Registry, FX)
  and `ts-contracts` (Country Profile schema and validator, payment ports, test fixtures, published figures).
- **`backend/`** holds the API and database (`backend/api`) and the payment connectors
  (`backend/adapters/payments/*`).
- **`frontend/`** holds what people see: the website (`frontend/customer`) now, and the apps and other
  web surfaces later.
- **One dependency rule**: frontend → shared, backend → shared, shared → shared. `tools/guard-boundaries.ts`
  enforces it on every workspace's `package.json` and on every import (package or relative path) in its
  source, and runs in `npm run guard`.
- **Published figures are data in `shared/ts-contracts/published`.** The website renders them; the backend
  test `published-figures.test.ts` recomputes every value with the pricing engine (and the competitor rows
  by their stated rule). A change to the engine or the policy fails that test until the published data
  is updated, so the site cannot say something the platform does not do.
- **Fixtures are loaded through `@tunakula/ts-contracts/testing`**, not `../../../` paths, so moving a
  folder cannot break a test.
- **Checks per area**: `check:shared`, `check:backend` (typecheck, unit tests, API end-to-end against
  PostgreSQL), `check:frontend` (typecheck and static build). CI runs them as separate jobs after the guards.

## Consequences
- Each area typechecks with its own `tsconfig.json` over `tsconfig.base.json`; the API's HTTP layer keeps
  its decorator settings in `backend/api/tsconfig.json`.
- New code goes to the area it belongs to. Something both sides need is moved to `shared/` and stays free
  of framework and I/O code (Node-only helpers live behind a separate entry point such as `./testing`).
