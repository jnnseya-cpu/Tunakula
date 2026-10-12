# PostgreSQL 16 on Google Cloud SQL

The Tunakula ledger is double-entry money, so the database is the one tier worth paying a managed
provider for: automated backups, point-in-time recovery, and a restore drill you can actually run.
This guide creates the instance, the two database roles the app needs, and the connection path from
the Hostinger VPS that runs the API.

The app connects with **two roles** (see `deploy/initdb.sql`): a migrating owner `tunakula`
(owns the schema, runs migrations on boot — CREATEDB, **not** superuser, **not** BYPASSRLS) and the
least-privilege app role `tunakula_app` (what the API queries as — never bypasses RLS). On Cloud SQL
you do not get a SUPERUSER, but you do not need one: `tunakula` owns its database and that is enough.

---

## 1. Create the instance

```bash
gcloud sql instances create tunakula-prod \
  --database-version=POSTGRES_16 \
  --tier=db-custom-2-7680 \
  --region=europe-west1 \
  --storage-type=SSD --storage-size=20GB --storage-auto-increase \
  --backup --backup-start-time=02:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=14 --retained-transaction-log-days=7 \
  --availability-type=ZONAL      # switch to REGIONAL for HA once traffic justifies it
```

- `--enable-point-in-time-recovery` + `--backup` is the PITR the go-live runbook requires.
- Set the `postgres` superuser password once (used only for admin, never by the app):
  `gcloud sql users set-password postgres --instance=tunakula-prod --prompt-for-password`

## 2. Create the database and the two roles

Cloud SQL has no `CREATE ROLE ... SUPERUSER`, so we create the roles with exactly the attributes
`initdb.sql` uses (minus the local passwords — set strong ones here).

```bash
# Roles (Cloud SQL users = Postgres roles). NOSUPERUSER/NOBYPASSRLS are the defaults here.
gcloud sql users create tunakula      --instance=tunakula-prod --prompt-for-password
gcloud sql users create tunakula_app  --instance=tunakula-prod --prompt-for-password

# Connect as the postgres admin to finish setup:
gcloud sql connect tunakula-prod --user=postgres
```

Then in the `psql` session:

```sql
ALTER ROLE tunakula CREATEDB;         -- migrator needs CREATEDB; it is NOT superuser, NOT BYPASSRLS
CREATE DATABASE tunakula OWNER tunakula;
-- tunakula_app gets its table grants automatically from the migrator at API boot — nothing to do here.
```

> RLS note: tables use `FORCE ROW LEVEL SECURITY`, so even the owner is subject to policies. The app
> role `tunakula_app` can never bypass RLS. Confirm after first boot:
> `SELECT rolbypassrls FROM pg_roles WHERE rolname IN ('tunakula','tunakula_app');` → both `f`.

## 3. Connect the VPS to Cloud SQL

Use the **Cloud SQL Auth Proxy** on the Hostinger VPS — it gives an encrypted local socket without
managing IP allowlists or client certs.

```bash
# On the VPS: download the proxy and a service-account key with role roles/cloudsql.client
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.13.0/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy
./cloud-sql-proxy --credentials-file=key.json --address 0.0.0.0 --port 5432 \
  <PROJECT>:europe-west1:tunakula-prod
```

Run it as its own `systemd` service (restart=always) or add it as a sidecar container to
`docker-compose.prod.yml` on the same Docker network as `api`, exposing `:5432`. Then the API's
connection URLs (in `deploy/.env.prod`) point at the proxy:

```
DATABASE_OWNER_URL=postgres://tunakula:<owner-pw>@cloudsql-proxy:5432/tunakula
DATABASE_URL=postgres://tunakula_app:<app-pw>@cloudsql-proxy:5432/tunakula
DATABASE_APP_ROLE=tunakula_app
```

(Alternative without the proxy: assign the instance a public IP, add the VPS IP to
`--authorized-networks`, and require SSL. The proxy is preferred — no IP pinning, auto-rotated certs.)

## 4. Restore drill (do this before launch, per the runbook)

```bash
# Clone the instance to a throwaway from a point in time, prove it comes up, then delete it.
gcloud sql instances clone tunakula-prod tunakula-restore-test \
  --point-in-time=2026-01-01T02:05:00Z
gcloud sql connect tunakula-restore-test --user=postgres   # verify data/tables exist
gcloud sql instances delete tunakula-restore-test
```

A restore you have never tested is not a backup. Run this drill now and again after any schema change.
