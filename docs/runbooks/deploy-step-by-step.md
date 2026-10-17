# Tunakula — step-by-step deployment (Vercel + Hostinger VPS + Cloud SQL)

A literal, copy-paste walkthrough from zero to live. Do the steps **in order**. Every step ends with a
**CHECK** — do not move on until it passes.

Target topology (decided):
- **Customer web** + **Admin web** → Vercel (two projects, static export)
- **API** (always-on, runs the dispatch/settlement sweep loops) → Hostinger VPS (Docker + Caddy)
- **PostgreSQL 16** → Google Cloud SQL (managed backups + PITR)

Placeholders to decide now and reuse everywhere (write them down):
- `API_DOMAIN`      = e.g. `api.tunakula.com`
- `SHOP_DOMAIN`     = e.g. `tunakula.com`         (customer site)
- `ADMIN_DOMAIN`    = e.g. `admin.tunakula.com`   (admin console)
- `GCP_PROJECT`     = your Google Cloud project id
- `GCP_REGION`      = e.g. `europe-west1`
- `VPS_IP`          = your Hostinger VPS public IP

---

## PHASE 0 — Accounts & tools (once)

1. Confirm you can sign in to: **Hostinger** (VPS), **Vercel**, **Google Cloud Console**. (Firebase is not used in this plan.)
2. Install the Google Cloud CLI on your laptop and log in:
   ```bash
   gcloud auth login
   gcloud config set project <GCP_PROJECT>
   gcloud services enable sqladmin.googleapis.com
   ```
   **CHECK:** `gcloud sql instances list` runs without an auth error (empty list is fine).
3. Have your **Twilio** credentials (account SID, auth token, SMS-from number) and your **payment connector** production keys (Stripe and/or BitriPay/Koda) ready in a password manager.

---

## PHASE 1 — Database on Google Cloud SQL

> Full detail + the restore drill is in `deploy/cloudsql-setup.md`. Short version:

1. Create the instance (backups + point-in-time recovery on):
   ```bash
   gcloud sql instances create tunakula-prod \
     --database-version=POSTGRES_16 --tier=db-custom-2-7680 \
     --region=<GCP_REGION> --storage-type=SSD --storage-size=20GB --storage-auto-increase \
     --backup --backup-start-time=02:00 --enable-point-in-time-recovery \
     --retained-backups-count=14 --retained-transaction-log-days=7
   ```
2. Set the admin password (used only for setup, never by the app):
   ```bash
   gcloud sql users set-password postgres --instance=tunakula-prod --prompt-for-password
   ```
3. Create the two app roles (choose strong passwords — call them `OWNER_PW` and `APP_PW`):
   ```bash
   gcloud sql users create tunakula     --instance=tunakula-prod --prompt-for-password
   gcloud sql users create tunakula_app --instance=tunakula-prod --prompt-for-password
   ```
4. Create the database owned by the migrator:
   ```bash
   gcloud sql connect tunakula-prod --user=postgres
   ```
   then in psql:
   ```sql
   ALTER ROLE tunakula CREATEDB;
   CREATE DATABASE tunakula OWNER tunakula;
   \q
   ```
5. **Restore drill** (prove backups work — do it now):
   ```bash
   gcloud sql instances clone tunakula-prod tunakula-restore-test --point-in-time=<a timestamp a few min ago, RFC3339>
   gcloud sql instances delete tunakula-restore-test
   ```

**CHECK:** instance is `RUNNABLE`; the clone succeeded and was deleted; both roles show `rolbypassrls = f`.

---

## PHASE 2 — API on the Hostinger VPS

### 2a. Prepare the VPS
1. SSH in: `ssh root@<VPS_IP>`
2. Install Docker + compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   docker compose version   # CHECK: prints a version
   ```
3. Clone the repo and check out the release branch/tag:
   ```bash
   git clone https://github.com/jnnseya-cpu/Tunakula.git && cd Tunakula
   git checkout claude/exciting-turing-k5r4jb   # or the tag you release
   ```

### 2b. Connect the VPS to Cloud SQL (Auth Proxy as a sidecar)
1. In Google Cloud, create a service account with role **Cloud SQL Client**, download its JSON key, and copy it to the VPS as `~/Tunakula/deploy/cloudsql-key.json`.
2. Add the proxy as a sidecar so it's one `up` (edit `deploy/docker-compose.prod.yml`, add a `cloudsql-proxy` service, or run the proxy via systemd per `deploy/cloudsql-setup.md`). The API will reach the DB at host `cloudsql-proxy:5432`.

### 2c. Secrets
Copy the template and fill in **real** values:
```bash
cp .env.production.example deploy/.env.prod
nano deploy/.env.prod
```
Minimum required keys:
```
DATABASE_OWNER_URL=postgres://tunakula:<OWNER_PW>@cloudsql-proxy:5432/tunakula
DATABASE_URL=postgres://tunakula_app:<APP_PW>@cloudsql-proxy:5432/tunakula
DATABASE_APP_ROLE=tunakula_app
TUNAKULA_TOKEN_SECRET=<32+ random chars>
TUNAKULA_API_HOSTS=<API_DOMAIN>
TUNAKULA_CONSOLE_ORIGINS=https://<SHOP_DOMAIN>,https://<ADMIN_DOMAIN>
TUNAKULA_MESSAGING_PROVIDER=twilio
TUNAKULA_TWILIO_ACCOUNT_SID=...
TUNAKULA_TWILIO_AUTH_TOKEN=...
TUNAKULA_TWILIO_SMS_FROM=+...
# one or more payment connectors:
STRIPE_SECRET_KEY=...        STRIPE_WEBHOOK_SECRET=...
# NEVER set TUNAKULA_SANDBOX_PAYMENTS or TUNAKULA_DEV_OTP in production.
```
Point `deploy/Caddyfile` at your real domain: replace `api.tunakula.com` with `<API_DOMAIN>`.

### 2d. DNS
Create an **A record**: `<API_DOMAIN>` → `<VPS_IP>`. (Caddy needs this resolving to issue TLS.)

**CHECK:** `dig +short <API_DOMAIN>` returns `<VPS_IP>`.

### 2e. Launch
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f api
```
The API migrates on boot (owner role) then listens.

**CHECK:** logs show `migrations applied` then `api listening`; and from your laptop:
```bash
curl https://<API_DOMAIN>/v1/health    # → {"status":"ok",...}, valid TLS
```

---

## PHASE 3 — First Super Admin

```bash
docker compose -f deploy/docker-compose.prod.yml exec api \
  npm run bootstrap-admin -w @tunakula/api -- +243810000000 "Launch Owner"
```
(Use the real phone number of the launch owner.)

**CHECK:** the command prints success; the number can receive SMS.

---

## PHASE 4 — Frontends on Vercel (two projects)

Do this twice — once for customer, once for admin.

1. Vercel → **Add New → Project** → import `jnnseya-cpu/Tunakula`.
2. **Root Directory:** `frontend/customer` (second project: `frontend/admin`).
3. Turn ON **"Include files outside the root directory"** (the build needs `shared/`).
4. Framework preset: **Other** (the repo's `vercel.json` already sets the build command + `out/` output).
5. **Environment variable:** `NEXT_PUBLIC_API_URL = https://<API_DOMAIN>`.
6. Deploy. Then add your custom domain: `<SHOP_DOMAIN>` (customer) / `<ADMIN_DOMAIN>` (admin) in Project → Settings → Domains, and create the DNS records Vercel shows.

**CHECK:** both sites load over HTTPS; open dev-tools Network and confirm they call `https://<API_DOMAIN>` with no CORS error. (If CORS fails, fix `TUNAKULA_CONSOLE_ORIGINS` in `deploy/.env.prod` and `docker compose ... up -d` again.)

---

## PHASE 5 — Publish the launch market

1. Sign in to `https://<ADMIN_DOMAIN>` as the Super Admin (code arrives by SMS).
2. A country admin creates a **Country Profile** draft; the Super Admin publishes it with the readiness sign-off.

**CHECK:** `curl https://<API_DOMAIN>/v1/countries` returns a non-empty list; the storefront shows the market.

---

## PHASE 6 — Payments go-live

1. Add **production** connector credentials (already in `.env.prod`, or via Admin → Integrations).
2. Register each connector's **webhook URL** with the PSP, pointing at your API.
3. Re-run the connector **certification** path against live credentials.

**CHECK:** a real low-value test order authorizes, settles, and its webhook is received (order advances).

---

## PHASE 7 — Smoke test & full rehearsal

```bash
node tools/smoke-test.mjs https://<API_DOMAIN>
```
Then place **one real end-to-end order**: customer sign-in → order → pay → kitchen accept → rider assign → deliver with the verification code.

**CHECK:** smoke test all-green (the "no published markets" warning is gone); the rehearsal order delivers and the settlement journal balances.

---

## PHASE 8 — Go / No-Go gate

Ship only when **every** box is true:
- [ ] API healthy over HTTPS; migrations applied.
- [ ] Super Admin signs in via real SMS.
- [ ] ≥1 market published; `/v1/countries` non-empty.
- [ ] A production payment authorized + settled + webhook received.
- [ ] Smoke test green; rehearsal order delivered + settled.
- [ ] Cloud SQL backups + PITR on; restore drill done.
- [ ] Both frontends live on their domains with correct CORS.

When all are ticked — **you are live.**

---

## Day-2 operations

- **Rollback a bad API release:** `git checkout <previous tag> && docker compose -f deploy/docker-compose.prod.yml up -d --build`. Migrations are forward-only; never down-migrate — fix forward in a new migration.
- **Rollback a bad frontend:** Vercel → Deployments → promote the previous deployment (instant).
- **Rollback a bad Country Profile:** publish the prior version; every API instance picks it up within ~1 min.
- **Watch the first 24h:** error rate, p95 latency, the sweep logs, payment webhook success. Export orders + rider payouts from the admin console for the first reconciliation.

See also: `docs/runbooks/go-live.md` (cutover rehearsal) and `deploy/cloudsql-setup.md` (database detail).
