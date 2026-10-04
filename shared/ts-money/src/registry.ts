import iso4217 from "../data/iso4217.json" with { type: "json" };
import policy from "../data/registry-policy.json" with { type: "json" };

/** PRD §19.5. Drives FX quote TTL and price-refresh behaviour. */
export const VOLATILITY_CLASSES = ["PEGGED", "MANAGED", "VOLATILE", "HYPER"] as const;
export type VolatilityClass = (typeof VOLATILITY_CLASSES)[number];

/** PRD §19.8. Enforced by the Money context; recorded per currency. */
export interface CurrencyControls {
  readonly conversionRestricted?: boolean;
  readonly repatriationRestricted?: boolean;
  readonly foreignCurrencyPricingAllowed?: boolean;
  readonly notes?: string;
}

/** One Currency Registry record (PRD §19.4 / §21 `currency`). */
export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code, e.g. "CDF". */
  readonly code: string;
  /** ISO 4217 numeric code, e.g. "976". */
  readonly numericCode: string;
  /** ISO 4217 English name. Localised names come from CLDR via `displayName`. */
  readonly name: string;
  /** ISO 4217 minor units (0–4). */
  readonly minorUnits: number;
  /** ISO 3166-1 alpha-2 codes of the countries ISO lists for this currency (from ISO 4217 data). */
  readonly countries: readonly string[];
  /** Flag country when no market context applies (issuer bloc or central-bank seat). */
  readonly flagCountry?: string;
  readonly volatilityClass: VolatilityClass;
  /** Ordered FX rate providers. */
  readonly fxSources: readonly string[];
  readonly controls: CurrencyControls;
  readonly status: "ACTIVE" | "RETIRED";
  /** Redenomination (PRD §19.6): the code this currency was replaced by. */
  readonly replacedBy?: string;
  /** Old units per one new unit, as an exact decimal string. */
  readonly conversionFactor?: string;
  /** Date the replacement took effect (ISO 8601 date). */
  readonly effectiveDate?: string;
}

export class UnknownCurrencyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Unknown currency "${code}". Register it in the Currency Registry first.`);
    this.name = "UnknownCurrencyError";
    this.code = code;
  }
}

const CODE_PATTERN = /^[A-Z]{3}$/;
const NUMERIC_PATTERN = /^\d{3}$/;
const MAX_MINOR_UNITS = 4;

/**
 * The single source of truth for currency facts (MR-10). Code never assumes a
 * currency's precision, symbol or volatility: it asks the registry.
 */
export class CurrencyRegistry {
  readonly #byCode = new Map<string, CurrencyDefinition>();
  /** ISO publication date of the seed data. */
  readonly isoPublished: string | undefined;

  constructor(definitions: readonly CurrencyDefinition[], isoPublished?: string) {
    this.isoPublished = isoPublished;
    for (const definition of definitions) this.register(definition);
  }

  register(definition: CurrencyDefinition): void {
    const { code, numericCode, minorUnits, volatilityClass } = definition;
    if (!CODE_PATTERN.test(code)) throw new TypeError(`Invalid currency code "${code}"`);
    if (!NUMERIC_PATTERN.test(numericCode)) {
      throw new TypeError(`Invalid numeric code "${numericCode}" for ${code}`);
    }
    if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > MAX_MINOR_UNITS) {
      throw new RangeError(`Invalid minor units ${minorUnits} for ${code}`);
    }
    if (!VOLATILITY_CLASSES.includes(volatilityClass)) {
      throw new TypeError(`Invalid volatility class "${volatilityClass}" for ${code}`);
    }
    if (this.#byCode.has(code)) throw new Error(`Currency ${code} is already registered`);
    this.#byCode.set(code, Object.freeze({ ...definition }));
  }

  has(code: string): boolean {
    return this.#byCode.has(code);
  }

  get(code: string): CurrencyDefinition {
    const definition = this.#byCode.get(code);
    if (!definition) throw new UnknownCurrencyError(code);
    return definition;
  }

  /** Throws unless the currency exists and is not retired. */
  getActive(code: string): CurrencyDefinition {
    const definition = this.get(code);
    if (definition.status !== "ACTIVE") {
      throw new Error(`Currency ${code} is retired; replaced by ${definition.replacedBy ?? "nothing"}`);
    }
    return definition;
  }

  list(filter: { status?: CurrencyDefinition["status"] } = {}): CurrencyDefinition[] {
    const all = [...this.#byCode.values()];
    return filter.status ? all.filter((c) => c.status === filter.status) : all;
  }
}

/** Localised currency name from CLDR (via ICU), e.g. ("CDF", "fr") → "franc congolais". */
export function displayName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
}

/** Localised currency symbol from CLDR, e.g. ("CDF", "fr-CD") → "FC". */
export function displaySymbol(code: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency: code }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? code;
}

interface RegistryPolicy {
  flagIssuer: Partial<Record<string, string>>;
  defaultVolatilityClass: string;
  volatilityClasses: Partial<Record<string, readonly string[]>>;
  controls: Partial<Record<string, CurrencyControls>>;
  fxSources: Partial<Record<string, readonly string[]>>;
  redenominations: readonly {
    code: string;
    numericCode: string;
    name: string;
    minorUnits: number;
    replacedBy: string;
    effectiveDate: string;
    conversionFactor: string;
  }[];
}

/** Builds the default registry: ISO 4217 seed + platform policy overlay. */
export function createDefaultRegistry(): CurrencyRegistry {
  const p: RegistryPolicy = policy;
  const classOf = (code: string): VolatilityClass => {
    for (const cls of VOLATILITY_CLASSES) if (p.volatilityClasses[cls]?.includes(code)) return cls;
    return p.defaultVolatilityClass as VolatilityClass;
  };
  const common = (code: string) => ({
    ...(p.flagIssuer[code] ? { flagCountry: p.flagIssuer[code] as string } : {}),
    volatilityClass: classOf(code),
    fxSources: p.fxSources[code] ?? [],
    controls: p.controls[code] ?? {},
  });

  const active: CurrencyDefinition[] = iso4217.currencies.map((c) => ({
    ...c,
    ...common(c.code),
    status: "ACTIVE",
  }));
  const countriesOf = (code: string) => iso4217.currencies.find((c) => c.code === code)?.countries ?? [];
  const retired: CurrencyDefinition[] = p.redenominations.map((r) => ({
    ...r,
    countries: countriesOf(r.replacedBy),
    ...common(r.code),
    status: "RETIRED",
  }));
  return new CurrencyRegistry([...active, ...retired], iso4217.published);
}

/** Process-wide default registry. */
export const currencies = createDefaultRegistry();

/** Emoji flag for an ISO 3166-1 alpha-2 code (regional indicator symbols). */
export function flagEmoji(alpha2: string): string {
  if (!/^[A-Z]{2}$/.test(alpha2)) throw new TypeError(`Invalid country code "${alpha2}"`);
  return String.fromCodePoint(...[...alpha2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export interface CurrencyFlag {
  /** ISO 3166-1 alpha-2 (or "EU"): apps render an SVG flag from this where emoji flags do not display. */
  readonly country: string;
  readonly emoji: string;
}

/**
 * The flag shown next to a currency (Appendix A: "flag in every currency").
 *  1. Inside a market where the currency is legal tender: that market's flag (XOF in Côte d'Ivoire → 🇨🇮).
 *  2. Otherwise the ISO 4217 convention: the code starts with the issuer's country code (USD → 🇺🇸).
 *  3. Otherwise the policy issuer (EUR → 🇪🇺, XOF → 🇸🇳 BCEAO, XAF → 🇨🇲 BEAC).
 *  4. Otherwise the only country listed. Currencies with no country (supranational units) get none.
 */
export function currencyFlag(code: string, options: { market?: string; registry?: CurrencyRegistry } = {}): CurrencyFlag | undefined {
  const c = (options.registry ?? currencies).get(code);
  const prefix = c.code.slice(0, 2);
  const country =
    (options.market && c.countries.includes(options.market) ? options.market : undefined) ??
    (c.countries.includes(prefix) ? prefix : undefined) ??
    c.flagCountry ??
    (c.countries.length === 1 ? c.countries[0] : undefined);
  return country ? { country, emoji: flagEmoji(country) } : undefined;
}
