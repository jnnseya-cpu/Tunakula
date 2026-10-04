import { Ajv2020 } from "ajv/dist/2020.js";
import { Money, currencies as defaultRegistry, incrementInMinorUnits, parseDecimal, type CurrencyRegistry } from "@tunakula/ts-money";
import type { CountryProfile } from "./country-profile.ts";
import { countryProfileSchema } from "./country-profile.schema.ts";

export interface ProfileIssue {
  /** JSON Pointer into the profile, e.g. "/money/settlement_currency". */
  readonly path: string;
  readonly message: string;
}

export type ProfileValidation =
  | { readonly ok: true; readonly profile: CountryProfile }
  | { readonly ok: false; readonly issues: readonly ProfileIssue[] };

export interface ValidateOptions {
  readonly registry?: CurrencyRegistry;
  /** Synthetic (test-matrix) profiles are refused in production. */
  readonly environment?: "production" | "non-production";
  /** Date the profile is validated for; dated exceptions must still be in force. */
  readonly asOf?: Date;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaValidator = ajv.compile(countryProfileSchema);

/**
 * Validates a Country Profile document: JSON Schema first (§7.2), then the
 * cross-field rules a schema cannot express — every currency is in the
 * Currency Registry, amounts are representable in their currency, rankings
 * are unambiguous, and so on.
 */
export function validateCountryProfile(document: unknown, options: ValidateOptions = {}): ProfileValidation {
  if (!schemaValidator(document)) {
    return {
      ok: false,
      issues: (schemaValidator.errors ?? []).map((e) => ({ path: e.instancePath || "/", message: e.message ?? "invalid" })),
    };
  }
  const profile = document as unknown as CountryProfile;
  const issues = semanticIssues(profile, options);
  return issues.length === 0 ? { ok: true, profile } : { ok: false, issues };
}

function semanticIssues(p: CountryProfile, options: ValidateOptions): ProfileIssue[] {
  const registry = options.registry ?? defaultRegistry;
  const issues: ProfileIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  const accepted = new Set(p.money.currencies);

  if (options.environment === "production" && p.synthetic) {
    issue("/synthetic", "synthetic profiles cannot be used in production");
  }

  p.money.currencies.forEach((code, i) => {
    if (!registry.has(code)) issue(`/money/currencies/${i}`, `${code} is not in the Currency Registry`);
    else if (registry.get(code).status !== "ACTIVE") issue(`/money/currencies/${i}`, `${code} is retired`);
  });
  for (const key of ["settlement_currency", "display_default"] as const) {
    if (!accepted.has(p.money[key])) issue(`/money/${key}`, `${p.money[key]} is not one of money.currencies`);
  }
  if (p.money.dual_currency !== p.money.currencies.length > 1) {
    issue("/money/dual_currency", "dual_currency must be true exactly when more than one currency is accepted");
  }

  const known = (code: string) => accepted.has(code) && registry.has(code);
  const checkAmount = (path: string, currency: string, amount: string) => {
    if (!known(currency)) return issue(path, `${currency} is not one of money.currencies`);
    try {
      Money.of(amount, currency, registry);
    } catch (error) {
      issue(path, (error as Error).message);
    }
  };

  const rounded = new Set<string>();
  p.money.cash_rounding.forEach((rule, i) => {
    const path = `/money/cash_rounding/${i}`;
    if (rounded.has(rule.currency)) issue(path, `duplicate cash rounding rule for ${rule.currency}`);
    rounded.add(rule.currency);
    if (!known(rule.currency)) return issue(path, `${rule.currency} is not one of money.currencies`);
    try {
      incrementInMinorUnits(rule, registry);
    } catch (error) {
      issue(`${path}/increment`, (error as Error).message);
    }
  });

  const ranks = new Set<number>();
  const methods = new Set<string>();
  p.payments.methods.forEach((method, i) => {
    const path = `/payments/methods/${i}`;
    if (ranks.has(method.rank)) issue(`${path}/rank`, `rank ${method.rank} is used twice`);
    if (methods.has(method.type)) issue(`${path}/type`, `${method.type} is listed twice`);
    ranks.add(method.rank);
    methods.add(method.type);
    method.limits?.forEach((limit, j) => {
      const lp = `${path}/limits/${j}`;
      if (limit.min !== undefined) checkAmount(`${lp}/min`, limit.currency, limit.min);
      if (limit.max !== undefined) checkAmount(`${lp}/max`, limit.currency, limit.max);
      if (limit.min !== undefined && limit.max !== undefined && known(limit.currency)) {
        try {
          if (Money.of(limit.min, limit.currency, registry).compare(Money.of(limit.max, limit.currency, registry)) > 0) {
            issue(lp, "min is greater than max");
          }
        } catch {
          // Representability is already reported by checkAmount.
        }
      }
    });
  });

  const codEnabled = p.payments.cod_policy.enabled;
  if (codEnabled !== methods.has("CASH_ON_DELIVERY")) {
    issue("/payments/cod_policy/enabled", "cod_policy.enabled must match whether CASH_ON_DELIVERY is a payment method");
  }
  if (codEnabled && !(p.payments.cod_policy.cash_cap?.length)) {
    issue("/payments/cod_policy/cash_cap", "cash on delivery requires a per-currency cash cap");
  }
  const exception = p.payments.cod_policy.exception;
  if (codEnabled && !exception) {
    issue("/payments/cod_policy/exception", "cash on delivery is off by default; enabling it needs a CEO-approved, dated exception (§29.6)");
  }
  if (exception) {
    if (!codEnabled) issue("/payments/cod_policy/exception", "an exception is only meaningful when cash on delivery is enabled");
    if (exception.end_date <= exception.approved_on) issue("/payments/cod_policy/exception/end_date", "end date must follow the approval date");
    const asOf = options.asOf?.toISOString().slice(0, 10);
    if (asOf && exception.end_date < asOf) issue("/payments/cod_policy/exception/end_date", `the COD exception ended on ${exception.end_date}`);
  }
  p.payments.cod_policy.cash_cap?.forEach((cap, i) => checkAmount(`/payments/cod_policy/cash_cap/${i}`, cap.currency, cap.amount));

  const connectorIds = new Set<string>();
  p.payments.connectors.forEach((route, i) => {
    const path = `/payments/connectors/${i}`;
    if (connectorIds.has(route.id)) issue(`${path}/id`, `connector ${route.id} is listed twice`);
    connectorIds.add(route.id);
    route.methods?.forEach((m, j) => {
      if (!methods.has(m)) issue(`${path}/methods/${j}`, `${m} is not an enabled payment method in this market`);
    });
  });

  const limited = new Set<string>();
  p.operations.support_refund_limit.forEach((limit, i) => {
    const path = `/operations/support_refund_limit/${i}`;
    if (limited.has(limit.currency)) issue(path, `duplicate support refund limit for ${limit.currency}`);
    limited.add(limit.currency);
    checkAmount(path, limit.currency, limit.amount);
  });
  for (const code of p.money.currencies) {
    if (!limited.has(code)) issue("/operations/support_refund_limit", `no support refund limit for ${code}`);
  }

  const fee = p.pricing.delivery_fee;
  checkAmount("/pricing/delivery_fee/per_km", p.money.settlement_currency, fee.per_km);
  checkAmount("/pricing/delivery_fee/cap", p.money.settlement_currency, fee.cap);
  try {
    const ccy = p.money.settlement_currency;
    if (Money.of(fee.cap, ccy, registry).compare(Money.of(fee.per_km, ccy, registry)) < 0) issue("/pricing/delivery_fee/cap", "cap must be at least the per-km rate");
  } catch {
    // Representability is already reported by checkAmount.
  }
  const surge = parseDecimal(p.pricing.surge_max_multiplier);
  if (surge.numerator < surge.denominator) issue("/pricing/surge_max_multiplier", "surge cap must be at least 1.0");

  if (!p.experience.locales.includes(p.country.default_locale)) {
    issue("/country/default_locale", "default_locale must be one of experience.locales");
  }
  p.country.timezones.forEach((tz, i) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      issue(`/country/timezones/${i}`, `${tz} is not an IANA time zone`);
    }
  });

  return issues;
}
