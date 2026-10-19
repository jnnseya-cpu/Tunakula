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
 * Convert a source decimal amount into the TARGET currency's integer minor units, by BigInt math (no
 * float), rescaling from the source's own precision to the target's and rounding half-up only when the
 * target has fewer digits. StackFood stores money as DECIMAL(x,2), so a CDF (0-minor-digit) market needs
 * "1500.00" → "1500", while a USD (2-digit) market needs "1500.00" → "150000". Unlike `toMinorUnits`, this
 * never rejects a value for having more source decimals than the target — that is the normal case here.
 * Returns null only when the string is not a clean non-negative decimal.
 */
export function moneyToMinor(decimal: string, targetFractionDigits: number): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? "";
  const srcScaled = BigInt(whole + frac); // = value × 10^(frac.length)
  const srcDigits = frac.length;
  if (targetFractionDigits >= srcDigits) {
    return (srcScaled * 10n ** BigInt(targetFractionDigits - srcDigits)).toString();
  }
  const drop = srcDigits - targetFractionDigits;
  const divisor = 10n ** BigInt(drop);
  const q = srcScaled / divisor;
  const r = srcScaled % divisor;
  const rounded = r * 2n >= divisor ? q + 1n : q; // round half-up
  return rounded.toString();
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

/**
 * Parse a StackFood id list — a food's `add_ons` column — into string ids. StackFood writes it as a JSON
 * array ("[1, 2, 3]"); some older installs use a comma-separated string ("1,2,3"). Both are accepted; an
 * empty/absent value yields no ids. Never throws.
 */
export function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  try {
    const v: unknown = JSON.parse(s);
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* not JSON — fall through to CSV */
  }
  return s.replace(/^[[\]]+|[[\]]+$/g, "").split(",").map((p) => p.trim()).filter((p) => p !== "" && p !== "null");
}

/**
 * Parse a StackFood variations JSON blob into Tunakula variation groups. v8.0 stores `food_variations`
 * (newer) as [{name,type,min,max,required,values:[{label,optionPrice}]}]; older installs use `variations`
 * with the same value shape and no type/min/max. This is deliberately lenient (optional menu metadata, not
 * money owed): malformed groups/options are skipped, and an option whose surcharge cannot be parsed is kept
 * with a 0 surcharge so the dish still imports and the merchant can correct the price in admin. Never throws.
 */
export function parseVariations(raw: string | null, fractionDigits: number): MigratedVariation[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MigratedVariation[] = [];
  for (const g of parsed) {
    if (!g || typeof g !== "object") continue;
    const grp = g as Record<string, unknown>;
    const name = typeof grp.name === "string" ? grp.name.trim() : "";
    if (!name) continue;
    const rawValues = Array.isArray(grp.values) ? grp.values : [];
    const options: MigratedOption[] = [];
    for (const v of rawValues) {
      if (!v || typeof v !== "object") continue;
      const val = v as Record<string, unknown>;
      const label = typeof val.label === "string" ? val.label.trim() : "";
      if (!label) continue;
      const priceStr = val.optionPrice === undefined || val.optionPrice === null ? "0" : String(val.optionPrice).trim();
      options.push({ name: label, priceMinor: moneyToMinor(priceStr || "0", fractionDigits) ?? "0" });
    }
    if (!options.length) continue;
    const type = String(grp.type ?? "").toLowerCase() === "multi" ? "MULTI" : "SINGLE";
    const required = grp.required === "on" || grp.required === true || grp.required === 1 || grp.required === "1";
    const minN = Number(grp.min);
    const maxN = Number(grp.max);
    const min = Number.isFinite(minN) && minN >= 0 ? Math.floor(minN) : required ? 1 : 0;
    const max = Number.isFinite(maxN) && maxN >= 1 ? Math.floor(maxN) : type === "SINGLE" ? 1 : options.length;
    out.push({ name, type, required, min, max: Math.max(max, min || 1), options });
  }
  return out;
}

/**
 * Resolve a food's `add_ons` id list against the loaded `add_ons` table into Tunakula add-on options. Ids
 * with no matching row are skipped (a stale reference), and an unparseable surcharge falls back to 0 so the
 * add-on still carries over for the merchant to price. Never throws.
 */
export function resolveAddons(raw: string | null, byId: ReadonlyMap<string, AddonSource>, fractionDigits: number): MigratedOption[] {
  const out: MigratedOption[] = [];
  for (const id of parseIdList(raw)) {
    const src = byId.get(id);
    if (!src || !src.name.trim()) continue;
    out.push({ name: src.name.trim(), priceMinor: moneyToMinor((src.price || "0").trim() || "0", fractionDigits) ?? "0" });
  }
  return out;
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
/** A paid add-on or a variation option, as carried to Tunakula: name + surcharge in integer minor units. */
export interface MigratedOption {
  readonly name: string;
  readonly priceMinor: string;
}
/** A variation group (StackFood food_variations / variations) → Tunakula's SINGLE/MULTI option group. */
export interface MigratedVariation {
  readonly name: string;
  readonly type: "SINGLE" | "MULTI";
  readonly required: boolean;
  readonly min: number;
  readonly max: number;
  readonly options: readonly MigratedOption[];
}
export interface MenuItemRecord {
  readonly sourceId: string;
  readonly branchSourceId: string;
  readonly name: string;
  readonly priceMinor: string;
  readonly currency: string;
  readonly available: boolean;
  readonly addons: readonly MigratedOption[];
  readonly variations: readonly MigratedVariation[];
}

/** One row of StackFood's `add_ons` table, resolved by id from a food's `add_ons` id list. */
export interface AddonSource {
  readonly id: string;
  readonly name: string;
  readonly price: string; // decimal, in the source currency (e.g. "1.50")
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
export interface ItemFields {
  readonly id: string; readonly branchId: string; readonly name: string; readonly price: string; readonly available?: string;
  readonly addOns?: string; // the food's add-on id list column (resolved against the add_ons table)
  readonly foodVariations?: string; // v8.0 variations JSON column
  readonly variations?: string; // older variations JSON column (fallback)
}
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

/**
 * `addonsById` resolves a food's add-on id list against StackFood's `add_ons` table (loaded by the runner).
 * It is optional so the pure transform and its tests stay callable with just a row; omit it and a food
 * carries no add-ons. Add-ons and variations are optional metadata, so a problem there never rejects the
 * item — see `resolveAddons` / `parseVariations`.
 */
export function mapItem(row: Row, cfg: MigratorConfig, addonsById?: ReadonlyMap<string, AddonSource>): Mapped<MenuItemRecord> {
  const f = cfg.fields.item;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("item", null, f.id, "missing id") };
  const branchSourceId = str(row, f.branchId);
  if (!branchSourceId) return { ok: false, problem: problem("item", sourceId, f.branchId, "missing branch id") };
  const name = str(row, f.name);
  if (!name) return { ok: false, problem: problem("item", sourceId, f.name, "missing name") };
  const priceRaw = str(row, f.price);
  if (!priceRaw) return { ok: false, problem: problem("item", sourceId, f.price, "missing price") };
  const priceMinor = moneyToMinor(priceRaw, cfg.fractionDigits);
  if (priceMinor === null) return { ok: false, problem: problem("item", sourceId, f.price, `bad price: ${priceRaw}`) };
  const available = f.available ? str(row, f.available) !== "0" : true;
  const addons = f.addOns ? resolveAddons(str(row, f.addOns), addonsById ?? new Map(), cfg.fractionDigits) : [];
  // Prefer the v8.0 food_variations column; fall back to the older `variations` column when it is absent.
  const varRaw = (f.foodVariations ? str(row, f.foodVariations) : null) ?? (f.variations ? str(row, f.variations) : null);
  const variations = parseVariations(varRaw, cfg.fractionDigits);
  return { ok: true, value: { sourceId, branchSourceId, name, priceMinor, currency: cfg.currency, available, addons, variations } };
}

export function mapOrder(row: Row, cfg: MigratorConfig): Mapped<OrderRecord> {
  const f = cfg.fields.order;
  const sourceId = str(row, f.id);
  if (!sourceId) return { ok: false, problem: problem("order", null, f.id, "missing id") };
  const branchSourceId = str(row, f.branchId);
  if (!branchSourceId) return { ok: false, problem: problem("order", sourceId, f.branchId, "missing branch id") };
  const totalRaw = str(row, f.total);
  if (!totalRaw) return { ok: false, problem: problem("order", sourceId, f.total, "missing total") };
  const totalMinor = moneyToMinor(totalRaw, cfg.fractionDigits);
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
