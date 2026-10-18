# Go-live runbook

The exact cutover sequence for launching a Tunakula market. The application is production-ready and verified
(`npm run check` green, security review clean, container boot verified); this runbook covers the infrastructure
cutover. Work top to bottom. Each step says how to confirm it worked.

Roles: **Infra** (cloud, DB, DNS, secrets), **Release** (build/deploy), **Ops** (markets, monitoring),
**Payments** (connector go-live). One person can hold several.

---

## T‑1 — the evening before

1. **Green commit** — the commit you will ship is green in CI (guards, `npm audit`, typecheck, unit + e2e on
   PostgreSQL 16, both frontend builds, CodeQL). Set the repo variables `CUSTOMER_API_URL` and `ADMIN_API_URL`
   to the production API URL (baked into the static frontends at build time). Tag it: `git tag v1.0.0 && git push --tags`.
   → The **Release** workflow builds and pushes three images: `ghcr.io/<owner>/tunakula-api`,
   `…/tunakula-web-customer`, `…/tunakula-web-admin` (each tagged `1.0.0`). Confirm all three exist.
2. **Database** (Infra) — provision PostgreSQL 16. Create the two roles and the database (see `deploy/initdb.sql`):
   a migrating owner `tunakula` (CREATEDB, **NOT** superuser, **NOT** BYPASSRLS) and the app role `tunakula_app`
   (**NOT** superuser, **NOT** BYPASSRLS). Enable automated backups + point‑in‑time recovery now, and do one
   **restore drill** into a scratch instance. → `psql` as `tunakula_app` connects; a backup exists; the restore drill succeeded.
3. **Secrets** (Infra) — load `.env.production.example` into your secrets manager with real values. Required:
   `DATABASE_OWNER_URL`, `DATABASE_URL`, `DATABASE_APP_ROLE`, `TUNAKULA_TOKEN_SECRET` (32+ random chars),
   `TUNAKULA_MESSAGING_PROVIDER=twilio` with its keys, `TUNAKULA_CONSOLE_ORIGINS`, `TUNAKULA_TRUST_PROXY=1`,
   `TUNAKULA_RATE_LIMIT_RPM`. **Never** set `TUNAKULA_SANDBOX_PAYMENTS` or `TUNAKULA_DEV_OTP` in production.
4. **DNS + TLS** (Infra) — records for the API host(s) in `TUNAKULA_API_HOSTS`, the admin console, and the
   website; TLS certs issued; the load balancer / ingress forwards `X-Forwarded-*`.
5. **Edge** (Infra) — a shared rate limiter + WAF in front of the API fleet (the app's per-instance limiter and
   OTP caps are a second layer, not the first).
6. **Observability** (Ops) — ship the structured JSON logs to your platform. Enable `TUNAKULA_METRICS=1` (with a
   scrape token, restricted at the edge) and point Prometheus at `GET /metrics`: it exposes
   `http_requests_total` and `http_request_duration_seconds` by route, plus process gauges. Build dashboards for
   request rate, error rate, p95/p99 latency, DB connections and the background sweep logs; wire alerts to
   on-call. Rehearse capacity with `node tools/load-test.mjs <url> --path /v1/health --concurrency 50 --duration 60`
   (and a long `--duration` for a soak) before launch.

---

## Launch day

### 1. Deploy the API (Release)
Run the tagged image with the production env. On first boot it **migrates automatically** (owner role) and then
listens on `$PORT`.
- → Logs show `migrations applied` then `api listening`.
- → The `HEALTHCHECK` in the image is passing; the orchestrator reports the task healthy.

### 2. Create the first Super Admin (Ops)
```
DATABASE_URL=<owner-or-app-url> npm run bootstrap-admin -w @tunakula/api -- +243810000000 "Launch Owner"
```
→ Sign in to the admin console with that phone; the sign-in code arrives by SMS (Twilio), not the logs.

### 3. Publish the launch market (Ops)
A fresh database has no markets. A country admin drafts a Country Profile, a Super Admin publishes it with the
§28.10 readiness review:
- `POST /v1/admin/countries/drafts` (the Country Profile) → note the version.
- `POST /v1/admin/countries/<ISO2>/versions/<version>/publish` with the readiness sign-offs.
→ `GET /v1/countries` lists the market; the storefront shows it.

### 4. Payments go-live (Payments)
Add **production** connector credentials and register each connector's **webhook endpoint** with the PSP — via
env (`BITRIPAY_*`, `KODA_*`, `STRIPE_*`) or Admin → Integrations. Re-run the connector **certification** path
against live credentials. → A real low-value test order is authorized and settles; the webhook is received and
the order advances.

### 5. Frontends (Infra)
Deploy the two frontend units — each is its own static image (`tunakula-web-customer`, `tunakula-web-admin`,
nginx-served) built with the production API URL baked in, or the raw static export to a CDN:
```
# Images (built by the Release workflow), or locally:
docker build -f frontend/customer/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.tunakula.com -t web-customer .
# or the static files for a CDN:
NEXT_PUBLIC_API_URL=https://api.tunakula.com npm run build:frontend   # → frontend/*/out
```
→ Admin console and website load; both call the production API (check CORS: `TUNAKULA_CONSOLE_ORIGINS` matches).

### 6. Smoke test (Ops)
```
node tools/smoke-test.mjs https://api.tunakula.com
```
→ All checks pass: health, config loaded, problem+json errors, anonymous `/v1/me` → 401. The "no published
markets" warning must be **gone** after step 3.

### 7. Full-path rehearsal (Ops) — in production, small
Place one real order end to end: customer sign-in → order → pay → kitchen accept → rider assign → deliver with
the verification code. Confirm the settlement journal balances and the merchant/rider payouts are owed.

---

## Go / no-go gate
Ship only when **all** are true:
- [ ] Tagged image deployed and healthy; migrations applied.
- [ ] Super Admin can sign in (real SMS).
- [ ] At least one market published; `GET /v1/countries` non-empty.
- [ ] A production payment authorized + settled + webhook received.
- [ ] Smoke test green; full-path rehearsal order delivered and settled.
- [ ] Backups + PITR on, restore drill done; monitoring + alerts live; edge WAF/limiter in front.

## Rollback
- **Bad release** — redeploy the previous image tag. Migrations are additive and forward-only; do not down-migrate.
  If a migration is the problem, roll the image back and fix forward in a new migration.
- **Config rollback** — a bad Country Profile is reverted by publishing the prior version; every instance picks it
  up within ~1 minute (the config refresh loop).
- **Payments** — disable a misbehaving connector in Admin → Integrations; eligibility falls back to the remaining
  certified connectors.

## After launch (first 24h)
Watch error rate and p95 latency, the dispatch/refund/settlement sweep logs, and payment webhook success. Export
orders and rider payouts from the admin console for the first reconciliation (`Export CSV`). Keep the on-call
engineer on the dashboards.
