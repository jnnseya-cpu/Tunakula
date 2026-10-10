/**
 * Book-a-chef — a private-chef marketplace on the same principle as every other order: the chef keeps 100% of
 * their fee, and the platform is funded by the customer service charge added on top (0% commission).
 *
 * A cook applies, ops approve them, and they list services — ADVICE (a consultation, often remote) and in-person
 * engagements (private dining, meal prep, events, classes). Each service sets how the chef charges: a flat fee,
 * per guest, or per hour. A customer requests a booking for a date; the chef confirms or declines; on completion
 * the money settles to a balanced journal (chef_payable + service_charge_revenue from the payment clearing
 * account). Additive — its own schema, nothing else depends on it.
 */
import type { CountryProfile } from "@tunakula/ts-contracts";
import { Money } from "@tunakula/ts-money";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { createJournal, type LedgerEntry } from "../modules/money/journal.ts";
import { postJournal } from "../persistence/ledger.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";

const KINDS = ["ADVICE", "PRIVATE_DINING", "MEAL_PREP", "EVENT", "CLASS"] as const;
const MODELS = ["FIXED", "PER_HEAD", "HOURLY"] as const;
type Kind = (typeof KINDS)[number];
type Model = (typeof MODELS)[number];
type Status = "REQUESTED" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

interface ProfileRow { id: string; user_id: string; display_name: string; bio: string; cuisines: string[]; communes: string[]; photo_ref: string; status: string }
interface ServiceRow { id: string; chef_id: string; kind: string; title: string; description: string; pricing_model: string; rate_minor: string; currency: string; min_guests: number; max_guests: number | null; remote: boolean; active: boolean; sort: number }
interface BookingRow {
  id: string; chef_id: string; service_id: string; customer_id: string; status: string; scheduled_for: Date; party_size: number; hours: number;
  location_label: string; lat: string | null; lng: string | null; note: string; fee_minor: string; service_charge_minor: string; total_minor: string; currency: string; decline_reason: string; created_at: Date;
}

export class ChefService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly now: () => Date;

  constructor(db: Db, registry: CountryConfigRegistry, now: () => Date = () => new Date()) {
    this.db = db;
    this.registry = registry;
    this.now = now;
  }

  #profile(country: string): CountryProfile {
    const v = this.registry.published(country);
    if (!v) throw notFound(`Market ${country}`);
    return v.profile;
  }

  /** Ops who onboard providers (a country admin or a reviewer) may approve and suspend chefs. */
  #opsAllowed(principal: Principal, country: string): boolean {
    const profile = this.#profile(country);
    const actions: Action[] = ["country_config:write", "rider:manage", "kyc:review"];
    return actions.some((a) => authorize(principal, a, { type: "order", country }, { activeCountry: country, profile }).allowed);
  }

  // ── Chef onboarding & profile ──

  /** A signed-in person applies to cook. One profile per person per market; it starts PENDING review. */
  async apply(country: string, principal: Principal, input: { displayName?: string | undefined; bio?: string | undefined; cuisines?: string[] | undefined; communes?: string[] | undefined; photoRef?: string | undefined }) {
    this.#profile(country);
    const name = String(input.displayName ?? "").trim().slice(0, 80);
    if (!name) throw badRequest("NAME_REQUIRED", "Tell customers your chef name");
    return this.db.tx({ country }, async (sql) => {
      const [existing] = await sql.query<ProfileRow & Record<string, unknown>>("SELECT id, status FROM chef.profile WHERE user_id = $1", [principal.userId]);
      if (existing) throw conflict("ALREADY_A_CHEF", `You already have a chef profile (${String(existing.status).toLowerCase()})`);
      const [row] = await sql.query<ProfileRow & Record<string, unknown>>(
        `INSERT INTO chef.profile (country_iso2, user_id, display_name, bio, cuisines, communes, photo_ref, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING') RETURNING ${PCOLS}`,
        [country, principal.userId, name, cap(input.bio, 1000), arr(input.cuisines), arr(input.communes), cap(input.photoRef, 200)],
      );
      await audit(sql, { actor: principal.userId, action: "chef.applied", target: `chef:${row!.id}`, country, detail: {} });
      return publicProfile(row!);
    });
  }

  /** The caller's own chef profile and services (for the chef console). */
  async me(country: string, principal: Principal) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const [p] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE user_id = $1`, [principal.userId]);
      if (!p) return { profile: null, services: [] };
      const services = await sql.query<ServiceRow & Record<string, unknown>>(`SELECT ${SCOLS} FROM chef.service WHERE chef_id = $1 ORDER BY sort, created_at`, [p.id]);
      return { profile: publicProfile(p), services: services.map(publicService) };
    });
  }

  async #myChef(sql: Sql, principal: Principal): Promise<ProfileRow> {
    const [p] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE user_id = $1`, [principal.userId]);
    if (!p) throw forbidden("You are not a chef on Tunakula");
    return p;
  }

  /** Add or edit one of the chef's own services. */
  async saveService(country: string, principal: Principal, input: { id?: string | undefined; kind?: string | undefined; title?: string | undefined; description?: string | undefined; pricingModel?: string | undefined; rate?: string | undefined; currency?: string | undefined; minGuests?: number | undefined; maxGuests?: number | null | undefined; remote?: boolean | undefined; active?: boolean | undefined; sort?: number | undefined }) {
    this.#profile(country);
    const p = parseService(input);
    return this.db.tx({ country }, async (sql) => {
      const chef = await this.#myChef(sql, principal);
      if (input.id) {
        const [row] = await sql.query<ServiceRow & Record<string, unknown>>(
          `UPDATE chef.service SET kind=$3, title=$4, description=$5, pricing_model=$6, rate_minor=$7, currency=$8, min_guests=$9, max_guests=$10, remote=$11, active=$12, sort=$13, updated_at=now()
             WHERE id=$1 AND chef_id=$2 RETURNING ${SCOLS}`,
          [input.id, chef.id, p.kind, p.title, p.description, p.rateMinor.toString(), p.currency, p.minGuests, p.maxGuests, p.remote, p.active, p.sort],
        );
        if (!row) throw notFound("Service");
        await audit(sql, { actor: principal.userId, action: "chef.service_updated", target: `chef:${chef.id}`, country, detail: { service: input.id } });
        return publicService(row);
      }
      const [row] = await sql.query<ServiceRow & Record<string, unknown>>(
        `INSERT INTO chef.service (country_iso2, chef_id, kind, title, description, pricing_model, rate_minor, currency, min_guests, max_guests, remote, active, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${SCOLS}`,
        [country, chef.id, p.kind, p.title, p.description, p.pricingModel, p.rateMinor.toString(), p.currency, p.minGuests, p.maxGuests, p.remote, p.active, p.sort],
      );
      await audit(sql, { actor: principal.userId, action: "chef.service_added", target: `chef:${chef.id}`, country, detail: { service: row!.id } });
      return publicService(row!);
    });
  }

  // ── Ops review ──

  async pending(country: string, principal: Principal) {
    if (!this.#opsAllowed(principal, country)) throw forbidden("Reviewing chefs is for operations staff");
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE status = 'PENDING' ORDER BY created_at`);
      return { chefs: rows.map(publicProfile) };
    });
  }

  async decide(country: string, principal: Principal, chefId: string, approve: boolean) {
    if (!this.#opsAllowed(principal, country)) throw forbidden("Reviewing chefs is for operations staff");
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE id = $1 FOR UPDATE`, [chefId]);
      if (!row) throw notFound("Chef");
      if (row.user_id === principal.userId) throw forbidden("Nobody reviews their own application");
      const status = approve ? "APPROVED" : "SUSPENDED";
      await sql.query("UPDATE chef.profile SET status = $2, updated_at = now() WHERE id = $1", [chefId, status]);
      await audit(sql, { actor: principal.userId, action: approve ? "chef.approved" : "chef.suspended", target: `chef:${chefId}`, country, detail: {} });
      return { id: chefId, status };
    });
  }

  // ── Public discovery ──

  async list(country: string, filters: { cuisine?: string; commune?: string; kind?: string } = {}) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const chefs = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE status = 'APPROVED' ORDER BY created_at`);
      const out = [];
      for (const c of chefs) {
        if (filters.cuisine && !c.cuisines.includes(filters.cuisine)) continue;
        if (filters.commune && !c.communes.includes(filters.commune)) continue;
        const services = (await sql.query<ServiceRow & Record<string, unknown>>(`SELECT ${SCOLS} FROM chef.service WHERE chef_id = $1 AND active = true ORDER BY sort, created_at`, [c.id]))
          .filter((s) => !filters.kind || s.kind === filters.kind);
        if (services.length === 0) continue;
        out.push({ ...publicProfile(c), services: services.map(publicService) });
      }
      return { chefs: out };
    });
  }

  async get(country: string, id: string) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const [c] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE id = $1 AND status = 'APPROVED'`, [id]);
      if (!c) throw notFound("Chef");
      const services = await sql.query<ServiceRow & Record<string, unknown>>(`SELECT ${SCOLS} FROM chef.service WHERE chef_id = $1 AND active = true ORDER BY sort, created_at`, [id]);
      return { ...publicProfile(c), services: services.map(publicService) };
    });
  }

  // ── Pricing (the fee by model + the 10% service charge the platform adds on top) ──

  /** A price preview for a service at a party size / duration. Public — no booking is made. */
  async quote(country: string, input: { serviceId?: string | undefined; partySize?: number | undefined; hours?: number | undefined }) {
    this.#profile(country);
    if (!input.serviceId) throw badRequest("SERVICE_REQUIRED", "Pick a service");
    const bps = this.#profile(country).pricing.service_charge_bps;
    return this.db.tx({ country }, async (sql) => {
      const [s] = await sql.query<ServiceRow & Record<string, unknown>>(`SELECT ${SCOLS} FROM chef.service WHERE id = $1 AND active = true`, [input.serviceId]);
      if (!s) throw notFound("Service");
      const { partySize, hours } = clampQuoteInput(s, input);
      const q = quoteMoney(s, partySize, hours, bps);
      return { service_id: s.id, party_size: partySize, hours, ...wireQuote(q) };
    });
  }

  // ── Bookings ──

  async requestBooking(country: string, principal: Principal, input: { serviceId?: string | undefined; scheduledFor?: string | undefined; partySize?: number | undefined; hours?: number | undefined; locationLabel?: string | undefined; lat?: number | undefined; lng?: number | undefined; note?: string | undefined }) {
    const bps = this.#profile(country).pricing.service_charge_bps;
    if (!input.serviceId) throw badRequest("SERVICE_REQUIRED", "Pick a service");
    const when = new Date(String(input.scheduledFor ?? ""));
    if (Number.isNaN(when.getTime())) throw badRequest("TIME_INVALID", "Choose a date and time");
    if (when.getTime() < this.now().getTime()) throw badRequest("TIME_PAST", "Choose a time in the future");
    return this.db.tx({ country }, async (sql) => {
      const [s] = await sql.query<ServiceRow & Record<string, unknown>>(`SELECT ${SCOLS} FROM chef.service WHERE id = $1 AND active = true`, [input.serviceId]);
      if (!s) throw notFound("Service");
      const [chef] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE id = $1`, [s.chef_id]);
      if (!chef || chef.status !== "APPROVED") throw notFound("Chef");
      if (chef.user_id === principal.userId) throw forbidden("You cannot book yourself");
      const { partySize, hours } = clampQuoteInput(s, input);
      const q = quoteMoney(s, partySize, hours, bps);
      const [row] = await sql.query<BookingRow & Record<string, unknown>>(
        `INSERT INTO chef.booking (country_iso2, chef_id, service_id, customer_id, status, scheduled_for, party_size, hours, location_label, lat, lng, note, fee_minor, service_charge_minor, total_minor, currency)
         VALUES ($1,$2,$3,$4,'REQUESTED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${BCOLS}`,
        [country, s.chef_id, s.id, principal.userId, when, partySize, hours, cap(input.locationLabel, 200), input.lat ?? null, input.lng ?? null, cap(input.note, 500), q.fee.minor.toString(), q.serviceCharge.minor.toString(), q.total.minor.toString(), q.fee.currency],
      );
      await audit(sql, { actor: principal.userId, action: "chef.booking_requested", target: `chef:${s.chef_id}`, country, detail: { booking: row!.id } });
      return publicBooking(row!);
    });
  }

  /** The customer's own bookings. */
  async myBookings(country: string, principal: Principal) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<BookingRow & Record<string, unknown>>(`SELECT ${BCOLS} FROM chef.booking WHERE customer_id = $1 ORDER BY created_at DESC`, [principal.userId]);
      return { bookings: rows.map(publicBooking) };
    });
  }

  /** The caller-chef's booking inbox. */
  async inbox(country: string, principal: Principal) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const chef = await this.#myChef(sql, principal);
      const rows = await sql.query<BookingRow & Record<string, unknown>>(`SELECT ${BCOLS} FROM chef.booking WHERE chef_id = $1 ORDER BY created_at DESC`, [chef.id]);
      return { bookings: rows.map(publicBooking) };
    });
  }

  /** Chef confirms or declines a requested booking. */
  async respond(country: string, principal: Principal, bookingId: string, accept: boolean, reason?: string) {
    this.#profile(country);
    if (!accept && !(reason ?? "").trim()) throw badRequest("REASON_REQUIRED", "Tell the customer why (they see this)");
    return this.db.tx({ country }, async (sql) => {
      const { booking, chef } = await this.#ownedBooking(sql, principal, bookingId);
      if (booking.status !== "REQUESTED") throw conflict("NOT_REQUESTED", `This booking is ${booking.status.toLowerCase()}`);
      const status: Status = accept ? "CONFIRMED" : "DECLINED";
      const [row] = await sql.query<BookingRow & Record<string, unknown>>(`UPDATE chef.booking SET status=$2, decline_reason=$3, updated_at=now() WHERE id=$1 RETURNING ${BCOLS}`, [bookingId, status, accept ? "" : (reason ?? "").trim().slice(0, 500)]);
      await audit(sql, { actor: principal.userId, action: accept ? "chef.booking_confirmed" : "chef.booking_declined", target: `chef:${chef.id}`, country, detail: { booking: bookingId } });
      return publicBooking(row!);
    });
  }

  /** Chef marks a confirmed booking complete; the money settles to the ledger (chef keeps the fee, platform the service charge). */
  async complete(country: string, principal: Principal, bookingId: string) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const { booking, chef } = await this.#ownedBooking(sql, principal, bookingId);
      if (booking.status !== "CONFIRMED") throw conflict("NOT_CONFIRMED", `This booking is ${booking.status.toLowerCase()}`);
      const ccy = booking.currency;
      const fee = Money.ofMinor(BigInt(booking.fee_minor), ccy);
      const sc = Money.ofMinor(BigInt(booking.service_charge_minor), ccy);
      const total = Money.ofMinor(BigInt(booking.total_minor), ccy);
      const base: LedgerEntry[] = [
        { account: "psp_clearing", country, amount: total }, // the customer's payment came in
        { account: "chef_payable", country, amount: fee.negate() }, // owed to the chef, in full
        { account: "service_charge_revenue", country, amount: sc.negate() }, // the platform's 10%
      ];
      const entries = base.filter((e) => !e.amount.isZero());
      const key = `chef-booking:${bookingId}:settlement`;
      if (entries.length >= 2) await postJournal(sql, createJournal({ id: `chef-settle:${bookingId}`, idempotencyKey: key, description: `Chef booking ${bookingId} settlement`, entries, postedAt: this.now() }));
      const [row] = await sql.query<BookingRow & Record<string, unknown>>(`UPDATE chef.booking SET status='COMPLETED', journal_key=$2, updated_at=now() WHERE id=$1 RETURNING ${BCOLS}`, [bookingId, key]);
      await audit(sql, { actor: principal.userId, action: "chef.booking_completed", target: `chef:${chef.id}`, country, detail: { booking: bookingId } });
      return publicBooking(row!);
    });
  }

  /** The customer cancels their own booking while it is still ahead of them. */
  async cancel(country: string, principal: Principal, bookingId: string) {
    this.#profile(country);
    return this.db.tx({ country }, async (sql) => {
      const [booking] = await sql.query<BookingRow & Record<string, unknown>>(`SELECT ${BCOLS} FROM chef.booking WHERE id = $1 FOR UPDATE`, [bookingId]);
      if (!booking) throw notFound("Booking");
      if (booking.customer_id !== principal.userId) throw forbidden("Only the person who booked can cancel it");
      if (booking.status !== "REQUESTED" && booking.status !== "CONFIRMED") throw conflict("NOT_CANCELLABLE", `This booking is ${booking.status.toLowerCase()}`);
      const [row] = await sql.query<BookingRow & Record<string, unknown>>(`UPDATE chef.booking SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING ${BCOLS}`, [bookingId]);
      await audit(sql, { actor: principal.userId, action: "chef.booking_cancelled", target: `chef:${booking.chef_id}`, country, detail: { booking: bookingId } });
      return publicBooking(row!);
    });
  }

  async #ownedBooking(sql: Sql, principal: Principal, bookingId: string): Promise<{ booking: BookingRow; chef: ProfileRow }> {
    const [booking] = await sql.query<BookingRow & Record<string, unknown>>(`SELECT ${BCOLS} FROM chef.booking WHERE id = $1 FOR UPDATE`, [bookingId]);
    if (!booking) throw notFound("Booking");
    const [chef] = await sql.query<ProfileRow & Record<string, unknown>>(`SELECT ${PCOLS} FROM chef.profile WHERE id = $1`, [booking.chef_id]);
    if (!chef || chef.user_id !== principal.userId) throw forbidden("This booking is for another chef");
    return { booking, chef };
  }
}

const PCOLS = "id, user_id, display_name, bio, cuisines, communes, photo_ref, status";
const SCOLS = "id, chef_id, kind, title, description, pricing_model, rate_minor, currency, min_guests, max_guests, remote, active, sort";
const BCOLS = "id, chef_id, service_id, customer_id, status, scheduled_for, party_size, hours, location_label, lat, lng, note, fee_minor, service_charge_minor, total_minor, currency, decline_reason, created_at";

const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 12) : []);

/** The chef's fee by pricing model, and the service charge the platform adds on top (bps of the fee). */
function quoteMoney(s: ServiceRow, partySize: number, hours: number, bps: number) {
  const ccy = s.currency;
  const rate = BigInt(s.rate_minor);
  const feeMinor = s.pricing_model === "PER_HEAD" ? rate * BigInt(partySize) : s.pricing_model === "HOURLY" ? rate * BigInt(hours) : rate;
  const fee = Money.ofMinor(feeMinor, ccy);
  const serviceCharge = fee.multiply({ numerator: BigInt(bps), denominator: 10_000n }, "half-up");
  return { fee, serviceCharge, total: fee.add(serviceCharge), serviceChargeBps: bps };
}

function clampQuoteInput(s: ServiceRow, input: { partySize?: number | undefined; hours?: number | undefined }) {
  const partySize = Math.max(s.min_guests, Math.min(s.max_guests ?? 999, Math.round(Number(input.partySize) || s.min_guests)));
  const hours = Math.max(1, Math.min(24, Math.round(Number(input.hours) || 1)));
  return { partySize, hours };
}

function parseService(input: { kind?: string | undefined; title?: string | undefined; description?: string | undefined; pricingModel?: string | undefined; rate?: string | undefined; currency?: string | undefined; minGuests?: number | undefined; maxGuests?: number | null | undefined; remote?: boolean | undefined; active?: boolean | undefined; sort?: number | undefined }) {
  const kind = String(input.kind ?? "").toUpperCase();
  if (!(KINDS as readonly string[]).includes(kind)) throw badRequest("KIND_INVALID", "kind is ADVICE, PRIVATE_DINING, MEAL_PREP, EVENT or CLASS");
  const pricingModel = String(input.pricingModel ?? "").toUpperCase();
  if (!(MODELS as readonly string[]).includes(pricingModel)) throw badRequest("MODEL_INVALID", "pricing_model is FIXED, PER_HEAD or HOURLY");
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) throw badRequest("TITLE_REQUIRED", "Give the service a title");
  const currency = String(input.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest("CURRENCY_INVALID", "A 3-letter currency, e.g. USD");
  let rateMinor: bigint;
  try { rateMinor = Money.of(String(input.rate ?? "0"), currency).minor; } catch { throw badRequest("RATE_INVALID", "Give a price, e.g. 120.00"); }
  if (rateMinor < 0n) throw badRequest("RATE_INVALID", "A price cannot be negative");
  const minGuests = Math.max(1, Math.round(Number(input.minGuests) || 1));
  const maxGuests = input.maxGuests == null ? null : Math.max(minGuests, Math.round(Number(input.maxGuests)));
  return { kind: kind as Kind, title, description: cap(input.description, 1000), pricingModel: pricingModel as Model, rateMinor, currency, minGuests, maxGuests, remote: Boolean(input.remote), active: input.active !== false, sort: Math.round(Number(input.sort) || 0) };
}

function publicProfile(p: ProfileRow) {
  return { id: p.id, display_name: p.display_name, bio: p.bio, cuisines: p.cuisines, communes: p.communes, photo_ref: p.photo_ref, status: p.status };
}
function publicService(s: ServiceRow) {
  return { id: s.id, kind: s.kind, title: s.title, description: s.description, pricing_model: s.pricing_model, rate: { amount_minor: String(s.rate_minor), currency: s.currency }, min_guests: s.min_guests, max_guests: s.max_guests, remote: s.remote, active: s.active, sort: s.sort };
}
function wireQuote(q: { fee: Money; serviceCharge: Money; total: Money; serviceChargeBps: number }) {
  const m = (x: Money) => ({ amount_minor: x.minor.toString(), currency: x.currency });
  return { fee: m(q.fee), service_charge: m(q.serviceCharge), total: m(q.total), service_charge_bps: q.serviceChargeBps, commission: { amount_minor: "0", currency: q.fee.currency } };
}
function publicBooking(b: BookingRow) {
  return {
    id: b.id, chef_id: b.chef_id, service_id: b.service_id, customer_id: b.customer_id, status: b.status,
    scheduled_for: new Date(b.scheduled_for).toISOString(), party_size: b.party_size, hours: b.hours,
    location_label: b.location_label, note: b.note,
    fee: { amount_minor: String(b.fee_minor), currency: b.currency },
    service_charge: { amount_minor: String(b.service_charge_minor), currency: b.currency },
    total: { amount_minor: String(b.total_minor), currency: b.currency },
    commission: { amount_minor: "0", currency: b.currency },
    ...(b.decline_reason ? { decline_reason: b.decline_reason } : {}),
    created_at: new Date(b.created_at).toISOString(),
  };
}
