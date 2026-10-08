/**
 * Table bookings (dine-in reservations). A customer books a table at a restaurant for a party of
 * one or more people at a chosen time; the restaurant's front of house confirms, seats, completes,
 * declines, or marks a no-show. The customer can cancel their own booking before it is seated.
 * Additive — nothing else depends on it.
 */
import type { CountryProfile } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { Principal, ResourceContext } from "../modules/identity/policy.ts";
import { getBranch } from "../persistence/catalogue.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { require } from "./principal.ts";

export type BookingStatus = "REQUESTED" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** Who may move a booking to each status, and from which statuses. */
const MERCHANT_MOVES: Readonly<Record<string, readonly BookingStatus[]>> = {
  CONFIRMED: ["REQUESTED"],
  SEATED: ["CONFIRMED"],
  COMPLETED: ["SEATED"],
  NO_SHOW: ["CONFIRMED"],
  CANCELLED: ["REQUESTED", "CONFIRMED"],
};
/** The customer may cancel their own booking while it is still ahead of them. */
const CUSTOMER_CANCELLABLE: readonly BookingStatus[] = ["REQUESTED", "CONFIRMED"];
const MAX_PARTY = 50;

interface BookingRow {
  id: string; branch_id: string; customer_id: string; party_size: number; seating_at: Date;
  duration_min: number; status: BookingStatus; contact_name: string | null; contact_phone: string | null;
  note: string | null; created_at: Date; customer_name?: string | null; branch_name?: string | null;
}

export class ReservationService {
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

  /** Customer: book a table at a branch. */
  async book(country: string, principal: Principal, input: { branchId: string; partySize: number; at: string; durationMin?: number; name?: string; phone?: string; note?: string }) {
    const profile = this.profile(country);
    const party = Math.trunc(Number(input.partySize));
    if (!Number.isInteger(party) || party < 1 || party > MAX_PARTY) throw badRequest("PARTY_SIZE_INVALID", `A party is 1 to ${MAX_PARTY} people`);
    const at = new Date(input.at);
    if (Number.isNaN(at.getTime())) throw badRequest("TIME_INVALID", "Send a valid seating time");
    if (at.getTime() < this.now().getTime() - 60_000) throw unprocessable("TIME_IN_PAST", "Pick a seating time in the future");
    const duration = input.durationMin === undefined ? 90 : Math.trunc(Number(input.durationMin));
    if (!Number.isInteger(duration) || duration < 15 || duration > 480) throw badRequest("DURATION_INVALID", "A booking lasts 15 to 480 minutes");
    return this.db.tx({ country }, async (sql) => {
      const resource = await this.branchResource(sql, country, input.branchId);
      require(principal, "reservation:book", resource, { activeCountry: country, profile });
      const [row] = await sql.query<{ id: string }>(
        `INSERT INTO reservations.booking (country_iso2, branch_id, customer_id, party_size, seating_at, duration_min, contact_name, contact_phone, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [country, input.branchId, principal.userId, party, at.toISOString(), duration, input.name?.slice(0, 120) ?? null, input.phone?.slice(0, 40) ?? null, input.note?.slice(0, 500) ?? null],
      );
      await audit(sql, { actor: principal.userId, action: "reservation.booked", target: `booking:${row?.id}`, country, detail: { branch: input.branchId, party } });
      return { id: row?.id, status: "REQUESTED" as BookingStatus, party_size: party, seating_at: at.toISOString(), duration_min: duration };
    });
  }

  /** Customer: their own bookings in this market, newest seating first. */
  async mine(country: string, principal: Principal, limit = 30) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<BookingRow & Record<string, unknown>>(
        `SELECT b.id, b.branch_id, b.customer_id, b.party_size, b.seating_at, b.duration_min, b.status, b.contact_name, b.contact_phone, b.note, b.created_at,
                c.name AS branch_name
           FROM reservations.booking b JOIN catalogue.branch c ON c.id = b.branch_id
          WHERE b.customer_id = $1 ORDER BY b.seating_at DESC LIMIT $2`,
        [principal.userId, Math.min(Math.max(limit, 1), 100)],
      );
      return { bookings: rows.map((r) => ({ ...view(r), branch: { id: r.branch_id, name: r.branch_name ?? null } })) };
    });
  }

  /** Customer: cancel their own booking (before it is seated). */
  async cancelMine(country: string, principal: Principal, bookingId: string) {
    return this.db.tx({ country }, async (sql) => {
      const [b] = await sql.query<{ customer_id: string; status: BookingStatus }>("SELECT customer_id, status FROM reservations.booking WHERE id = $1", [bookingId]);
      if (!b) throw notFound("Booking");
      if (b.customer_id !== principal.userId) throw forbidden("You can only cancel your own booking");
      if (!CUSTOMER_CANCELLABLE.includes(b.status)) throw conflict("NOT_CANCELLABLE", `A ${b.status.toLowerCase()} booking cannot be cancelled`);
      await sql.query("UPDATE reservations.booking SET status = 'CANCELLED', decided_by = $2, decided_at = $3, updated_at = $3 WHERE id = $1", [bookingId, principal.userId, this.now()]);
      await audit(sql, { actor: principal.userId, action: "reservation.cancelled", target: `booking:${bookingId}`, country });
      return { id: bookingId, status: "CANCELLED" as BookingStatus };
    });
  }

  /** Merchant: bookings for a branch they manage. Defaults to upcoming + recent. */
  async forBranch(country: string, principal: Principal, branchId: string, limit = 100) {
    const profile = this.profile(country);
    return this.db.tx({ country }, async (sql) => {
      require(principal, "reservation:manage", await this.branchResource(sql, country, branchId), { activeCountry: country, profile });
      const rows = await sql.query<BookingRow & Record<string, unknown>>(
        `SELECT b.id, b.branch_id, b.customer_id, b.party_size, b.seating_at, b.duration_min, b.status, b.contact_name, b.contact_phone, b.note, b.created_at,
                u.display_name AS customer_name
           FROM reservations.booking b LEFT JOIN identity.app_user u ON u.id = b.customer_id
          WHERE b.branch_id = $1 ORDER BY b.seating_at ASC LIMIT $2`,
        [branchId, Math.min(Math.max(limit, 1), 200)],
      );
      return { bookings: rows.map((r) => ({ ...view(r), customer: firstName(r.customer_name), contact_name: r.contact_name, contact_phone: r.contact_phone, note: r.note })) };
    });
  }

  /** Merchant: move a booking to a new status (confirm, seat, complete, no-show, decline). */
  async setStatus(country: string, principal: Principal, bookingId: string, status: BookingStatus) {
    const profile = this.profile(country);
    const allowedFrom = MERCHANT_MOVES[status];
    if (!allowedFrom) throw badRequest("STATUS_INVALID", "A booking is confirmed, seated, completed, cancelled or no-show");
    return this.db.tx({ country }, async (sql) => {
      const [b] = await sql.query<{ branch_id: string; status: BookingStatus }>("SELECT branch_id, status FROM reservations.booking WHERE id = $1", [bookingId]);
      if (!b) throw notFound("Booking");
      require(principal, "reservation:manage", await this.branchResource(sql, country, b.branch_id), { activeCountry: country, profile });
      if (!allowedFrom.includes(b.status)) throw conflict("STATUS_CONFLICT", `A ${b.status.toLowerCase()} booking cannot become ${status.toLowerCase()}`);
      await sql.query("UPDATE reservations.booking SET status = $2, decided_by = $3, decided_at = $4, updated_at = $4 WHERE id = $1", [bookingId, status, principal.userId, this.now()]);
      await audit(sql, { actor: principal.userId, action: "reservation.status", target: `booking:${bookingId}`, country, detail: { status } });
      return { id: bookingId, status };
    });
  }
}

function view(r: BookingRow) {
  return {
    id: r.id, status: r.status, party_size: r.party_size,
    seating_at: new Date(r.seating_at).toISOString(), duration_min: r.duration_min,
    created_at: new Date(r.created_at).toISOString(),
  };
}
const firstName = (n: string | null | undefined) => (n ? n.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] ?? "Customer" : "Customer");
