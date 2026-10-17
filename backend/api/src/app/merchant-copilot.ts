/**
 * The merchant copilot service (§AI). For one branch the owner manages, it gathers grounded facts — the menu's
 * completeness, what the branch actually sells and when, its performance scorecard and its reviews — and runs
 * the brain to produce ranked, plain-language insights. It reads only; it changes no menu, price or setting.
 * Access is the branch's own: the principal must be able to read the branch's orders.
 */
import type { BranchFacts, DishCount, MerchantBrain, MerchantInsight, PerformanceFacts, ReviewFacts } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { CatalogueService } from "./catalogue.ts";
import type { AdminService } from "./admin.ts";
import { authorize, type Principal, type ResourceContext } from "../modules/identity/policy.ts";
import { forbidden, notFound } from "./errors.ts";

const NOT_PLACED = ["DRAFT", "PENDING_PAYMENT", "PAYMENT_FAILED", "EXPIRED"];
const MIN_FOR_PEAK = 5;

interface BranchRow { id: string; name: string; brand_id: string; restaurant_group_id: string; city: string | null; commune: string | null }
interface MenuItem { id: string; names: Record<string, string>; description?: Record<string, string>; category?: string | null; image_id?: string | null; available: boolean; recommended: boolean }

export class MerchantCopilotService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly brain: MerchantBrain;
  private readonly catalogue: CatalogueService;
  private readonly admin: AdminService;

  constructor(db: Db, registry: CountryConfigRegistry, brain: MerchantBrain, catalogue: CatalogueService, admin: AdminService) {
    this.db = db; this.registry = registry; this.brain = brain; this.catalogue = catalogue; this.admin = admin;
  }

  async insights(country: string, principal: Principal, branchId: string, lang: "fr" | "en" = "fr") {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    const profile = v.profile;
    const tz = profile.country.timezones?.[0] ?? "UTC";

    const branch = await this.db.tx({ country }, (sql) => loadBranch(sql, branchId));
    if (!branch) throw notFound("Branch");
    const resource: ResourceContext = {
      type: "order", country, brandId: branch.brand_id, branchId: branch.id, restaurantGroupId: branch.restaurant_group_id,
      ...(branch.city ? { cityId: branch.city } : {}), ...(branch.commune ? { zoneIds: [branch.commune] } : {}),
    };
    if (!authorize(principal, "order:read", resource, { activeCountry: country, profile }).allowed) throw forbidden("You can't see this branch");

    // Menu completeness, from the live menu.
    const menu = (await this.catalogue.menu(country, branchId)) as { items: MenuItem[] };
    const items = menu.items ?? [];
    const has = (o: Record<string, string> | undefined, k: string) => !!(o && (o[k] ?? "").trim());
    const menuFacts = {
      total: items.length,
      available: items.filter((i) => i.available).length,
      unavailable: items.filter((i) => !i.available).length,
      missingSecondLanguage: items.filter((i) => !(has(i.names, "fr") && has(i.names, "en"))).length,
      missingDescription: items.filter((i) => !has(i.description, "fr") && !has(i.description, "en")).length,
      missingCategory: items.filter((i) => !(i.category ?? "").trim()).length,
      missingPhoto: items.filter((i) => !i.image_id).length,
      recommended: items.filter((i) => i.recommended).length,
    };

    // Demand, from this branch's own orders (realised, in the market's timezone).
    const demand = await this.db.tx({ country }, async (sql) => {
      const [{ n: orders30d } = { n: "0" }] = await sql.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ordering.order_view WHERE branch_id = $1 AND created_at > now() - interval '30 days' AND NOT (state = ANY($2))`,
        [branchId, NOT_PLACED],
      );
      const windows = await sql.query<{ hr: string; dow: string; n: string }>(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE $2)::int::text AS hr, EXTRACT(DOW FROM created_at AT TIME ZONE $2)::int::text AS dow, COUNT(*)::text AS n
           FROM ordering.order_view WHERE branch_id = $1 AND created_at > now() - interval '30 days' AND NOT (state = ANY($3)) GROUP BY 1, 2`,
        [branchId, tz, NOT_PLACED],
      );
      const dishes = await sql.query<{ item_id: string; name: string; qty: string }>(
        `SELECT line->>'itemId' AS item_id, line->>'name' AS name, SUM((line->>'quantity')::int)::text AS qty
           FROM ordering.order_view o JOIN ordering.order_event d ON d.order_id = o.order_id AND d.type = 'ORDER_DRAFTED'
           CROSS JOIN LATERAL jsonb_array_elements(d.payload->'snapshot'->'lines') AS line
          WHERE o.branch_id = $1 AND o.created_at > now() - interval '30 days' AND NOT (o.state = ANY($2))
          GROUP BY 1, 2 ORDER BY SUM((line->>'quantity')::int) DESC`,
        [branchId, NOT_PLACED],
      );
      const orders = Number(orders30d);
      const byHour = new Map<number, number>(), byDow = new Map<number, number>();
      for (const w of windows) { byHour.set(Number(w.hr), (byHour.get(Number(w.hr)) ?? 0) + Number(w.n)); byDow.set(Number(w.dow), (byDow.get(Number(w.dow)) ?? 0) + Number(w.n)); }
      const peak = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const topDishes: DishCount[] = dishes.slice(0, 3).map((d) => ({ name: d.name, quantity: Number(d.qty) }));
      const orderedIds = new Set(dishes.map((d) => d.item_id));
      const slowDishes: DishCount[] = items.filter((i) => i.available && !orderedIds.has(i.id)).slice(0, 3).map((i) => ({ name: i.names["fr"] ?? i.names["en"] ?? "", quantity: 0 }));
      return {
        orders30d: orders,
        ...(orders >= MIN_FOR_PEAK && peak(byHour) !== undefined ? { busiestHour: peak(byHour)! } : {}),
        ...(orders >= MIN_FOR_PEAK && peak(byDow) !== undefined ? { busiestWeekday: peak(byDow)! } : {}),
        topDishes, slowDishes,
      };
    });

    // Performance + reviews from the scorecard (authorised to the same visible set), plus recent low reviews.
    let performance: PerformanceFacts | undefined;
    let reviews: ReviewFacts | undefined;
    try {
      const sc = await this.admin.scorecards(principal, country, 30);
      const row = sc.scorecards.find((s: { branch_id: string }) => s.branch_id === branchId) as undefined | { acceptance_rate: number | null; fulfilment_rate: number | null; avg_prep_minutes: number | null; rating: number | null; reviews: number };
      if (row) {
        performance = {
          ...(row.acceptance_rate != null ? { acceptanceRate: row.acceptance_rate / 100 } : {}),
          ...(row.fulfilment_rate != null ? { fulfilmentRate: row.fulfilment_rate / 100 } : {}),
          ...(row.avg_prep_minutes != null ? { avgPrepMinutes: row.avg_prep_minutes } : {}),
        };
        const recentLow = await this.db.tx({ country }, async (sql) => Number((await sql.query<{ n: string }>(
          "SELECT COUNT(*)::text AS n FROM reviews.order_review WHERE branch_id = $1 AND restaurant_rating <= 2 AND created_at > now() - interval '30 days'", [branchId],
        ))[0]?.n ?? 0));
        reviews = { count: row.reviews ?? 0, ...(row.rating != null ? { average: row.rating } : {}), recentLow };
      }
    } catch { /* no performance visibility — menu + demand insights still return */ }

    const facts: BranchFacts = { branchName: branch.name, menu: menuFacts, demand, ...(performance ? { performance } : {}), ...(reviews ? { reviews } : {}) };
    const insights: readonly MerchantInsight[] = this.brain.insights(facts, lang);
    return { branch: { id: branch.id, name: branch.name }, facts, insights };
  }
}

async function loadBranch(sql: Sql, branchId: string): Promise<BranchRow | null> {
  return (await sql.query<BranchRow & Record<string, unknown>>("SELECT id, name, brand_id, restaurant_group_id, city, commune FROM catalogue.branch WHERE id = $1", [branchId]))[0] ?? null;
}
