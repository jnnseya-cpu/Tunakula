/**
 * Reviews and ratings. After a delivered order the customer rates the restaurant (1–5), optionally
 * the rider, and leaves a comment; the restaurant can reply. Ratings aggregate into each branch's
 * average, shown on the storefront and in the performance scorecard. Additive.
 */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal, ResourceContext } from "../modules/identity/policy.ts";
import { getBranch } from "../persistence/catalogue.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

interface ReviewRow {
  id: string; order_id: string; branch_id: string; customer_id: string; rider_id: string | null;
  restaurant_rating: number; rider_rating: number | null; comment: string | null;
  reply: string | null; replied_at: Date | null; created_at: Date; reviewer: string | null;
}

export class ReviewService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  private profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  private async branchResource(sql: Sql, country: string, branchId: string): Promise<ResourceContext> {
    const b = await getBranch(sql, branchId);
    if (!b) throw notFound("Branch");
    return {
      type: "order", country, brandId: b.brand_id, branchId: b.id, restaurantGroupId: b.restaurant_group_id,
      ...(b.city ? { cityId: b.city } : {}), ...(b.commune ? { zoneIds: [b.commune] } : {}),
    };
  }

  /** Customer: rate a delivered order (once). */
  async submit(country: string, principal: Principal, orderId: string, input: { restaurantRating: number; riderRating?: number; comment?: string }) {
    const rating = Math.trunc(Number(input.restaurantRating));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest("RATING_INVALID", "A rating is 1 to 5 stars");
    const riderRating = input.riderRating === undefined ? null : Math.trunc(Number(input.riderRating));
    if (riderRating !== null && (riderRating < 1 || riderRating > 5)) throw badRequest("RIDER_RATING_INVALID", "A rider rating is 1 to 5 stars");
    return this.db.tx({ country }, async (sql) => {
      const [o] = await sql.query<{ branch_id: string; customer_id: string; rider_id: string | null; state: string }>(
        "SELECT branch_id, customer_id, rider_id, state FROM ordering.order_view WHERE order_id = $1", [orderId],
      );
      if (!o) throw notFound("Order");
      if (o.customer_id !== principal.userId) throw forbidden("You can only review your own order");
      if (o.state !== "DELIVERED") throw unprocessable("ORDER_NOT_DELIVERED", "You can review an order once it has been delivered");
      const [existing] = await sql.query<{ id: string }>("SELECT id FROM reviews.order_review WHERE order_id = $1", [orderId]);
      if (existing) throw conflict("ALREADY_REVIEWED", "You have already reviewed this order");
      const [row] = await sql.query<{ id: string }>(
        `INSERT INTO reviews.order_review (country_iso2, order_id, branch_id, customer_id, rider_id, restaurant_rating, rider_rating, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [country, orderId, o.branch_id, principal.userId, o.rider_id, rating, riderRating, input.comment?.slice(0, 1000) ?? null],
      );
      await audit(sql, { actor: principal.userId, action: "review.submitted", target: `order:${orderId}`, country, detail: { restaurant_rating: rating } });
      return { id: row?.id, restaurant_rating: rating, rider_rating: riderRating, comment: input.comment ?? null };
    });
  }

  /** Customer: their own review for an order, or null, plus whether the order can be reviewed. */
  async forOrder(country: string, principal: Principal, orderId: string) {
    return this.db.tx({ country }, async (sql) => {
      const [o] = await sql.query<{ customer_id: string; state: string }>("SELECT customer_id, state FROM ordering.order_view WHERE order_id = $1", [orderId]);
      if (!o || o.customer_id !== principal.userId) throw notFound("Order");
      const [r] = await sql.query<ReviewRow & Record<string, unknown>>(
        "SELECT id, order_id, branch_id, customer_id, rider_id, restaurant_rating, rider_rating, comment, reply, replied_at, created_at FROM reviews.order_review WHERE order_id = $1", [orderId],
      );
      return { reviewable: o.state === "DELIVERED" && !r, review: r ? view(r) : null };
    });
  }

  /** Public: a branch's average rating and recent reviews. */
  async forBranch(country: string, branchId: string, limit = 20) {
    return this.db.tx({ country }, async (sql) => {
      const [sum] = await sql.query<{ avg: string | null; n: string }>(
        "SELECT avg(restaurant_rating)::numeric(3,2)::text AS avg, count(*)::text AS n FROM reviews.order_review WHERE branch_id = $1", [branchId],
      );
      const rows = await sql.query<ReviewRow & Record<string, unknown>>(
        `SELECT r.id, r.order_id, r.branch_id, r.customer_id, r.rider_id, r.restaurant_rating, r.rider_rating, r.comment, r.reply, r.replied_at, r.created_at,
                u.display_name AS reviewer
           FROM reviews.order_review r LEFT JOIN identity.app_user u ON u.id = r.customer_id
          WHERE r.branch_id = $1 AND (r.comment IS NOT NULL OR r.reply IS NOT NULL)
          ORDER BY r.created_at DESC LIMIT $2`,
        [branchId, Math.min(Math.max(limit, 1), 50)],
      );
      return {
        average: sum?.avg ? Number(sum.avg) : null,
        count: Number(sum?.n ?? 0),
        reviews: rows.map((r) => ({ ...view(r), reviewer: firstName(r.reviewer), reply: r.reply, replied_at: r.replied_at ? new Date(r.replied_at).toISOString() : null })),
      };
    });
  }

  /** Merchant: list reviews for a branch they manage (with the customer's first name). */
  async listForMerchant(country: string, principal: Principal, branchId: string, limit = 50) {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      require(principal, "order:read", await this.branchResource(sql, country, branchId), { activeCountry: country, profile });
      const rows = await sql.query<ReviewRow & Record<string, unknown>>(
        `SELECT r.id, r.order_id, r.branch_id, r.customer_id, r.rider_id, r.restaurant_rating, r.rider_rating, r.comment, r.reply, r.replied_at, r.created_at,
                u.display_name AS reviewer
           FROM reviews.order_review r LEFT JOIN identity.app_user u ON u.id = r.customer_id
          WHERE r.branch_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
        [branchId, Math.min(Math.max(limit, 1), 100)],
      );
      return { reviews: rows.map((r) => ({ ...view(r), reviewer: firstName(r.reviewer), reply: r.reply, replied_at: r.replied_at ? new Date(r.replied_at).toISOString() : null })) };
    });
  }

  /** Merchant: reply to a review on a branch they manage. */
  async reply(country: string, principal: Principal, reviewId: string, text: string) {
    const profile = this.profile(country);
    const reply = String(text ?? "").trim();
    if (!reply || reply.length > 1000) throw badRequest("REPLY_INVALID", "A reply is 1–1000 characters");
    return this.db.tx({ country }, async (sql) => {
      const [r] = await sql.query<{ branch_id: string }>("SELECT branch_id FROM reviews.order_review WHERE id = $1", [reviewId]);
      if (!r) throw notFound("Review");
      require(principal, "order:read", await this.branchResource(sql, country, r.branch_id), { activeCountry: country, profile });
      await sql.query("UPDATE reviews.order_review SET reply = $2, replied_by = $3, replied_at = $4, updated_at = $4 WHERE id = $1", [reviewId, reply, principal.userId, this.now()]);
      await audit(sql, { actor: principal.userId, action: "review.replied", target: `review:${reviewId}`, country });
      return { id: reviewId, reply };
    });
  }

  /** Branch rating summaries for a set of branches (for storefront cards). */
  async summaries(sql: Sql, branchIds: readonly string[]): Promise<Map<string, { average: number | null; count: number }>> {
    if (branchIds.length === 0) return new Map();
    const rows = await sql.query<{ branch_id: string; avg: string | null; n: string }>(
      "SELECT branch_id, avg(restaurant_rating)::numeric(3,2)::text AS avg, count(*)::text AS n FROM reviews.order_review WHERE branch_id = ANY($1::uuid[]) GROUP BY branch_id",
      [branchIds],
    );
    return new Map(rows.map((r) => [r.branch_id, { average: r.avg ? Number(r.avg) : null, count: Number(r.n) }]));
  }
}

function view(r: ReviewRow) {
  return {
    id: r.id, order_id: r.order_id, restaurant_rating: r.restaurant_rating, rider_rating: r.rider_rating,
    comment: r.comment, created_at: new Date(r.created_at).toISOString(),
  };
}
const firstName = (n: string | null) => (n ? n.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] ?? "Customer" : "Customer");
