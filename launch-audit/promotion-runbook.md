# Tunakula — Production Promotion Runbook

Promote the StackFood data into the **live** Tunakula tables. This is the second, deliberate step after staging (`run.ts --apply`) is green. It runs through the app's own persistence layer under the country's FORCE RLS, is idempotent, and does **not** replay historical orders.

Proven end-to-end on the real export (16 merchants, 16 branches, 1,912 dishes with 10,632 add-ons / 2,887 variation options) and covered by `backend/api/test-http/migrator-promote.test.ts`.

## Prerequisites
- The coexist stack is up on the VPS (`deploy/go-live-coexist.sh`), so the `api` and `db` containers are running.
- The target market is **published** (admin → Markets, or the `publish-market` CLI). Promotion refuses to run into an unpublished market.
- For staging only: a MySQL holding the StackFood dump, reachable from the compose network.

## IMPORTANT — run it inside the container, not on the host
The production Postgres runs **only on the internal compose network with no host port**, so neither the VPS host shell nor a GitHub runner can reach it. And the host checkout has no `node_modules`. So `npx tsx …` on the host fails (that is exactly the `ERR_MODULE_NOT_FOUND` / wrong-directory error you hit).

Run the migrator **inside the already-running `api` container**, which the image builds with `tsx` + `mysql2` + the migrator source and with `DATABASE_OWNER_URL=…@db:5432/tunakula` already set. From the Tunakula repo checkout on the VPS (your deploy `APP_DIR`, e.g. `/root/Tunakula` — NOT `/srv/construx/app`):

```bash
cd "$APP_DIR"                                  # the Tunakula monorepo checkout (has deploy/)
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"

# 1. Stage + reconcile (only needed to (re)load migration.* from StackFood).
#    Point STACKFOOD_MYSQL_URL at a MySQL on the compose network holding the dump.
$C exec -T -e STACKFOOD_MYSQL_URL="mysql://mig:***@<mysql-host>:3306/stackfood" \
    api node --import tsx src/migrator/run.ts --apply      # expect: RECONCILE OK

# 2. Dry-run the promotion (writes nothing).
$C exec -T api node --import tsx src/migrator/promote.ts CD

# 3. Promote into the live tables (branches stay unpublished unless you add --publish).
$C exec -T api node --import tsx src/migrator/promote.ts CD --apply
# …review in the admin console, then publish there, or publish all at once:
$C exec -T api node --import tsx src/migrator/promote.ts CD --apply --publish
```

## Or: the one-button GitHub Actions workflow (no SSH)
`.github/workflows/promote-data.yml` → Actions tab → **Promote data** → **Run workflow**. It SSHes to the VPS and runs exactly the container commands above, then prints the live catalogue counts. Inputs:
- **country** — the published market (default `CD`).
- **mode** — `dry-run` (default, safe), `promote`, or `promote-and-publish`.
- **stage_first** — also re-stage from StackFood first (needs the `STACKFOOD_MYSQL_URL` repo secret).
- **confirm** — must be typed as `PROMOTE` for any write mode, so a stray click can't touch live data.

It reuses the same `VPS_*` secrets and `VPS_APP_DIR` variable as the Deploy web workflow.

## What it does / does not do
- **Creates:** restaurant groups (merchants), an owner account + `RESTAURANT_OWNER` binding per vendor that has a phone, branches (store type, commune, lat/lng), and menu items with their add-ons and variations.
- **Idempotent:** every created row is recorded in `migration.promotion_map`; re-running promotes only what is new. Safe to run, review, and run again.
- **Orders:** NOT promoted. Historical orders stay in `migration.order_hdr` as read-only history — replaying them would fabricate ordering events, money-journal and payment rows. If open balances ever need carrying over, do it through finance as a separate, explicit reconciliation.
- **Orphans:** items whose StackFood restaurant no longer exists (≈408 in the current dump) are skipped and reported, not force-inserted.

## Verify after promotion
```sql
SET app.country='CD';
SELECT count(*) FROM catalogue.restaurant_group;                               -- merchants
SELECT count(*), count(*) FILTER (WHERE published_at IS NOT NULL) FROM catalogue.branch;
SELECT count(*),
       count(*) FILTER (WHERE jsonb_array_length(addons)>0)      AS with_addons,
       count(*) FILTER (WHERE jsonb_array_length(variations)>0)  AS with_variations
  FROM catalogue.menu_item;
SELECT count(*) FROM identity.role_binding WHERE role='RESTAURANT_OWNER';       -- owner logins
```

## Rollback
Promotion only inserts; it never deletes or overwrites live rows (idempotent via the map). If a run must be undone before the market is public, the safe path is to restore the pre-promotion database snapshot you take right before step 3. Take that snapshot.

## Cutover note
The dump is a point-in-time copy. Re-export fresh immediately before the real cutover so no orders/menu edits made in the gap are lost, then run the three commands once. The whole chain takes minutes.
