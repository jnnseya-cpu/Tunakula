# Tunakula — Big-Bang Cutover Runbook

The one-shot switch from the old StackFood-based system to the new Tunakula platform: freeze the
old system, migrate **all** live data, prove it reconciles, flip every surface to the new backend,
and force the old apps/storefront to update. For the data-staging mechanics (dump vs. live MySQL,
running inside the `api` container) see `launch-audit/promotion-runbook.md`; this runbook is the
end-to-end sequence and the go/no-go gates.

What migrates now (all covered by `backend/api/test-http/migrator-promote.test.ts`):

| Domain | Target | Notes |
|---|---|---|
| Customers (identity) | `identity.app_user` | phone → account, idempotent by phone |
| Merchants / branches / menu (+ add-ons, variations) | `catalogue.*` | published with `--publish` |
| **Saved addresses** | `identity.saved_address` | one default per customer |
| **Wallet balance + history** | `wallet.transaction` | full replay, **cent-level reconcile gate** |
| **Order history (headers + line items)** | `ordering.order_view` + `order_event` | read-only; no fabricated financials |

**Not** migrated by the tool, by design: the platform double-entry opening books (a separate,
explicit finance step) and any live PSP/settlement state. The migrator only ever **reads** the old
database, so the old system stays intact for rollback.

---

## 0. Prerequisites (day before)

- New stack is up on the VPS: `/srv/Tunakula`, compose project `deploy`
  (`deploy/docker-compose.coexist.yml`, env `deploy/.env.staging`). Health: `GET /v1/health` → `ok`.
- Code is current: `cd /srv/Tunakula && bash deploy/update-vps.sh`.
- The DRC market (`CD`) is **published** (admin → Markets, or the `publish-market` CLI). Promotion
  refuses to run into an unpublished market.
- Integrations keys are set (admin → Integrations): payment rail, SMS, maps, and the AI model (for
  the Nutri-Score backfill).
- You can reach the live StackFood database (a read-only MySQL user, or a fresh `.sql` dump).
- A full backup of **both** databases (old StackFood MySQL and the new Postgres) is taken and
  verified restorable.

Shorthand used below (run from `/srv/Tunakula`):
```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"
```

---

## 1. Freeze the old system

1. Put the old StackFood apps/site into maintenance (stop accepting new orders and wallet top-ups).
2. Let in-flight orders finish or cancel+refund them on the **old** system (don't migrate money that
   is still moving).
3. Note the freeze time. From here the old DB is read-only input to the migration.

---

## 2. Stage the data (dry run first)

Stage the old data into the reviewable `migration.*` schema. From a `.sql` dump:
```bash
bash deploy/stage-from-dump.sh /srv/stackfood.sql
```
…or from a reachable live MySQL, inside the container:
```bash
$C exec -T -e STACKFOOD_MYSQL_URL="mysql://ro_user:pass@host:3306/stackfood" api \
  node --import tsx src/migrator/run.ts --apply
```
Read the reconciliation report it prints. **Gate 2 — staging is green when:**
- every entity's `loaded` equals `source − skipped` (no unexplained drops), and
- the rejected-rows list is empty or every rejection is understood (e.g. a user with no phone).

Fix the field map (`backend/api/src/migrator/mapping.ts`) or the source data and re-stage if not.

---

## 3. Promote — dry run, then the reconcile gate

Dry run first (writes nothing):
```bash
$C exec -T api node --import tsx src/migrator/promote.ts CD
```
**Gate 3 — this is the hard money gate. Do NOT proceed unless:**
- `wallet` reports **0 reconciliation failures** (`WALLET RECONCILIATION FAILED for N customer(s)` must
  not appear — every replayed balance lands exactly on the source balance), and
- the customer / address / order / wallet counts match what you expect from staging.

A wallet mismatch means the source history doesn't sum to the source balance for that customer; the
tool reports each one and refuses to import it. Resolve at source (or accept the loss explicitly) and
re-run the dry run until it is clean.

---

## 4. Promote for real

```bash
$C exec -T api node --import tsx src/migrator/promote.ts CD --apply --publish
```
Idempotent — safe to re-run; it only writes what is new. Then verify in the live DB:
```bash
$C exec -T api node --import tsx src/db/psql-check.ts CD   # if present; otherwise spot-check below
```
Spot checks (inside the `db` container, as the owner, in a `CD` country context):
- Wallet totals match the source: for a sample of customers, `sum(amount_minor)` in
  `wallet.transaction` equals their old `wallet_balance`.
- Order history is visible: `ordering.order_view` row count ≈ migrated orders; a sample order's
  `ORDER_DRAFTED` event carries its line items.
- Addresses: each migrated customer has ≤ their source address count and exactly one default.

Then fill nutrition so dishes carry a Nutri-Score:
```bash
$C exec -T api npm run backfill-nutrition -- CD
```

---

## 5. Flip every surface + force the update

The new backend is already live; this step retires the old one and makes old clients update.

1. **Point the apps/storefront domains at the new backend.** New customer/restaurant/rider app builds
   and the web storefront already target the new API; publish them if not already in the stores.
2. **Turn on the force-update kill-switch** (DB-backed, no redeploy). As a `CD` market admin, per app
   and platform — and the storefront — set the minimum supported version and `mandatory:true`:
   ```bash
   curl -X POST https://api.tunakula.com/v1/admin/app-releases \
     -H "authorization: Bearer <admin-token>" -H "x-country: CD" \
     -H "idempotency-key: $(uuidgen)" -H "content-type: application/json" \
     -d '{"app":"customer","platform":"android","min_supported":"2.0.0","store_url":"https://play.google.com/store/apps/details?id=com.tunakula.customer","mandatory":true,"message":"A new Tunakula is here — please update."}'
   ```
   Repeat for `customer/ios`, `restaurant/{android,ios}`, `rider/{android,ios}`, and
   `storefront/web`. Below the floor, the API returns `426 UPDATE_REQUIRED` and the apps show a
   blocking "Update required" screen; the storefront shows a "Reload now" gate. (Set the storefront
   build's `NEXT_PUBLIC_APP_VERSION` so its gate is active.)
3. **Retire the old backend.** The old apps talk to the **old** backend, which we don't control from
   here, so point the old API domain / old app endpoint at a static "please update Tunakula" response
   (or a maintenance page). This is the only way to tell users still on the old apps to move.

---

## 6. Verify live, then stand down

- Place a real test order end-to-end on the new apps (customer → restaurant accept → rider deliver).
- A migrated customer signs in with their existing phone, sees their wallet balance, past orders and
  saved addresses.
- Payments: a real top-up and an order payment clear through the live provider.
- Watch error rates and the dispatch board for the first orders.

---

## Rollback

Because the migrator only reads the old DB and the new Postgres is additive/idempotent, rollback is
clean **as long as you have not re-pointed and retired the old system (step 5)**:

- **Before step 5:** just don't flip. Investigate, fix, re-run staging/promote (idempotent).
- **After step 5, if the new system is unhealthy:** revert the app/storefront domains and the old API
  domain to the old stack, and clear the force-update floors (`mandatory:false`). The old database was
  untouched, so the old system resumes where it froze. Any orders placed on the new system during the
  window must be reconciled by hand.

Keep both backups until the new system has run clean for at least one full business day.
