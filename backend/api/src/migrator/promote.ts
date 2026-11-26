/**
 * StackFood staging → Tunakula LIVE promotion (CLI).
 *
 *   tsx src/migrator/promote.ts CD             # dry run: report what WOULD be promoted, write nothing
 *   tsx src/migrator/promote.ts CD --apply     # promote the staged records into the live tenant tables
 *   tsx src/migrator/promote.ts CD --apply --publish   # also publish branches that have ≥1 available dish
 *
 * This is the SECOND, deliberate step after `run.ts --apply` has loaded the reviewable `migration.*` staging
 * schema and its reconciliation is green. It reads the staged canonical records and writes them into the live
 * tables THROUGH the app's own persistence layer (catalogue / identity), inside a per-country transaction so
 * FORCE RLS, the brand/country sealing and every table invariant hold exactly as they do for a live request.
 *
 * Idempotent: every created live row is recorded in `migration.promotion_map (entity, source_id → live_id)`,
 * so a re-run promotes only what is new and never duplicates. Safe to run, review, and run again.
 *
 * What it promotes: merchants (→ restaurant groups, with an owner account + RESTAURANT_OWNER binding when the
 * vendor has a phone), branches (→ stores, unpublished unless --publish), and menu items (with their add-ons
 * and variations). What it does NOT promote: historical ORDERS. Replaying them would fabricate ordering
 * events, money-journal and payment rows; they stay in `migration.order_hdr` as reviewable history. Migrate
 * open balances through finance as a separate, explicit reconciliation if that is ever needed.
 *
 * Env:
 *   DATABASE_OWNER_URL   the Tunakula Postgres owner URL (owns both migration.* and the live tables; NOBYPASSRLS,
 *                        so the country context below still gates every tenant write)
 */
import { randomUUID } from "node:crypto";
import { connect, type Db, type Sql } from "../db/db.ts";
import {
  addMenuItem, createBranch, ensureGroup, getBranch, publishBranch, setAvailability,
  type Addon, type MenuItemInput, type Variation,
} from "../persistence/catalogue.ts";
import { addBinding, createUser, userByPhone } from "../persistence/identity.ts";
import { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { loadVersions } from "../persistence/config.ts";
import type {
  AddressRecord, BranchRecord, MenuItemRecord, MerchantRecord, MigratedVariation, UserRecord, WalletTxRecord,
} from "./transform.ts";

const MAP_DDL = `
CREATE SCHEMA IF NOT EXISTS migration;
CREATE TABLE IF NOT EXISTS migration.promotion_map (
  entity text NOT NULL,
  source_id text NOT NULL,
  live_id text NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, source_id)
);`;

interface Staged<T> { source_id: string; record: T }

async function readStaged<T>(sql: Sql, table: string): Promise<Staged<T>[]> {
  const rows = await sql.query<{ source_id: string; record: T }>(`SELECT source_id, record FROM migration.${table}`);
  return rows.map((r) => ({ source_id: r.source_id, record: r.record }));
}

/** The source_id → live_id map for one entity, so re-runs skip what is already promoted and FKs can be remapped.
 *  Returns empty when the map table does not exist yet (a dry run never creates it). */
async function loadMap(sql: Sql, entity: string): Promise<Map<string, string>> {
  const exists = await sql.query<{ reg: string | null }>("SELECT to_regclass('migration.promotion_map')::text AS reg");
  if (!exists[0]?.reg) return new Map();
  const rows = await sql.query<{ source_id: string; live_id: string }>(
    "SELECT source_id, live_id FROM migration.promotion_map WHERE entity = $1", [entity],
  );
  return new Map(rows.map((r) => [r.source_id, r.live_id]));
}

async function remember(sql: Sql, entity: string, sourceId: string, liveId: string): Promise<void> {
  await sql.query(
    "INSERT INTO migration.promotion_map (entity, source_id, live_id) VALUES ($1,$2,$3) ON CONFLICT (entity, source_id) DO UPDATE SET live_id = EXCLUDED.live_id",
    [entity, sourceId, liveId],
  );
}

/** Staged add-ons/variations carry name + minor price; the live catalogue shape also needs stable ids. */
function toAddons(record: MenuItemRecord): Addon[] {
  return record.addons.map((a) => ({ id: `ao-${randomUUID().slice(0, 8)}`, name: a.name, price: a.priceMinor }));
}
function toVariations(record: MenuItemRecord): Variation[] {
  return record.variations.map((v: MigratedVariation) => ({
    id: `var-${randomUUID().slice(0, 8)}`,
    name: v.name,
    type: v.type,
    required: v.required,
    min: v.min,
    max: v.max,
    options: v.options.map((o) => ({ id: `opt-${randomUUID().slice(0, 8)}`, name: o.name, price: o.priceMinor })),
  }));
}

/** A customer whose replayed wallet did not reconcile to the source balance — reported, never imported. */
export interface WalletMismatch { readonly customerSourceId: string; readonly expectedMinor: string; readonly replayedMinor: string; readonly reason: string }
export interface PromotionSummary { merchants: number; owners: number; branches: number; items: number; itemsUnavailable: number; published: number; skipped: number; customers: number; orders: number; addresses: number; walletTx: number; walletCustomers: number; walletMismatches: WalletMismatch[] }

/** Promote the staged `migration.*` records into the live tables for one country. Pure of argv/env so it is testable. */
export async function promote(db: Db, country: string, opts: { apply: boolean; doPublish: boolean }): Promise<PromotionSummary> {
  const { apply, doPublish } = opts;
  const summary: PromotionSummary = { merchants: 0, owners: 0, branches: 0, items: 0, itemsUnavailable: 0, published: 0, skipped: 0, customers: 0, orders: 0, addresses: 0, walletTx: 0, walletCustomers: 0, walletMismatches: [] };
  {
    // The market must be published: its profile names the brand every promoted store belongs to.
    const registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [], apiHosts: {} });
    registry.restore(await db.tx({}, loadVersions));
    const published = registry.published(country);
    if (!published) throw new Error(`market ${country} is not published — publish it (admin → Markets, or publish-market CLI) before promoting into it`);
    const brand = published.profile.experience.brand_id;

    if (apply) await db.tx({}, (sql) => sql.query(MAP_DDL));

    // Read the whole staging set first (no country context needed — migration.* is not an RLS tenant schema).
    const [merchants, branches, items, orders] = await db.tx({}, async (sql) => [
      await readStaged<MerchantRecord>(sql, "merchant"),
      await readStaged<BranchRecord>(sql, "branch"),
      await readStaged<MenuItemRecord>(sql, "item"),
      await readStaged<UserRecord>(sql, "order_hdr").catch(() => []), // only for the count
    ]);
    // users read separately (reserved word as a table name)
    const users = await db.tx({}, (sql) => sql.query<{ source_id: string; record: UserRecord }>(`SELECT source_id, record FROM migration."user"`));
    const addresses = await db.tx({}, (sql) => readStaged<AddressRecord>(sql, "address")).catch(() => [] as Staged<AddressRecord>[]);
    const walletTxs = await db.tx({}, (sql) => readStaged<WalletTxRecord>(sql, "wallet_tx")).catch(() => [] as Staged<WalletTxRecord>[]);
    const settlementCurrency = published.profile.money.settlement_currency;

    const groupMap = await db.tx({}, (sql) => loadMap(sql, "merchant"));
    const branchMap = await db.tx({}, (sql) => loadMap(sql, "branch"));
    const itemMap = await db.tx({}, (sql) => loadMap(sql, "item"));
    const userMap = await db.tx({}, (sql) => loadMap(sql, "customer"));
    const addressMap = await db.tx({}, (sql) => loadMap(sql, "address"));
    const walletMap = await db.tx({}, (sql) => loadMap(sql, "wallet_tx"));

    // 1) Customers → global identity (phone + OTP). Idempotent by phone and by the promotion map.
    for (const { source_id, record } of users) {
      if (userMap.has(source_id)) { summary.skipped++; continue; }
      if (!apply) { userMap.set(source_id, "(new)"); summary.skipped++; continue; } // populate the map so a dry run can resolve addresses/orders
      const liveId = await db.tx({}, async (sql) => {
        const existing = await userByPhone(sql, record.phoneE164);
        const u = existing ?? (await createUser(sql, { phone: record.phoneE164, displayName: record.displayName ?? record.phoneE164.slice(-4), homeCountry: country }));
        await remember(sql, "customer", source_id, u.id);
        return u.id;
      });
      userMap.set(source_id, liveId); // so addresses/orders in THIS run resolve their customer
    }

    // 1b) Saved addresses → the customer's live address book. Keyed to the promoted customer via the user map;
    //     the first address a customer gets (with no existing default) is marked default to satisfy the one-
    //     default-per-customer invariant. Idempotent via the promotion map.
    const defaulted = new Set<string>(); // live user ids given a default in THIS run
    for (const { source_id, record } of addresses) {
      if (addressMap.has(source_id)) { summary.skipped++; continue; }
      const liveUserId = userMap.get(record.customerSourceId);
      if (!liveUserId) { summary.skipped++; continue; } // address for a customer that did not promote
      if (!apply) { summary.addresses++; continue; }
      await db.tx({ country }, async (sql) => {
        const [has] = await sql.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM identity.saved_address WHERE user_id = $1 AND country_iso2 = $2 AND is_default", [liveUserId, country],
        );
        const makeDefault = Number(has?.n ?? 0) === 0 && !defaulted.has(liveUserId);
        const [row] = await sql.query<{ id: string }>(
          `INSERT INTO identity.saved_address (country_iso2, user_id, label, lat, lng, landmark, contact_phone, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [country, liveUserId, record.label.slice(0, 60) || "Home", record.lat, record.lng, record.landmark, record.contactPhoneE164, makeDefault],
        );
        if (makeDefault) defaulted.add(liveUserId);
        await remember(sql, "address", source_id, row!.id);
      });
      addressMap.set(source_id, "(new)");
      summary.addresses++;
    }

    // 1c) Wallet replay → wallet.transaction. Per customer, replay every movement in time order while recomputing
    //     the running balance; it must never go negative AND, when the source balance is known, must land exactly
    //     on it. A customer failing either check is reported in walletMismatches and NOT imported — we never load a
    //     wrong balance. A customer with a balance but no movements gets one opening ADJUSTMENT so no money is lost.
    //     Idempotent via the promotion map. The platform double-entry opening journal is a separate finance step.
    {
      const byCustomer = new Map<string, WalletTxRecord[]>();
      for (const { record } of walletTxs) {
        const list = byCustomer.get(record.customerSourceId) ?? [];
        list.push(record);
        byCustomer.set(record.customerSourceId, list);
      }
      const balanceOf = new Map<string, string | null>();
      for (const { source_id, record } of users) balanceOf.set(source_id, record.walletBalanceMinor ?? null);
      const walletCustomers = new Set<string>([...byCustomer.keys(), ...users.filter((u) => u.record.walletBalanceMinor && u.record.walletBalanceMinor !== "0").map((u) => u.source_id)]);

      for (const custSourceId of walletCustomers) {
        if (!userMap.has(custSourceId)) { summary.skipped++; continue; } // customer did not promote
        const liveUserId = userMap.get(custSourceId)!; // a real id under --apply; a "(new)" placeholder in a dry run
        const txs = (byCustomer.get(custSourceId) ?? []).slice().sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.sourceId.localeCompare(b.sourceId));
        const sourceBalanceRaw = balanceOf.get(custSourceId) ?? null;

        type Move = { sourceId: string; amount: bigint; kind: WalletTxRecord["kind"]; reference: string | null; createdAt: string | null };
        let moves: Move[] = txs.map((t) => ({ sourceId: t.sourceId, amount: BigInt(t.amountMinor), kind: t.kind, reference: t.reference, createdAt: t.createdAt }));
        if (moves.length === 0) {
          if (!sourceBalanceRaw || sourceBalanceRaw === "0") continue; // no balance and no history — nothing to carry
          moves = [{ sourceId: `open:${custSourceId}`, amount: BigInt(sourceBalanceRaw), kind: "ADJUSTMENT", reference: "migrated opening balance", createdAt: null }];
        }
        if (walletMap.has(moves[0]!.sourceId)) { summary.skipped++; continue; } // already promoted (idempotent)

        let running = 0n;
        let negative = false;
        const withBalance = moves.map((m) => { running += m.amount; if (running < 0n) negative = true; return { ...m, balanceAfter: running }; });
        if (negative) { summary.walletMismatches.push({ customerSourceId: custSourceId, expectedMinor: sourceBalanceRaw ?? "?", replayedMinor: running.toString(), reason: "replay goes negative (source history out of order or incomplete)" }); continue; }
        if (sourceBalanceRaw !== null && running.toString() !== sourceBalanceRaw) {
          summary.walletMismatches.push({ customerSourceId: custSourceId, expectedMinor: sourceBalanceRaw, replayedMinor: running.toString(), reason: "replayed balance does not match the source wallet balance" });
          continue;
        }

        summary.walletCustomers++;
        summary.walletTx += withBalance.length;
        if (!apply) continue;
        await db.tx({ country }, async (sql) => {
          for (const m of withBalance) {
            await sql.query(
              `INSERT INTO wallet.transaction (country_iso2, user_id, currency, amount_minor, kind, order_id, reference, balance_after, created_at)
               VALUES ($1,$2,$3,$4,$5,NULL,$6,$7, COALESCE($8::timestamptz, now()))`,
              [country, liveUserId, settlementCurrency, m.amount.toString(), m.kind, `mig:${m.sourceId}${m.reference ? ":" + m.reference : ""}`.slice(0, 200), m.balanceAfter.toString(), m.createdAt],
            );
            await remember(sql, "wallet_tx", m.sourceId, liveUserId);
          }
        });
      }
    }

    // 2) Merchants → restaurant groups (+ an owner account bound RESTAURANT_OWNER when a vendor phone exists).
    for (const { source_id, record } of merchants) {
      if (groupMap.has(source_id)) continue;
      const groupId = `rg-mig-${source_id}`;
      if (apply) {
        await db.tx({ country }, (sql) => ensureGroup(sql, { id: groupId, country, name: record.name, createdBy: null }));
        if (record.ownerPhoneE164) {
          await db.tx({}, async (sql) => {
            const existing = await userByPhone(sql, record.ownerPhoneE164!);
            const owner = existing ?? (await createUser(sql, { phone: record.ownerPhoneE164!, displayName: record.name, homeCountry: country }));
            await addBinding(sql, { userId: owner.id, role: "RESTAURANT_OWNER", scope: { type: "RESTAURANT_GROUP", id: groupId } });
            summary.owners++;
          });
        }
        await db.tx({}, (sql) => remember(sql, "merchant", source_id, groupId));
      }
      groupMap.set(source_id, groupId);
      summary.merchants++;
    }

    // 3) Branches → stores (unpublished; FK to the promoted group via the merchant map).
    for (const { source_id, record } of branches) {
      if (branchMap.has(source_id)) continue;
      const groupId = groupMap.get(record.merchantSourceId);
      if (!groupId) { summary.skipped++; continue; } // orphan branch — its merchant did not promote
      if (apply) {
        const branch = await db.tx({ country }, (sql) => createBranch(sql, {
          country_iso2: country, brand_id: brand, restaurant_group_id: groupId,
          name: record.name, city: null, commune: record.commune,
          lat: String(record.lat ?? 0), lng: String(record.lng ?? 0), store_type: record.storeType,
        }, false));
        await db.tx({}, (sql) => remember(sql, "branch", source_id, branch.id));
        branchMap.set(source_id, branch.id);
      } else {
        branchMap.set(source_id, `(new)`);
      }
      summary.branches++;
    }

    // 4) Menu items (with add-ons + variations) → their branch. source_item_id + the map keep this idempotent.
    for (const { source_id, record } of items) {
      if (itemMap.has(source_id)) continue;
      const branchId = branchMap.get(record.branchSourceId);
      if (!branchId) { summary.skipped++; continue; } // orphan item — its branch did not promote
      if (apply) {
        await db.tx({ country }, async (sql) => {
          const branch = await getBranch(sql, branchId);
          if (!branch) { summary.skipped++; return; }
          const input: MenuItemInput = {
            names: { fr: record.name },
            prices: { [record.currency]: record.priceMinor },
            addons: toAddons(record),
            variations: toVariations(record),
            // NB: source_item_id is the catalogue's own menu-sync lineage link (a uuid → another item), not a
            // place for the external StackFood id; idempotency here is handled by migration.promotion_map.
          };
          const item = await addMenuItem(sql, branch, input);
          if (!record.available) { await setAvailability(sql, item.id, false); summary.itemsUnavailable++; }
          await remember(sql, "item", source_id, item.id);
        });
      } else if (!record.available) {
        summary.itemsUnavailable++;
      }
      summary.items++;
    }

    // 5) Optionally publish each promoted branch that has at least one available dish.
    if (apply && doPublish) {
      for (const liveId of new Set(branchMap.values())) {
        if (liveId === "(new)") continue;
        const published = await db.tx({ country }, async (sql) => {
          const [c] = await sql.query<{ n: string }>("SELECT count(*) FILTER (WHERE available)::text AS n FROM catalogue.menu_item WHERE branch_id = $1", [liveId]);
          if (Number(c?.n ?? 0) < 1) return false;
          await publishBranch(sql, liveId);
          return true;
        });
        if (published) summary.published++;
      }
    }

    summary.customers = users.length;
    summary.orders = orders.length;
  }
  return summary;
}

function report(country: string, apply: boolean, doPublish: boolean, s: PromotionSummary): void {
  console.log(`\n${apply ? "PROMOTED to live tables" : "DRY RUN (no writes)"} — country ${country}\n`);
  console.log(`  customers : ${s.customers} staged`);
  console.log(`  addresses : ${s.addresses} ${apply ? "created" : "would create"}`);
  console.log(`  wallet    : ${s.walletTx} movement(s) across ${s.walletCustomers} customer(s) ${apply ? "replayed" : "would replay"}`);
  if (s.walletMismatches.length) {
    console.log(`  WALLET RECONCILIATION FAILED for ${s.walletMismatches.length} customer(s) — NOT imported:`);
    for (const m of s.walletMismatches.slice(0, 50)) console.log(`    customer ${m.customerSourceId}: expected ${m.expectedMinor}, replayed ${m.replayedMinor} — ${m.reason}`);
    if (s.walletMismatches.length > 50) console.log(`    … and ${s.walletMismatches.length - 50} more`);
  }
  console.log(`  merchants : ${s.merchants} ${apply ? "created" : "would create"} (${s.owners} owner account(s) bound)`);
  console.log(`  branches  : ${s.branches} ${apply ? "created" : "would create"}${doPublish ? `, ${s.published} published` : " (unpublished — publish after review, or re-run with --publish)"}`);
  console.log(`  items     : ${s.items} ${apply ? "created" : "would create"} (${s.itemsUnavailable} marked unavailable)`);
  if (s.skipped) console.log(`  skipped   : ${s.skipped} already-promoted or orphan record(s)`);
  console.log(`\n  orders NOT promoted: ${s.orders} historical order(s) remain in migration.order_hdr as read-only history (by design).`);
  if (!apply) console.log(`\n  Re-run with --apply to write. Branches stay unpublished unless you also pass --publish.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const country = (args.find((a) => !a.startsWith("-")) ?? "CD").toUpperCase();
  const apply = args.includes("--apply");
  const doPublish = args.includes("--publish");
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`invalid country "${country}"`);
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("set DATABASE_OWNER_URL");
  const db = connect(url, { max: 1 });
  try {
    report(country, apply, doPublish, await promote(db, country, { apply, doPublish }));
  } finally {
    await db.close();
  }
}

// Run as a CLI only when invoked directly, so tests can import `promote` without this firing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
