/** Saved delivery addresses — a customer keeps several named map pins and picks one at checkout. */
import type { Db } from "../db/db.ts";
import type { Principal } from "../modules/identity/policy.ts";
import { badRequest, notFound } from "./errors.ts";

interface AddressRow {
  id: string; label: string; lat: number; lng: number; landmark: string | null; contact_phone: string | null; is_default: boolean;
}

export class AddressService {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  async list(country: string, principal: Principal) {
    const rows = await this.db.tx({ country }, (sql) => sql.query<AddressRow & Record<string, unknown>>(
      "SELECT id, label, lat, lng, landmark, contact_phone, is_default FROM identity.saved_address WHERE user_id = $1 AND country_iso2 = $2 ORDER BY is_default DESC, label",
      [principal.userId, country],
    ));
    return { data: rows.map(view) };
  }

  async create(country: string, principal: Principal, input: { label?: string | undefined; lat?: number | undefined; lng?: number | undefined; landmark?: string | undefined; contactPhone?: string | undefined; isDefault?: boolean | undefined }) {
    const label = String(input.label ?? "").trim();
    if (!label || label.length > 60) throw badRequest("LABEL_REQUIRED", "An address needs a short label (e.g. Home, Work)");
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw badRequest("PIN_REQUIRED", "Drop a valid map pin");
    return this.db.tx({ country }, async (sql) => {
      const first = (await sql.query<{ n: string }>("SELECT count(*)::text AS n FROM identity.saved_address WHERE user_id = $1 AND country_iso2 = $2", [principal.userId, country]))[0];
      const makeDefault = input.isDefault === true || Number(first?.n ?? 0) === 0;
      if (makeDefault) await sql.query("UPDATE identity.saved_address SET is_default = false WHERE user_id = $1 AND country_iso2 = $2 AND is_default", [principal.userId, country]);
      const [row] = await sql.query<AddressRow & Record<string, unknown>>(
        `INSERT INTO identity.saved_address (country_iso2, user_id, label, lat, lng, landmark, contact_phone, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, label, lat, lng, landmark, contact_phone, is_default`,
        [country, principal.userId, label, lat, lng, input.landmark?.slice(0, 280) ?? null, input.contactPhone?.slice(0, 32) ?? null, makeDefault],
      );
      return view(row as AddressRow);
    });
  }

  async setDefault(country: string, principal: Principal, id: string) {
    return this.db.tx({ country }, async (sql) => {
      const [own] = await sql.query<{ id: string }>("SELECT id FROM identity.saved_address WHERE id = $1 AND user_id = $2 AND country_iso2 = $3", [id, principal.userId, country]);
      if (!own) throw notFound("Address");
      await sql.query("UPDATE identity.saved_address SET is_default = false WHERE user_id = $1 AND country_iso2 = $2 AND is_default", [principal.userId, country]);
      await sql.query("UPDATE identity.saved_address SET is_default = true, updated_at = now() WHERE id = $1", [id]);
      return { id, is_default: true };
    });
  }

  async remove(country: string, principal: Principal, id: string) {
    const rows = await this.db.tx({ country }, (sql) => sql.query("DELETE FROM identity.saved_address WHERE id = $1 AND user_id = $2 AND country_iso2 = $3 RETURNING id", [id, principal.userId, country]));
    if (rows.length === 0) throw notFound("Address");
    return { id, deleted: true };
  }

  /** The customer's favourite restaurants, with name, commune and rating. */
  async favourites(country: string, principal: Principal) {
    const rows = await this.db.tx({ country }, (sql) => sql.query<{ branch_id: string; name: string; commune: string | null; avg: string | null }>(
      `SELECT f.branch_id, b.name, b.commune,
              (SELECT avg(restaurant_rating)::numeric(3,2)::text FROM reviews.order_review r WHERE r.branch_id = b.id) AS avg
         FROM identity.favourite f JOIN catalogue.branch b ON b.id = f.branch_id
        WHERE f.user_id = $1 AND f.country_iso2 = $2 ORDER BY f.created_at DESC`,
      [principal.userId, country],
    ));
    return { data: rows.map((r) => ({ branch_id: r.branch_id, name: r.name, commune: r.commune, rating: r.avg ? Number(r.avg) : null })) };
  }

  /** Toggle a restaurant as a favourite; returns whether it is now favourited. */
  async toggleFavourite(country: string, principal: Principal, branchId: string) {
    if (!/^[0-9a-f-]{36}$/.test(branchId)) throw badRequest("BRANCH_INVALID", "A valid restaurant id is required");
    return this.db.tx({ country }, async (sql) => {
      const removed = await sql.query("DELETE FROM identity.favourite WHERE user_id = $1 AND branch_id = $2 RETURNING branch_id", [principal.userId, branchId]);
      if (removed.length) return { branch_id: branchId, favourite: false };
      const b = await sql.query("SELECT id FROM catalogue.branch WHERE id = $1", [branchId]);
      if (b.length === 0) throw notFound("Restaurant");
      await sql.query("INSERT INTO identity.favourite (country_iso2, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [country, principal.userId, branchId]);
      return { branch_id: branchId, favourite: true };
    });
  }
}

function view(a: AddressRow) {
  return { id: a.id, label: a.label, lat: a.lat, lng: a.lng, landmark: a.landmark, contact_phone: a.contact_phone, is_default: a.is_default };
}
