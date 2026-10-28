# Tunakula — Production Promotion Runbook

Promote the StackFood data into the **live** Tunakula tables. This is the second, deliberate step after staging (`run.ts --apply`) is green. It runs through the app's own persistence layer under the country's FORCE RLS, is idempotent, and does **not** replay historical orders.

Proven end-to-end on the real export (16 merchants, 16 branches, 1,912 dishes with 10,632 add-ons / 2,887 variation options) and covered by `backend/api/test-http/migrator-promote.test.ts`.

## Prerequisites
- The production Postgres is reachable and you have its **owner** URL (the role migrations use; `NOBYPASSRLS`, so the per-country RLS still gates every write).
- The target market is **published** (admin → Markets, or the `publish-market` CLI). Promotion refuses to run into an unpublished market.
- A fresh StackFood dump loaded into a MySQL the migrator can read (or the live StackFood MySQL).
- `npm i -D mysql2` in `backend/api` (already in devDependencies).

## One run, three commands
```bash
cd backend/api
export STACKFOOD_MYSQL_URL="mysql://readonly:***@<stackfood-host>:3306/<stackfood-db>"
export DATABASE_OWNER_URL="postgres://<owner>:***@<pg-host>:5432/<tunakula-db>"

# 1. Stage + reconcile (writes only to the reviewable migration.* schema)
npx tsx src/migrator/run.ts --apply          # expect: RECONCILE OK, 0 skipped

# 2. Dry-run the promotion (writes nothing; shows exactly what would be created)
npx tsx src/migrator/promote.ts CD           # review the counts

# 3. Promote into the live tables (branches stay unpublished unless you add --publish)
npx tsx src/migrator/promote.ts CD --apply            # import, leave unpublished for review
# …review in the admin console, then either publish per-branch there, or:
npx tsx src/migrator/promote.ts CD --apply --publish  # publish every branch that has ≥1 available dish
```

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
