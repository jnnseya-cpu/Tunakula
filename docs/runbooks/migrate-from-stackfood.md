# Migrate from StackFood (MySQL) to Tunakula (Postgres)

This moves the live Kinshasa data off the old StackFood MySQL onto the new Tunakula platform, **without
losing a customer, an order, or a franc**. It runs in two halves: first a safe extract → transform →
reconcile that writes nothing to the live tables, then (a later, separate step) a promotion into the live
schema through the app's own services.

The code lives in `backend/api/src/migrator/`:

- `transform.ts` — pure, unit-tested row transforms (phone → E.164, decimals → integer minor units,
  validation). Every rejected row is reported, never silently dropped.
- `reconcile.ts` — pure count/sum reconciliation: proves the target holds what the source did.
- `mapping.ts` — the **field map**: which StackFood table/column holds each field, the order-status and
  store-type mappings, and the per-market config (DRC/CDF by default).
- `run.ts` — the CLI that connects to both databases and drives the above.

## Step 0 — get the schema and correct the field map (the one manual step)

```bash
mysqldump --no-data --no-tablespaces -u <user> -p <stackfood_db> > stackfood_schema.sql
```

Open it and reconcile every name in `mapping.ts` (`SOURCE_TABLES` and the `fields` map) against the real
tables and columns. StackFood's defaults are pre-filled, but a customised install will differ. Also check
`stackfoodStateFor` (order statuses) and `stackfoodStoreTypeFor` (modules) cover the values your dump
actually uses. **This is the only file you edit.**

## Step 1 — dry run (reads only, writes nothing)

```bash
cd backend/api
npm i -D mysql2                       # the CLI's MySQL driver (kept out of the API image)
export STACKFOOD_MYSQL_URL='mysql://readonly:pass@old-host:3306/stackfood'
npx tsx src/migrator/run.ts           # extract + transform + reconcile
```

Read the output: every row that could not be transformed is listed with its reason, then a reconciliation
report (source vs transformed counts, and total order value). Fix the field map and re-run until the
problem list is empty (or every remaining problem is a row you accept dropping, e.g. test accounts).

## Step 2 — load the staging schema (reviewable, idempotent)

```bash
export DATABASE_OWNER_URL='postgres://owner:pass@new-host:5432/tunakula'
npx tsx src/migrator/run.ts --apply   # loads canonical records into the `migration.*` schema
```

This writes the clean records into a **`migration` schema** in Postgres — `migration.user`,
`migration.merchant`, `migration.branch`, `migration.item`, `migration.order_hdr` — keyed by the source id
and upserted, so it is safe to re-run. Nothing touches the live tenant tables yet. Inspect the staging
tables and the reconcile report; this is the data exactly as it will land.

## Step 3 — promote into the live schema (next increment)

Promotion maps the staging records into the live Tunakula tables **through the app's services** (onboarding,
catalogue, orders), so Row-Level Security, id-remapping and every invariant hold — a raw `INSERT` into the
tenant tables would bypass all of that. This step is written once the field map is confirmed against the
real dump and the staging load reconciles clean; it is intentionally not a raw SQL copy.

## Step 4 — cut a cohort over

With staging reconciled and promotion done for a pilot cohort, follow the staged-rollout plan: a small set
of customers, riders and restaurants move to the new apps first (they sign in with the same phone number),
measured against StackFood, before the full flip. See the re-platforming roadmap.
