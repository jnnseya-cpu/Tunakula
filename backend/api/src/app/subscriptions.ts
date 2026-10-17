/**
 * Repeat / subscription orders. A customer turns a cart into a recurring order ("my usual, every Monday at noon").
 * A sweep on the operations loop places each due occurrence as a normal order funded from the customer's wallet; if
 * the balance is short the run is skipped (no surprise charge) and the next occurrence is still scheduled. Additive —
 * it reuses the cart quote/place path and the wallet. The Deliveroo/Just Eat "subscribe & save" / reorder feature.
 */
import { Money } from "@tunakula/ts-money";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { type Principal } from "../modules/identity/policy.ts";
import { loadPrincipal } from "./principal.ts";
import { ApiError, badRequest, forbidden, notFound } from "./errors.ts";
import type { CommerceService, QuoteInput } from "./commerce.ts";

type Cadence = "DAILY" | "WEEKLY";
interface SubRow { id: string; customer_id: string; branch_id: string; items: QuoteInput["items"]; delivery: { lat: number; lng: number }; cadence: Cadence; weekday: number | null; at_time: string; next_run: Date; status: string; last_run_at: Date | null }
interface ApiItem { item_id?: string; quantity?: number; options?: { group: string; choices: string[] }[]; addons?: string[] }
interface CreateInput { branch_id?: string; items?: ApiItem[]; delivery?: { lat: number; lng: number }; cadence?: string; weekday?: number; time?: string }

/** Maps the snake-case cart items the client sends into the camel-case shape the quote/place path expects. */
function normalizeItems(items: ApiItem[]): QuoteInput["items"] {
  return items.map((i) => {
    if (!i?.item_id) throw badRequest("ITEM_INVALID", "Each item needs an item_id");
    const q = Math.round(Number(i.quantity ?? 1));
    return { itemId: String(i.item_id), quantity: q, ...(Array.isArray(i.options) ? { options: i.options } : {}), ...(Array.isArray(i.addons) ? { addons: i.addons } : {}) };
  });
}
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class SubscriptionService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly commerce: CommerceService;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, commerce: CommerceService, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.commerce = commerce;
    this.now = now;
  }

  #tz(country: string): string {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile.country.timezones[0] ?? "UTC";
  }

  /** POST /v1/me/subscriptions — turn a cart into a recurring order. */
  async create(country: string, principal: Principal, input: CreateInput) {
    const tz = this.#tz(country);
    if (!input.branch_id) throw badRequest("BRANCH_REQUIRED", "A subscription needs a branch");
    if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest("ITEMS_REQUIRED", "A subscription needs at least one item");
    const items = normalizeItems(input.items);
    if (!input.delivery || !Number.isFinite(input.delivery.lat) || !Number.isFinite(input.delivery.lng)) throw badRequest("DELIVERY_REQUIRED", "A subscription needs a delivery location");
    const cadence = String(input.cadence ?? "WEEKLY").toUpperCase();
    if (cadence !== "DAILY" && cadence !== "WEEKLY") throw badRequest("CADENCE_INVALID", "cadence is DAILY or WEEKLY");
    const time = String(input.time ?? "");
    if (!HHMM.test(time)) throw badRequest("TIME_INVALID", "Give a time as HH:MM");
    let weekday: number | null = null;
    if (cadence === "WEEKLY") {
      weekday = Math.round(Number(input.weekday));
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest("WEEKDAY_INVALID", "Give a weekday 0 (Sunday) to 6 (Saturday)");
    }
    // Validate the cart is orderable right now (prices, availability) before committing to a subscription.
    await this.commerce.quote(country, { branchId: input.branch_id, items, orderType: "DELIVERY", delivery: input.delivery, customerId: principal.userId });
    const nextRun = nextOccurrence(this.now(), tz, cadence as Cadence, weekday, time);
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<SubRow & Record<string, unknown>>(
        `INSERT INTO ordering.order_subscription (country_iso2, customer_id, branch_id, items, delivery, cadence, weekday, at_time, next_run)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,
        [country, principal.userId, input.branch_id, JSON.stringify(items), JSON.stringify(input.delivery), cadence, weekday, time, nextRun],
      );
      return this.#view(row!, tz);
    });
  }

  /** GET /v1/me/subscriptions — the customer's subscriptions, newest first. */
  async list(country: string, principal: Principal) {
    const tz = this.#tz(country);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<SubRow & Record<string, unknown>>(
        `SELECT ${COLS} FROM ordering.order_subscription WHERE customer_id = $1 AND status <> 'CANCELLED' ORDER BY created_at DESC`,
        [principal.userId],
      );
      return { subscriptions: rows.map((r) => this.#view(r, tz)) };
    });
  }

  /** POST /v1/me/subscriptions/:id — pause, resume or cancel a subscription. */
  async setStatus(country: string, principal: Principal, id: string, action: string) {
    const tz = this.#tz(country);
    const map: Record<string, string> = { PAUSE: "PAUSED", RESUME: "ACTIVE", CANCEL: "CANCELLED" };
    const status = map[String(action).toUpperCase()];
    if (!status) throw badRequest("ACTION_INVALID", "action is PAUSE, RESUME or CANCEL");
    return this.db.tx({ country }, async (sql) => {
      const [owned] = await sql.query<{ id: string }>("SELECT id FROM ordering.order_subscription WHERE id = $1 AND customer_id = $2", [id, principal.userId]);
      if (!owned) throw status === "CANCELLED" ? notFound("Subscription") : forbidden("That subscription is not yours");
      // Resuming recomputes the next run from now, so a paused window is not back-filled.
      const resume = status === "ACTIVE";
      const [row] = await sql.query<SubRow & Record<string, unknown>>(
        resume
          ? `UPDATE ordering.order_subscription SET status = 'ACTIVE', next_run = $3, updated_at = now() WHERE id = $1 AND customer_id = $2 RETURNING ${COLS}`
          : `UPDATE ordering.order_subscription SET status = $3, updated_at = now() WHERE id = $1 AND customer_id = $2 RETURNING ${COLS}`,
        resume ? [id, principal.userId, await this.#recomputeNext(sql, id, tz)] : [id, principal.userId, status],
      );
      if (!row) throw notFound("Subscription");
      return this.#view(row, tz);
    });
  }

  async #recomputeNext(sql: Sql, id: string, tz: string): Promise<Date> {
    const [r] = await sql.query<{ cadence: Cadence; weekday: number | null; at_time: string }>("SELECT cadence, weekday, at_time FROM ordering.order_subscription WHERE id = $1", [id]);
    return nextOccurrence(this.now(), tz, r!.cadence, r!.weekday, r!.at_time);
  }

  /**
   * Places the orders due now, one per subscription occurrence, funded from the wallet. Idempotent per occurrence.
   * A short wallet balance skips that occurrence (recorded, no charge); the next one is still scheduled.
   */
  async runSweep(country: string): Promise<{ placed: number; skipped: number }> {
    const tz = this.#tz(country);
    const now = this.now();
    const due = await this.db.tx({ country }, (sql) => sql.query<SubRow & Record<string, unknown>>(
      `SELECT ${COLS} FROM ordering.order_subscription WHERE status = 'ACTIVE' AND next_run <= $1 ORDER BY next_run LIMIT 100`,
      [now],
    ));
    let placed = 0, skipped = 0;
    for (const sub of due) {
      const occurrence = new Date(sub.next_run);
      // Idempotent per occurrence: if this occurrence was already logged, don't run it again. The order itself
      // is also guarded by the placement idempotency key below, so a concurrent sweep can never double-charge.
      const seen = await this.db.tx({ country }, (sql) => sql.query<{ one: number }>(
        "SELECT 1 AS one FROM ordering.subscription_run WHERE subscription_id = $1 AND scheduled_for = $2", [sub.id, occurrence],
      ));
      if (seen.length > 0) { await this.#advance(country, sub, tz); continue; }
      let status: "PLACED" | "SKIPPED" = "SKIPPED";
      let orderId: string | null = null;
      let reason: string | null = null;
      try {
        const principal = await this.db.tx({ country }, (sql) => loadPrincipal(sql, sub.customer_id));
        const quote = await this.commerce.quote(country, { branchId: sub.branch_id, items: sub.items, orderType: "DELIVERY", delivery: sub.delivery, customerId: sub.customer_id });
        const total = quote.payable ? Money.fromJSON(quote.payable) : quote.breakdown.total;
        const placedOrder = await this.commerce.place(country, principal, {
          branchId: sub.branch_id, items: sub.items, orderType: "DELIVERY", delivery: sub.delivery,
          paymentMode: "WALLET", expectedTotal: { amount_minor: total.minor.toString(), currency: total.currency },
        }, `sub:${sub.id}:${occurrence.toISOString()}`);
        status = "PLACED"; orderId = placedOrder.orderId; placed++;
      } catch (e) {
        reason = e instanceof ApiError ? e.code : "ERROR"; skipped++;
      }
      // Append the run outcome once (append-only log). The unique occurrence index makes a concurrent writer a no-op.
      await this.db.tx({ country }, (sql) => sql.query(
        "INSERT INTO ordering.subscription_run (country_iso2, subscription_id, scheduled_for, status, order_id, reason) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (subscription_id, scheduled_for) DO NOTHING",
        [country, sub.id, occurrence, status, orderId, reason],
      ));
      await this.#advance(country, sub, tz);
    }
    return { placed, skipped };
  }

  async #advance(country: string, sub: SubRow, tz: string) {
    const after = new Date(new Date(sub.next_run).getTime() + 60_000); // just past this occurrence
    const next = nextOccurrence(after, tz, sub.cadence, sub.weekday, sub.at_time);
    await this.db.tx({ country }, (sql) => sql.query("UPDATE ordering.order_subscription SET next_run = $2, last_run_at = $3, updated_at = now() WHERE id = $1", [sub.id, next, this.now()]));
  }

  #view(r: SubRow, tz: string) {
    const label = r.cadence === "DAILY" ? `Every day at ${r.at_time}` : `Every ${DAY_NAMES[r.weekday ?? 0]} at ${r.at_time}`;
    return {
      id: r.id, branch_id: r.branch_id, items: r.items, cadence: r.cadence, weekday: r.weekday, time: r.at_time,
      status: r.status, label,
      next_run: new Date(r.next_run).toISOString(),
      next_run_local: localStamp(new Date(r.next_run), tz),
      last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    };
  }
}

const COLS = "id, customer_id::text AS customer_id, branch_id, items, delivery, cadence, weekday, at_time, next_run, status, last_run_at";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The UTC instant of the next DAILY/WEEKLY occurrence of a local HH:MM (and weekday) strictly after `from`. */
export function nextOccurrence(from: Date, tz: string, cadence: Cadence, weekday: number | null, hhmm: string): Date {
  for (let i = 0; i <= 8; i++) {
    const probe = new Date(from.getTime() + i * 86_400_000);
    const { date, weekday: wd } = localParts(probe, tz);
    if (cadence === "WEEKLY" && wd !== weekday) continue;
    const candidate = zonedTime(date, hhmm, tz);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Fallback (should not happen): a week out.
  return new Date(from.getTime() + 7 * 86_400_000);
}

/** Local date (YYYY-MM-DD) and weekday (0=Sunday) for an instant in a time zone. */
function localParts(at: Date, tz: string): { date: string; weekday: number } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: days[p.weekday as string] ?? 0 };
}

/** The UTC instant whose wall-clock time in `tz` is `YYYY-MM-DD` at `HH:MM`. */
function zonedTime(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const asUtc = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const tzWallAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const offset = tzWallAsUtc - asUtc;
  return new Date(asUtc - offset);
}

function localStamp(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}
