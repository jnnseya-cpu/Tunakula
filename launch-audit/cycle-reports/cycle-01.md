# Cycle 01 — Break it, fix it, prove it

One full pass of the mandate's loop: attack the surfaces I can reach from here, fix what breaks, prove the fix with tests, then re-run the full regression.

## Scope of this cycle (what I could actually exercise)
- Static + type analysis across all workspaces (`guard`, `typecheck`).
- Unit + adapter suites (`test:shared`, `test:backend`).
- HTTP end-to-end suite against a real Postgres with the production RLS roles (`test:api`).
- Both web static builds (`build:frontend`).
- Dependency vulnerability scan (`npm audit`, prod and all).
- Targeted adversarial review of the auth/OTP path, the market-publish path, and the admin audit/tenant-isolation path.

Out of scope for this cycle (no live infra; see human-actions.md): live E2E against the deployed stack, payment-sandbox certification, load/soak, deploy drill, real data import.

## Break → findings
| # | Attack | Result |
|---|--------|--------|
| D-01 | "Can a first bring-up take real money against a placeholder?" | **Yes** — `publish-market` set LIVE + auto-signed all §28.10 readiness. P0. |
| D-03 | "Can one device pump SMS by cycling phone numbers?" | **Yes** — only a per-phone cap existed; no per-IP cap. P1. |
| D-04 | "Can a country admin read another country's audit log?" | **Yes** — audit queries had no `country_iso2` filter. P1. |
| D-02 | "Any known-vulnerable deps shipped to the browser?" | **Yes** — Next.js advisory. P0. |

## Fix → proof
All four fixed in code; see defects.md for the change and evidence-ledger.md for the green runs. Notably, the first full gate re-run surfaced a **self-inflicted regression**: the dependency bump had moved `@nestjs/platform-fastify` to 12.2.0 while `@nestjs/core`/`@nestjs/common` stayed at 12.1.2, so the whole HTTP suite failed to load (`isRejectedByPipes` missing from `@nestjs/core/internal`). I aligned all three NestJS packages at 12.2.0 and re-ran — suite loads and passes. This is exactly why the mandate requires a full regression after each fix: the targeted tests passed, but only the full suite caught the version skew.

## Regression → result
Full gate suite green after the alignment (evidence-ledger.md). `npm audit` 0 vulnerabilities.

## Exit state of cycle 01
No open P0/P1 in the code I can reach. Remaining blockers are all operational (A–F in human-actions.md), not code. A second break/fix cycle on the same surfaces would be unlikely to find new P0/P1 without a running environment to attack, so the honest next step is the live gates, which need you.
