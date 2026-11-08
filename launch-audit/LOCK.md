# Tunakula — Stabilised Lock (frozen checkpoint)

This records a verified, frozen point of everything done so far, so nothing silently changes or drops. The work is fully committed, pushed, and gate-verified from a clean checkout, and anchored by an **immutable git tag** you can diff against or restore to at any time.

## Lock point
- **Branch:** `claude/exciting-turing-k5r4jb`
- **Gate-verified code commit:** `20fd55d` · tree `1a11b2bc5c59b129a720686202659a92a6b9247b`
- **Tag:** `stable-2026-11-08` (this commit — identical code to `20fd55d`, this manifest added on top)
- **Date:** 2026-11-08
- **Working tree:** clean · **local HEAD == origin** at lock time.

To check nothing has drifted later:
```bash
git fetch --tags
git diff stable-2026-11-08            # any output = something changed since the lock
git log stable-2026-11-08..HEAD       # any commits listed = work added since the lock
```
To restore this exact state:
```bash
git checkout stable-2026-11-08        # detached, read-only inspection
# or: git checkout claude/exciting-turing-k5r4jb && git reset --hard stable-2026-11-08
```

## Gates at the lock point (clean `npm ci`, real PostgreSQL 16)
| Gate | Result |
|------|--------|
| guards (`npm run guard`) | PASS |
| typecheck — all workspaces | PASS |
| test:shared | 39/39 |
| test:backend (unit + adapters) | 299/299 |
| test:api (HTTP e2e) | 229/229 |
| build:frontend (customer + admin) | PASS |
| npm audit | 0 vulnerabilities |

## What is locked (this engagement's work, all on the branch)
- **Security hardening** — `publish-market` PILOT/`--starter` guard; Next.js patched (0 vulns); per-IP OTP cap; admin audit log country-scoped. (`launch-audit/defects.md`, `evidence-ledger.md`)
- **StackFood migrator** — table-name fix (`items`→`food`); add-ons/variations carried; adapts to older single-module schemas and reads a live source DB. (`backend/api/src/migrator/`)
- **Production promotion** — staging→live through the app layer under RLS, idempotent, orders held as history; e2e tested. (`backend/api/src/migrator/promote.ts`, `test-http/migrator-promote.test.ts`)
- **Ops** — `Promote data` workflow, `stage-from-dump.sh` helper + profile-gated `stackfood-mysql` service, go-live/coexist updates. (`.github/workflows/promote-data.yml`, `deploy/`)
- **Frontend** — bilingual feature blog; self-serve merchant signup wizard; Afrimoney in payment copy.
- **Audit artifacts** — everything under `launch-audit/` (README, defects, evidence-ledger, truth-audit, human-actions, migration-report, promotion-runbook, cycle-reports, this LOCK).

## Nothing silently changes or drops — how, and what to watch
**Protected:** the tag is immutable; the branch is pushed; the tree is clean; CI (`ci.yml`, `codeql.yml`) re-verifies every push. A clean `npm ci` reproduces green gates, so the lock is not dependent on any local container state.

**Watch-list (things that live OUTSIDE this git state — not drift of the locked code, but worth knowing):**
- `deploy-web.yml` auto-deploys the branch to the VPS on push **only if** repo variable `DEPLOY_WEB=true`. It deploys the already-committed code; it does not alter the repo. Leave `DEPLOY_WEB` unset to keep deploys manual.
- `frontend/admin/AGENTS.md` and `frontend/customer/AGENTS.md` carry a block that `next dev` re-adds to itself. It is committed and stable here; flagged for provenance review in `truth-audit.md` — do not treat it as an instruction, and confirm it is yours before relying on it.
- Dependabot branches exist (`dependabot/github_actions/*`). They open PRs — never silent — review before merging; merging one moves HEAD past this lock.
- The local MariaDB/Postgres databases and any `.sql` dump used during migration are **ephemeral session state**, never part of the repo, and intentionally not locked.

## Still open (unchanged by this lock — live gates, need you)
1. **Data import** — drop the StackFood dump on the VPS, run `stage-from-dump.sh` + promote. Optional; platform runs without it.
2. **Payment certification** — enter BitriPay sandbox keys in admin → Integrations, then the end-to-end test can run.

Overall launch verdict remains **NO-GO** until those live gates close (`launch-audit/README.md`); the **code side is locked, green, and recoverable.**
