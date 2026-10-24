# Tunakula — Evidence Ledger

Ground truth for the audit. These are the exact gates run after all fixes (D-01…D-04 + the dependency alignment), on branch `claude/exciting-turing-k5r4jb`, against a real PostgreSQL 16 with the production RLS roles `tunakula` / `tunakula_app` — the same roles and suite CI uses.

Run date: 2026-10-24.

| Gate | Command | Result |
|------|---------|--------|
| Guards | `npm run guard` | **PASS** (exit 0) |
| Typecheck (all workspaces) | `npm run typecheck` | **PASS** (exit 0) |
| Shared unit tests | `npm run test:shared` | **PASS** — 39/39, 0 fail |
| Backend unit + adapters | `npm run test:backend` | **PASS** — 299/299, 0 fail |
| HTTP end-to-end (real Postgres, RLS roles) | `npm run test:api` | **PASS** — 225/225, 0 fail |
| Web static builds (customer + admin) | `npm run build:frontend` | **PASS** (exit 0) |
| Dependency audit (production) | `npm audit --omit=dev` | **PASS** — 0 vulnerabilities |
| Dependency audit (all) | `npm audit` | **PASS** — 0 vulnerabilities |

Full log: `scratchpad/gates.log` (kept in the session scratchpad, not committed).

## Notes on specific fixes
- **D-03 (OTP per-IP cap):** new test `backend/api/test-http/otp-rate-limit.test.ts` is part of the 225 above. It drives 3 sign-in-code requests to **different** phone numbers (so the per-phone limiter never fires) and confirms the 4th — still a fresh number — is blocked `429 application/problem+json`, proving the cap is cross-number / per-IP, not per-phone. A second case confirms other endpoints are untouched.
- **D-04 (audit country-scoping):** the existing `api.test.ts` case "revoking: only what you could grant … all audited" is part of the 225 and still passes, confirming the CD admin still sees CD `role.granted`/`role.revoked` after the `country_iso2` filter was added.
- **Dependency alignment:** the first full re-run after the dependency bump failed `test:api` (all suites failed to load: `isRejectedByPipes` missing from `@nestjs/core/internal`) because `@nestjs/platform-fastify` had moved to 12.2.0 while `@nestjs/core`/`@nestjs/common` were 12.1.2. Aligning all three at **12.2.0** fixed it; the run above is post-alignment. This regression and its catch are written up in cycle-reports/cycle-01.md.

## What this ledger does NOT cover (and why)
No row here asserts: a successful data import, payment-sandbox certification, load/soak behaviour, or a deploy/rollback drill. Those cannot run in this environment (no live infra, credentials, or real StackFood data). They are tracked in human-actions.md (A–F) as **unproven**, deliberately absent from this ledger rather than marked green.
