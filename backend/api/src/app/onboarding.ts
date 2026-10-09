/**
 * Rider self-registration with identity checks (§12 rider onboarding), and the private media store it needs.
 *
 * A person signs in with their phone, uploads an ID document and a selfie (and a licence for motorbikes and
 * cars), and applies for one or more communes. Automatic checks run at once: age 18+, the ID number's format
 * for its type, the same ID already used by someone else, distinct photos, licence and plate where needed.
 * Operations staff (rider:manage) see the photos side by side and approve, which grants the RIDER role in
 * those zones, or reject with a reason. Every decision is audited. Documents are never public.
 */
import { createHash } from "node:crypto";
import type { Db, Sql } from "../db/db.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { addBinding, audit } from "../persistence/identity.ts";
import type { CommerceService } from "./commerce.ts";
import { DispatchService } from "./dispatch.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "./errors.ts";

const MEDIA_MAX_BYTES = 600_000;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PURPOSES = ["RIDER_ID", "RIDER_SELFIE", "RIDER_LICENCE", "PACK_PHOTO", "PROOF_PHOTO", "MENU_ITEM"] as const;
type Purpose = (typeof PURPOSES)[number];
const ID_TYPES = ["NATIONAL_ID", "VOTER_CARD", "PASSPORT", "DRIVING_LICENCE"] as const;
const ID_FORMAT: Record<(typeof ID_TYPES)[number], RegExp> = {
  NATIONAL_ID: /^[A-Z0-9]{6,20}$/,
  VOTER_CARD: /^[0-9]{8,20}$/,
  PASSPORT: /^[A-Z]{1,2}[0-9]{6,8}$/,
  DRIVING_LICENCE: /^[A-Z0-9]{5,20}$/,
};
const MOTORISED = ["MOTO", "CAR"];

export interface Check { readonly code: string; readonly ok: boolean; readonly detail: string }

/** Magic bytes, so a file is what it says it is. */
function sniff(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export class OnboardingService {
  private readonly db: Db;
  private readonly commerce: CommerceService;
  private readonly now: () => Date;
  private readonly notifier: undefined | { dispatch(input: { country: string; eventKey: string; recipientUserId: string; audience?: string; data?: Record<string, string | number>; dedupeKey?: string }): Promise<unknown> };

  constructor(db: Db, commerce: CommerceService, now: () => Date = () => new Date(), notifier?: OnboardingService["notifier"]) {
    this.db = db;
    this.commerce = commerce;
    this.now = now;
    this.notifier = notifier;
  }

  async #can(principal: Principal, country: string, actions: readonly Action[]): Promise<boolean> {
    const profile = this.commerce.profile(country);
    const cities = await this.db.tx({ country }, (sql) => sql.query<{ city: string }>("SELECT DISTINCT city FROM catalogue.branch WHERE city IS NOT NULL"));
    const resources = [{ type: "order", country }, ...cities.map((c) => ({ type: "order", country, cityId: c.city }))];
    return actions.some((a) => resources.some((r) => authorize(principal, a, r, { activeCountry: country, profile }).allowed));
  }

  /** POST /v1/media — a private image, owned by the uploader. Returns its id and SHA-256. */
  async upload(principal: Principal, country: string, input: { purpose: string; content_type: string; data_base64: string }) {
    this.commerce.profile(country);
    if (!(PURPOSES as readonly string[]).includes(input.purpose)) throw badRequest("PURPOSE_INVALID", `purpose is one of ${PURPOSES.join(", ")}`);
    if (!MEDIA_TYPES.includes(input.content_type)) throw badRequest("TYPE_INVALID", "Send a JPEG, PNG or WebP image");
    if (typeof input.data_base64 !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(input.data_base64)) throw badRequest("DATA_INVALID", "data_base64 must be base64");
    const bytes = Buffer.from(input.data_base64, "base64");
    if (bytes.length === 0) throw badRequest("DATA_EMPTY", "The image is empty");
    if (bytes.length > MEDIA_MAX_BYTES) throw unprocessable("IMAGE_TOO_LARGE", `Images are at most ${MEDIA_MAX_BYTES / 1000} kB; the app shrinks photos before sending`);
    const actual = sniff(bytes);
    if (actual !== input.content_type) throw unprocessable("IMAGE_MISMATCH", "The file is not the image type it claims to be");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.db.tx({ country }, async (sql) => {
      const [row] = await sql.query<{ id: string }>(
        "INSERT INTO media.object (country_iso2, owner_user_id, purpose, content_type, sha256, size_bytes, bytes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [country, principal.userId, input.purpose, input.content_type, sha256, bytes.length, bytes, this.now()],
      );
      return { id: row!.id, sha256, size_bytes: bytes.length };
    });
  }

  /** GET /v1/media/:id — the owner, or rider reviewers for rider documents in this market. */
  async read(principal: Principal, country: string, id: string) {
    const row = await this.db.tx({ country }, async (sql) => (await sql.query<{ owner_user_id: string; purpose: Purpose; content_type: string; bytes: Buffer }>(
      "SELECT owner_user_id, purpose, content_type, bytes FROM media.object WHERE id = $1", [id],
    ))[0]);
    if (!row) throw notFound("Image");
    const reviewer = row.purpose.startsWith("RIDER_") && (await this.#can(principal, country, ["rider:manage"]));
    if (row.owner_user_id !== principal.userId && !reviewer) throw notFound("Image");
    return { content_type: row.content_type, data_base64: Buffer.from(row.bytes).toString("base64") };
  }

  async #ownedMedia(sql: Sql, userId: string, id: string | undefined, purpose: Purpose) {
    if (!id) return null;
    const [m] = await sql.query<{ id: string; sha256: string; owner_user_id: string; purpose: string }>("SELECT id, sha256, owner_user_id, purpose FROM media.object WHERE id = $1", [id]);
    if (!m || m.owner_user_id !== userId || m.purpose !== purpose) throw unprocessable("PHOTO_INVALID", `The ${purpose.toLowerCase().replace("rider_", "")} photo is missing or not yours`);
    return m;
  }

  /** POST /v1/rider-applications — apply to ride; automatic checks run now. */
  async apply(principal: Principal, country: string, input: {
    full_name: string; date_of_birth: string; zones: string[]; vehicle: string; plate?: string;
    id_type: string; id_number: string; id_photo: string; selfie: string; licence_photo?: string;
  }) {
    this.commerce.profile(country);
    if (DispatchService.riderZones(principal).length > 0) throw conflict("ALREADY_RIDER", "You are already a rider");
    const name = (input.full_name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 4 || !name.includes(" ")) throw badRequest("NAME_REQUIRED", "Your full name as on your ID (first name and surname)");
    if (!(ID_TYPES as readonly string[]).includes(input.id_type)) throw badRequest("ID_TYPE_INVALID", `id_type is one of ${ID_TYPES.join(", ")}`);
    if (!["MOTO", "BICYCLE", "CAR", "FOOT"].includes(input.vehicle)) throw badRequest("VEHICLE_INVALID", "vehicle is MOTO, BICYCLE, CAR or FOOT");
    const dob = new Date(`${input.date_of_birth}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date_of_birth ?? "") || Number.isNaN(dob.getTime())) throw badRequest("DOB_INVALID", "date_of_birth is YYYY-MM-DD");
    const idNumber = (input.id_number ?? "").toUpperCase().replace(/[\s.-]/g, "");
    const plate = input.plate?.toUpperCase().replace(/\s+/g, " ").trim() || null;
    const now = this.now();
    const age = (now.getTime() - dob.getTime()) / (365.2425 * 86_400_000);

    return this.db.tx({ country }, async (sql) => {
      const communes = (await sql.query<{ commune: string }>("SELECT DISTINCT commune FROM catalogue.branch WHERE commune IS NOT NULL")).map((r) => r.commune);
      const zones = [...new Set((input.zones ?? []).map((z) => String(z).toLowerCase()))];
      if (zones.length === 0 || zones.some((z) => !communes.includes(z))) throw badRequest("ZONES_INVALID", `Choose communes where Tunakula operates: ${communes.join(", ")}`);
      const idPhoto = await this.#ownedMedia(sql, principal.userId, input.id_photo, "RIDER_ID");
      const selfie = await this.#ownedMedia(sql, principal.userId, input.selfie, "RIDER_SELFIE");
      const licence = await this.#ownedMedia(sql, principal.userId, input.licence_photo, "RIDER_LICENCE");
      const dup = await sql.query<{ user_id: string; status: string }>(
        "SELECT user_id, status FROM onboarding.rider_application WHERE id_type = $1 AND id_number = $2 AND user_id <> $3 LIMIT 1",
        [input.id_type, idNumber, principal.userId],
      );
      const checks: Check[] = [
        { code: "AGE", ok: age >= 18 && age <= 75, detail: `${Math.floor(age)} years old` },
        { code: "ID_FORMAT", ok: ID_FORMAT[input.id_type as keyof typeof ID_FORMAT].test(idNumber), detail: `${input.id_type} ${idNumber}` },
        { code: "PHOTOS", ok: !!idPhoto && !!selfie, detail: idPhoto && selfie ? "ID and selfie received" : "ID and selfie are both required" },
        { code: "PHOTOS_DISTINCT", ok: !!idPhoto && !!selfie && idPhoto.sha256 !== selfie.sha256, detail: "The selfie must be a different photo from the ID" },
        { code: "DUPLICATE_ID", ok: dup.length === 0, detail: dup.length ? `This ID is on another applicant's file (${dup[0]!.status.toLowerCase()})` : "Not used by anyone else" },
        { code: "LICENCE", ok: !MOTORISED.includes(input.vehicle) || (!!licence && !!plate), detail: MOTORISED.includes(input.vehicle) ? (licence && plate ? `Licence and plate ${plate}` : "Motorbikes and cars need a licence photo and the plate") : "Not needed" },
      ];
      // Hard failures stop the application; a duplicate ID goes to a person to look at.
      const blocking = checks.filter((c) => !c.ok && c.code !== "DUPLICATE_ID");
      if (blocking.length) throw unprocessable("CHECKS_FAILED", blocking.map((c) => c.detail).join("; "), { checks });
      const [row] = await sql.query<{ id: string }>(
        `INSERT INTO onboarding.rider_application (country_iso2, user_id, full_name, date_of_birth, zones, vehicle, plate, id_type, id_number, id_photo, selfie, licence_photo, checks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (user_id) WHERE status = 'PENDING' DO NOTHING RETURNING id`,
        [country, principal.userId, name, input.date_of_birth, zones, input.vehicle, plate, input.id_type, idNumber, idPhoto!.id, selfie!.id, licence?.id ?? null, JSON.stringify(checks), now],
      );
      if (!row) throw conflict("APPLICATION_OPEN", "You already have an application being reviewed");
      await audit(sql, { actor: principal.userId, action: "rider.applied", target: `application:${row.id}`, country, detail: { zones, vehicle: input.vehicle, flags: checks.filter((c) => !c.ok).map((c) => c.code) } });
      return { id: row.id, status: "PENDING", checks };
    });
  }

  /** GET /v1/rider-applications/mine */
  async mine(principal: Principal, country: string) {
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<{ id: string; status: string; zones: string[]; created_at: Date; reviewed_at: Date | null; decision_note: string | null }>(
        "SELECT id, status, zones, created_at, reviewed_at, decision_note FROM onboarding.rider_application WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5",
        [principal.userId],
      );
      return { is_rider: DispatchService.riderZones(principal).length > 0, data: rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null })) };
    });
  }

  /** GET /v1/ops/rider-applications?status= — for reviewers. */
  async list(principal: Principal, country: string, status = "PENDING") {
    if (!(await this.#can(principal, country, ["rider:manage"]))) throw forbidden("Reviewing riders needs rider:manage");
    return this.db.tx({ country }, async (sql) => {
      const rows = await sql.query<Record<string, unknown> & { created_at: Date; reviewed_at: Date | null; date_of_birth: Date }>(
        `SELECT a.id, a.status, a.full_name, a.date_of_birth, a.zones, a.vehicle, a.plate, a.id_type, a.id_number, a.id_photo, a.selfie, a.licence_photo,
                a.checks, a.created_at, a.reviewed_at, a.decision_note, u.phone_e164 AS phone
           FROM onboarding.rider_application a JOIN identity.app_user u ON u.id = a.user_id
          WHERE ($1 = 'ALL' OR a.status = $1) ORDER BY a.created_at LIMIT 100`,
        [status],
      );
      return { data: rows.map((r) => ({ ...r, date_of_birth: new Date(r.date_of_birth).toISOString().slice(0, 10), created_at: new Date(r.created_at).toISOString(), reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null })) };
    });
  }

  /** POST /v1/ops/rider-applications/:id/approve | /reject */
  async decide(principal: Principal, country: string, id: string, approve: boolean, note?: string) {
    if (!(await this.#can(principal, country, ["rider:manage"]))) throw forbidden("Reviewing riders needs rider:manage");
    if (!approve && !(note ?? "").trim()) throw badRequest("REASON_REQUIRED", "Tell the applicant why (they see this)");
    const applicantId = await this.db.tx({ country }, async (sql) => {
      const [a] = await sql.query<{ id: string; user_id: string; status: string; zones: string[]; checks: Check[] }>(
        "SELECT id, user_id, status, zones, checks FROM onboarding.rider_application WHERE id = $1 FOR UPDATE", [id],
      );
      if (!a) throw notFound("Application");
      if (a.status !== "PENDING") throw conflict("ALREADY_DECIDED", `This application is ${a.status.toLowerCase()}`);
      if (a.user_id === principal.userId) throw forbidden("Nobody reviews their own application");
      const flagged = a.checks.filter((c) => !c.ok).map((c) => c.code);
      if (approve && flagged.length && !(note ?? "").trim()) throw badRequest("NOTE_REQUIRED", `Checks flagged ${flagged.join(", ")}: say why you approve anyway`);
      if (approve) {
        for (const zone of a.zones) await addBinding(sql, { userId: a.user_id, role: "RIDER", scope: { type: "ZONE", id: zone } });
      }
      await sql.query("UPDATE onboarding.rider_application SET status = $2, reviewed_by = $3, reviewed_at = $4, decision_note = $5 WHERE id = $1",
        [id, approve ? "APPROVED" : "REJECTED", principal.userId, this.now(), note?.trim() || null]);
      await audit(sql, { actor: principal.userId, action: approve ? "rider.approved" : "rider.rejected", target: `user:${a.user_id}`, country, detail: { application: id, zones: a.zones, flags: flagged, ...(note ? { note } : {}) } });
      return a.user_id;
    });
    // Tell the applicant, once, outside the decision transaction (a notify failure never undoes it).
    await this.notifier?.dispatch({
      country, eventKey: approve ? "rider.approved" : "rider.rejected", recipientUserId: applicantId,
      audience: "rider", dedupeKey: `rider-decision:${id}`, ...(note?.trim() ? { data: { reason: note.trim() } } : {}),
    }).catch(() => undefined);
    return { id, status: approve ? "APPROVED" : "REJECTED" };
  }
}
