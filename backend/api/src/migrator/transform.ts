/**
 * StackFood → Tunakula data migration — the PURE transforms (no database, no I/O), so the risky part is
 * unit-tested on its own. The runner (run.ts) reads rows from the old MySQL and feeds them here; these
 * functions normalise and validate each row into a canonical Tunakula record, or return a typed problem so
 * a bad row is reported, never silently dropped.
 *
 * Money is kept in integer minor units throughout (StackFood stores decimals like "12.50"); the decimal is
 * parsed by string, never through a float, so no cent is ever lost to rounding. Phone numbers become E.164
 * because identity on the new platform is phone + OTP — that is how a migrated customer signs in with the
 * number they already have.
 *
 * Which source column holds each field is NOT hard-coded here: it comes from the field map (mapping.ts),
 * so the whole thing is tuned to the real dump by editing that one config, not this logic.
 */

export type Row = Record<string, unknown>;

/** A problem with one source row; collected and reported, so nothing is lost without a trace. */
export interface RowProblem {
  readonly entity: string;
  readonly sourceId: string | null;
  readonly field: string;
  readonly reason: string;
}

export type Mapped<T> = { ok: true; value: T } | { ok: false; problem: RowProblem };

// ── field readers ──

export function str(row: Row, col: string): string | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function int(row: Row, col: string): number | null {
  const s = str(row, col);
  if (s === null) return null;
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

/**
 * Parse a non-negative decimal string into integer minor units, by string math (no float). "12.5" with 2
 * fraction digits → "1250"; "12" → "1200"; "12.509" → null (more precision than the currency has). A value
 * that is not a clean decimal returns null so the caller can report it.
 */
export function toMinorUnits(decimal: string, fractionDigits = 2): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? "";
  if (frac.length > fractionDigits) return null; // would need rounding — refuse rather than lose precision
  const padded = (frac + "0".repeat(fractionDigits)).slice(0, fractionDigits);
  const joined = (whole + padded).replace(/^0+(?=\d)/, "");
  return joined === "" ? "0" : joined;
}

/**
 * Normalise a raw phone to E.164 (+<digits>). Strips spaces, dashes and parentheses; turns a leading 00
 * into +; prefixes the market's country calling code when the number is given in national form (a single
 * leading 0, or no + at all). Returns null when there are too few digits to be a real number.
 */
export function normalizePhone(raw: string, countryCallingCode: string): string | null {
  let s = raw.replace(/[\s()\-.]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
  }
  s = s.replace(/\D/g, "");
  if (s.startsWith("0")) s = s.replace(/^0+/, "");
  if (s.startsWith(countryCallingCode)) return s.length >= 8 && s.length <= 15 ? "+" + s : null;
  const joined = countryCallingCode + s;
  return joined.length >= 8 && joined.length <= 15 ? "+" + joined : null;
}

// ── canonical target records ──

export interface UserRecord {
  readonly sourceId: string;
  readonly phoneE164: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly createdAt: string | null;
}
export interface MerchantRecord {
  readonly sourceId: string;
  readonly name: string;
  readonly ownerPhoneE164: string | null;
}
export interface BranchRecord {
  readonly sourceId: string;
  readonly merchantSourceId: string;
  readonly name: string;
  readonly storeType: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly commune: string | null;
}
export interface MenuItemRecord {
  readonly sourceId: string;
  readonly branchSourceId: string;
  readonly name: string;
  readonly priceMinor: string;
  readonly currency: string;
  readonly available: boolean;
}
export interface OrderRecord {
  readonly sourceId: string;
  readonly branchSourceId: string;
  readonly customerSourceId: string | null;
  readonly totalMinor: string;
  readonly currency: string;
  readonly state: string;
  readonly placedAt: string | null;
}

// Which source column holds each canonical field. Required keys are read unconditionally; optional keys
// (a column the dump may or may not carry) are read only when present.
export interface UserFields { readonly id: string; readonly phone: string; readonly name?: string; readonly email?: string; readonly createdAt?: string }
export interface MerchantFields { readonly id: string; readonly name: string; readonly ownerPhone?: string }
export interface BranchFields { readonly id: string; readonly merchantId: string; readonly name: string; readonly lat?: string; readonly lng?: string; readonly commune?: string }
export interface ItemFields { readonly id: string; readonly branchId: string; readonly name: string; readonly price: string; readonly available?: string }
export interface OrderFields { readonly id: string; readonly branchId: string; readonly total: string; readonly status: string; readonly customerId?: string; readonly placedAt?: string }

export interface MigratorConfig {
  readonly countryCallingCode: string; // e.g. "243" for DRC
  readonly currency: string; // the market currency, e.g. "CDF"
  readonly fractionDigits: number; // minor-unit digits for that currency (CDF = 0, USD = 2)
  readonly storeTypeFor: (sourceRow: Row) => string; // decide RESTAURANT / GROCERY / PHARMACY / BOUTIQUE …
  readonly stateFor: (sourceStatus: string) => string; // map StackFood order status → Tunakula order state
  readonly fields: {
    readonly user: UserFields;
    readonly merchant: MerchantFields;
    readonly branch: BranchFields;
    readonly item: ItemFields;
    readonly order: OrderFields;
  };
}

const problem = (entity: string, sourceId: string | null, field: string, reason: string): RowProblem => ({ entity, sourceId, field, reason });

export function mapUser(row: Row, cfg: MigratorConfig): Mapped<UserRecord> {
  const f = cfg.fields.user;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("user", null, f.id, "missing id") };
  const rawPhone = str(row, f.phone);
  if (!rawPhone) return { ok: false, problem: problem("user", sourceId, f.phone, "missing phone") };
  const phone = normalizePhone(rawPhone, cfg.countryCallingCode);
  if (!phone) return { ok: false, problem: problem("user", sourceId, f.phone, `unparseable phone: ${rawPhone}`) };
  return {
    ok: true,
    value: { sourceId, phoneE164: phone, displayName: f.name ? str(row, f.name) : null, email: f.email ? str(row, f.email) : null, createdAt: f.createdAt ? str(row, f.createdAt) : null },
  };
}

export function mapMerchant(row: Row, cfg: MigratorConfig): Mapped<MerchantRecord> {
  const f = cfg.fields.merchant;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("merchant", null, f.id, "missing id") };
  const name = str(row, f.name);
  if (!name) return { ok: false, problem: problem("merchant", sourceId, f.name, "missing name") };
  const ownerPhone = f.ownerPhone ? str(row, f.ownerPhone) : null;
  return { ok: true, value: { sourceId, name, ownerPhoneE164: ownerPhone ? normalizePhone(ownerPhone, cfg.countryCallingCode) : null } };
}

export function mapBranch(row: Row, cfg: MigratorConfig): Mapped<BranchRecord> {
  const f = cfg.fields.branch;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("branch", null, f.id, "missing id") };
  const merchantSourceId = str(row, f.merchantId);
  if (!merchantSourceId) return { ok: false, problem: problem("branch", sourceId, f.merchantId, "missing merchant id") };
  const name = str(row, f.name);
  if (!name) return { ok: false, problem: problem("branch", sourceId, f.name, "missing name") };
  const latS = f.lat ? str(row, f.lat) : null;
  const lngS = f.lng ? str(row, f.lng) : null;
  const lat = latS !== null && /^-?\d+(\.\d+)?$/.test(latS) ? Number(latS) : null;
  const lng = lngS !== null && /^-?\d+(\.\d+)?$/.test(lngS) ? Number(lngS) : null;
  return { ok: true, value: { sourceId, merchantSourceId, name, storeType: cfg.storeTypeFor(row), lat, lng, commune: f.commune ? str(row, f.commune) : null } };
}

export function mapItem(row: Row, cfg: MigratorConfig): Mapped<MenuItemRecord> {
  const f = cfg.fields.item;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("item", null, f.id, "missing id") };
  const branchSourceId = str(row, f.branchId);
  if (!branchSourceId) return { ok: false, problem: problem("item", sourceId, f.branchId, "missing branch id") };
  const name = str(row, f.name);
  if (!name) return { ok: false, problem: problem("item", sourceId, f.name, "missing name") };
  const priceRaw = str(row, f.price);
  if (!priceRaw) return { ok: false, problem: problem("item", sourceId, f.price, "missing price") };
  const priceMinor = toMinorUnits(priceRaw, cfg.fractionDigits);
  if (priceMinor === null) return { ok: false, problem: problem("item", sourceId, f.price, `bad price: ${priceRaw}`) };
  const available = f.available ? str(row, f.available) !== "0" : true;
  return { ok: true, value: { sourceId, branchSourceId, name, priceMinor, currency: cfg.currency, available } };
}

export function mapOrder(row: Row, cfg: MigratorConfig): Mapped<OrderRecord> {
  const f = cfg.fields.order;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("order", null, f.id, "missing id") };
  const branchSourceId = str(row, f.branchId);
  if (!branchSourceId) return { ok: false, problem: problem("order", sourceId, f.branchId, "missing branch id") };
  const totalRaw = str(row, f.total);
  if (!totalRaw) return { ok: false, problem: problem("order", sourceId, f.total, "missing total") };
  const totalMinor = toMinorUnits(totalRaw, cfg.fractionDigits);
  if (totalMinor === null) return { ok: false, problem: problem("order", sourceId, f.total, `bad total: ${totalRaw}`) };
  const status = str(row, f.status) ?? "";
  return {
    ok: true,
    value: {
      sourceId,
      branchSourceId,
      customerSourceId: f.customerId ? str(row, f.customerId) : null,
      totalMinor,
      currency: cfg.currency,
      state: cfg.stateFor(status),
      placedAt: f.placedAt ? str(row, f.placedAt) : null,
    },
  };
}

/** Run a mapper over many rows, splitting the results into clean records and problems. */
export function mapAll<T>(rows: readonly Row[], map: (row: Row) => Mapped<T>): { records: T[]; problems: RowProblem[] } {
  const records: T[] = [];
  const problems: RowProblem[] = [];
  for (const row of rows) {
    const r = map(row);
    if (r.ok) records.push(r.value);
    else problems.push(r.problem);
  }
  return { records, problems };
}
