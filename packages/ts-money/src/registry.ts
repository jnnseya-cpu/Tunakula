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
    volatilityClass: classOf(code),
    fxSources: p.fxSources[code] ?? [],
    controls: p.controls[code] ?? {},
  });

  const active: CurrencyDefinition[] = iso4217.currencies.map((c) => ({
    ...c,
    ...common(c.code),
    status: "ACTIVE",
  }));
  const retired: CurrencyDefinition[] = p.redenominations.map((r) => ({
    ...r,
    ...common(r.code),
    status: "RETIRED",
  }));
  return new CurrencyRegistry([...active, ...retired], iso4217.published);
}

/** Process-wide default registry. */
export const currencies = createDefaultRegistry();
