# Tunakula — StackFood Data Migration Report

**Status: DRY RUN + STAGED — RECONCILE OK.** The real StackFood database was migrated through the transforms into a reviewable Postgres staging schema (`migration.*`) with **zero rejected rows**. Promotion into the live tenant tables is the next, separate step (see below) and is **not** done yet.

Run date: 2026-10-28 · Source: StackFood v8.0 export `u400404954_vzzzK.sql` (the correct application DB — 127 tables incl. `food`, `add_ons`, `restaurants`, `orders`).

## What came through
| Entity | Source | Loaded | Skipped |
|--------|-------:|-------:|--------:|
| Customers (users) | 109 | 109 | 0 |
| Merchants (vendors) | 16 | 16 | 0 |
| Branches (restaurants) | 16 | 16 | 0 |
| Menu items (food) | 2,320 | 2,320 | 0 |
| Orders | 109 | 109 | 0 |

- **Order-value reconciliation:** source vs. loaded totals **match** (CDF, 0 minor digits).
- **Add-ons:** **10,632** paid extras across **1,542** items (resolved from the 117-row `add_ons` catalogue) — the data that was silently dropped in the earlier attempts now carries.
- **Variations:** **2,887** options across **450** items.
- Items: 2,125 available, 195 unavailable (preserved from StackFood `status`).
- Orders: 57 delivered, 52 cancelled (mapped via the StackFood→Tunakula state map).
- Customer phones normalised to **E.164** (`+243…`) so each migrated customer signs in with the number they already use.

The 16 branches: BigBite Kinshasa Mall, J-FAST FOOD, JMM Hope (Traiteur), LA TREIZIÈME, Lagrâce Cuisine, Le Balcon Kintambo, Les Délices de Bambi, Loving Hut, MALAMU, MOOD, Master Chef, Mehfil, NickyB ETS, ROLLS (Burger & More), Tacos Land, Tunakula.

Sample migrated dish (proves add-ons + variations ride along):
> **Brochettes de viande** — add-ons: Bavaria, Bouteille d'eau, Chikwangue, Frites de Pomme de Terre, Makemba · variation group "Garnitures" (MULTI, pick 1–3): Piment, oignons, mayonnaise.

## Fix this run required (committed)
- **`migrator/mapping.ts`:** `SOURCE_TABLES.items` was `"items"`; StackFood/6amMart v8.0 names the menu-item table **`food`**. Corrected. The mapping header already flagged that table names need a per-install check; this is that correction. Migrator unit tests still green (18/18).
- Two **local-only, non-destructive** shims were applied to the loaded *copy* of the dump so the migrator's queries run against this older single-module install — **not** to your live database: an empty `modules` table and a nullable `restaurants.module_id` column (this install predates StackFood's multi-module feature; store type correctly falls back to RESTAURANT).

## How this was run (reproducible)
1. Loaded the `.sql` dump into a local MariaDB `stackfood` database.
2. `STACKFOOD_MYSQL_URL=mysql://…/stackfood npx tsx backend/api/src/migrator/run.ts` → dry run, reconcile OK.
3. `… --apply DATABASE_OWNER_URL=postgres://…/tunakula_migration` → loaded into `migration.*` staging.

## Next step — promotion to live (NOT done; needs your infra)
Staging lives in an **ephemeral** Postgres in this session; it is a proof + review artifact, not your production data. To promote for real:
1. Run the same migrator on the **production** host, pointed at the live StackFood MySQL (or this dump loaded there) and the **production** Tunakula Postgres `DATABASE_OWNER_URL`, with `--apply`.
2. Review the `migration.*` staging rows (counts above + spot-check menus/add-ons).
3. Run the **promotion** step (staging → live tenant tables through the app's services, so RLS, id-remapping and invariants hold). That step is deliberately separate and only runs once you've reviewed staging.

I can drive steps 1–2 and prepare 3 as soon as the production Postgres is reachable (it's the same deploy access as human-actions.md item E).
