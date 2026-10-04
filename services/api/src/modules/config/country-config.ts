/**
 * Country Config (PRD §17): the public, runtime configuration an app fetches
 * from GET /v1/countries/{iso2}/config (§9.5). It is derived from the
 * published Country Profile and the brand — never edited by hand — and leaves
 * out internal settings (fraud profiles, connector ids, KYC internals).
 */
import { currencyFlag, displayName, displaySymbol } from "@tunakula/ts-money";
import type { CountryProfile, PaymentMethodType } from "@tunakula/ts-contracts";
import { themeVersion, type Brand, type ThemeTokens } from "./brand.ts";

export interface CountryConfig {
  readonly iso2: string;
  readonly name: string;
  readonly status: CountryProfile["country"]["status"];
  readonly profileVersion: number;
  /** Regional API host for all subsequent calls (§9.4, §9.5). */
  readonly apiHost: string;
  readonly timezones: readonly string[];
  readonly languages: readonly string[];
  readonly defaultLocale: string;
  readonly phone: { readonly countryCode: string; readonly otpChannels: readonly string[] };
  readonly currencies: {
    readonly accepted: readonly {
      readonly code: string;
      readonly name: string;
      readonly symbol: string;
      /** Appendix A: every currency is shown with a flag (emoji, plus the country code for SVG rendering). */
      readonly flag?: { readonly country: string; readonly emoji: string };
    }[];
    readonly settlement: string;
    readonly displayDefault: string;
    readonly dualCurrency: boolean;
    readonly cashRounding: CountryProfile["money"]["cash_rounding"];
  };
  readonly addressing: { readonly model: CountryProfile["addressing"]["model"]; readonly fields: readonly string[]; readonly accessNotes: boolean };
  /** In Country Profile rank order; apps hide methods with no route at checkout (§20.5). */
  readonly paymentMethods: readonly PaymentMethodType[];
  readonly cashOnDelivery: CountryProfile["payments"]["cod_policy"];
  readonly confirmationModel: CountryProfile["operations"]["confirmation_model"];
  readonly businessModels: CountryProfile["operations"]["business_models"];
  readonly channels: readonly string[];
  readonly lowBandwidthDefault: boolean;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly layouts: { readonly home: string; readonly checkout: string };
  readonly brand: {
    readonly id: string;
    readonly name: string;
    readonly appName: string;
    readonly logos: Brand["logos"];
    readonly themeId: string;
    readonly themeVersion: string;
    readonly light: ThemeTokens;
    readonly dark: ThemeTokens;
    readonly copy: Readonly<Record<string, string>>;
  };
}

export function deriveCountryConfig(profile: CountryProfile, brand: Brand, apiHost: string): CountryConfig {
  const theme = brand.themes.find((t) => t.id === profile.experience.theme_id);
  if (brand.id !== profile.experience.brand_id) throw new Error(`Profile uses brand ${profile.experience.brand_id}, got ${brand.id}`);
  if (!theme) throw new Error(`Brand ${brand.id} has no theme ${profile.experience.theme_id}`);
  const locale = profile.country.default_locale;
  const language = locale.split("-")[0] ?? locale;

  return {
    iso2: profile.country.iso2,
    name: profile.country.name,
    status: profile.country.status,
    profileVersion: profile.version,
    apiHost,
    timezones: profile.country.timezones,
    languages: profile.experience.locales,
    defaultLocale: locale,
    phone: { countryCode: profile.country.phone_country_code, otpChannels: profile.trust.otp_channels },
    currencies: {
      accepted: profile.money.currencies.map((code) => {
        const flag = currencyFlag(code, { market: profile.country.iso2 });
        return { code, name: displayName(code, locale), symbol: displaySymbol(code, locale), ...(flag ? { flag } : {}) };
      }),
      settlement: profile.money.settlement_currency,
      displayDefault: profile.money.display_default,
      dualCurrency: profile.money.dual_currency,
      cashRounding: profile.money.cash_rounding,
    },
    addressing: { model: profile.addressing.model, fields: profile.addressing.fields, accessNotes: profile.addressing.access_notes_enabled },
    paymentMethods: [...profile.payments.methods].sort((a, b) => a.rank - b.rank).map((m) => m.type),
    cashOnDelivery: profile.payments.cod_policy,
    confirmationModel: profile.operations.confirmation_model,
    businessModels: profile.operations.business_models,
    channels: Object.entries(profile.channels)
      .filter(([, c]) => c.enabled)
      .sort(([, a], [, b]) => a.priority - b.priority)
      .map(([name]) => name),
    lowBandwidthDefault: profile.infrastructure.low_bandwidth_default,
    featureFlags: profile.feature_flags,
    layouts: { home: profile.experience.home_layout_id, checkout: profile.experience.checkout_layout_id },
    brand: {
      id: brand.id,
      name: brand.name,
      appName: brand.appName,
      logos: brand.logos,
      themeId: theme.id,
      themeVersion: themeVersion(theme),
      light: theme.light,
      dark: theme.dark,
      copy: Object.fromEntries(
        Object.entries(brand.copy).flatMap(([key, byLocale]) => {
          const text = byLocale[locale] ?? byLocale[language] ?? byLocale["en"];
          return text ? [[key, text]] : [];
        }),
      ),
    },
  };
}
