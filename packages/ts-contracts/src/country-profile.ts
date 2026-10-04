/**
 * Country Profile (PRD §7.2): the versioned, schema-validated description of
 * a market across the 12 adaptation dimensions. Launching a market means
 * publishing a profile — never a code change. Field names are snake_case to
 * match the stored JSON document (§21 `country_profile`).
 */
import type { RoundingMode } from "@tunakula/ts-money";
import type { PaymentMethodType } from "./payments.ts";

export const MARKET_ROLES = ["HOME_LEADER", "CORRIDOR_ORIGIN", "CORRIDOR_DESTINATION", "NICHE_LEADER", "CHALLENGER"] as const;
export const COUNTRY_STATUSES = ["DRAFT", "PILOT", "LIVE", "PAUSED"] as const;
export const PROFILE_STATUSES = ["DRAFT", "PUBLISHED", "SUPERSEDED"] as const;
export const ADDRESS_MODELS = ["POSTCODE", "STREET", "LANDMARK_PIN", "HYBRID"] as const;
export const LABOUR_MODELS = ["SELF_EMPLOYED", "FLEET", "EMPLOYED", "HYBRID"] as const;
export const VEHICLE_TYPES = ["MOTO", "BICYCLE", "CAR", "FOOT"] as const;
export const CONFIRMATION_MODELS = ["RESTAURANT_FIRST", "RIDER_FIRST", "AGENT_OPTIMISED"] as const;
export const BUSINESS_MODELS = ["COMMISSION", "SUBSCRIPTION", "HYBRID"] as const;
export const OTP_CHANNELS = ["SMS", "WHATSAPP", "VOICE", "EMAIL"] as const;
export const CHANNEL_KEYS = ["app", "web", "whatsapp", "sms", "ussd", "voice_support"] as const;

type OneOf<T extends readonly string[]> = T[number];

export interface CashRounding {
  readonly currency: string;
  /** Smallest practical unit in major units, as a decimal string. */
  readonly increment: string;
  readonly mode: RoundingMode;
}

export interface PaymentMethodConfig {
  readonly type: PaymentMethodType;
  /** 1 = shown first at checkout (§20.5). */
  readonly rank: number;
  readonly limits?: readonly { readonly currency: string; readonly min?: string; readonly max?: string }[];
}

export interface ConnectorRoute {
  readonly id: string;
  /** Lower runs first. Ties are broken by measured success rate, then cost. */
  readonly priority: number;
  /** Restrict this connector to some methods in this market. Omitted = all it supports. */
  readonly methods?: readonly PaymentMethodType[];
}

export interface CountryProfile {
  readonly schema_version: 1;
  readonly version: number;
  readonly status: OneOf<typeof PROFILE_STATUSES>;
  /** Fictional/test profiles are flagged so they can never be published to production. */
  readonly synthetic?: boolean;
  readonly country: {
    readonly iso2: string;
    readonly name: string;
    readonly status: OneOf<typeof COUNTRY_STATUSES>;
    readonly market_role: OneOf<typeof MARKET_ROLES>;
    readonly default_locale: string;
    readonly timezones: readonly string[];
    readonly phone_country_code: string;
  };
  /** D1 — Money. */
  readonly money: {
    readonly currencies: readonly string[];
    readonly settlement_currency: string;
    readonly display_default: string;
    readonly dual_currency: boolean;
    readonly cash_rounding: readonly CashRounding[];
    readonly price_refresh_policy: "STANDARD" | "DRIFT_ALERT" | "CONTINUOUS";
  };
  /** D2 — Payment behaviour. */
  readonly payments: {
    readonly methods: readonly PaymentMethodConfig[];
    readonly connectors: readonly ConnectorRoute[];
    readonly cod_policy: {
      readonly enabled: boolean;
      readonly cash_cap?: readonly { readonly currency: string; readonly amount: string }[];
    };
    readonly payout_rails: readonly string[];
  };
  /** D3 — Trust and identity. */
  readonly trust: {
    readonly otp_channels: readonly OneOf<typeof OTP_CHANNELS>[];
    readonly id_document_types: readonly string[];
    readonly kyc_levels: Readonly<Record<string, readonly string[]>>;
    readonly fraud_profile_id: string;
    /** §17 rider_kyc_rules: reference to the market's rider onboarding checks. */
    readonly rider_kyc_rules_id: string;
  };
  /** D4 — Addressing. */
  readonly addressing: {
    readonly model: OneOf<typeof ADDRESS_MODELS>;
    readonly fields: readonly string[];
    readonly resolver_adapter: string;
    readonly access_notes_enabled: boolean;
  };
  /** D5 — Mobility and geography. */
  readonly mobility: {
    readonly vehicle_types: readonly OneOf<typeof VEHICLE_TYPES>[];
    readonly routing_adapter: string;
    readonly seasonal_factors: readonly { readonly name: string; readonly months: readonly number[]; readonly travel_time_factor: string }[];
  };
  /** D6 — Rider labour model. */
  readonly labour: {
    readonly model: OneOf<typeof LABOUR_MODELS>;
    readonly adapter: string;
    readonly max_shift_hours: number;
    readonly transparency_disclosures: boolean;
  };
  /** D7 — Regulation and data law. */
  readonly compliance: {
    readonly pack_id: string;
    readonly data_residency: string;
    readonly retention_policy_id: string;
    readonly tax_profile_id: string;
    readonly invoice_format: string;
  };
  /** D8 — Culture and calendar. */
  readonly calendar: {
    readonly holidays: readonly { readonly name: string; readonly date: string }[];
    readonly religious_periods: readonly string[];
    readonly paydays: readonly string[];
    readonly seasonal_events: readonly string[];
  };
  /** D9 — Food and ordering habits. */
  readonly food: {
    readonly tags: readonly string[];
    readonly allergen_rules: string;
    readonly group_orders: boolean;
    readonly gifting: boolean;
  };
  /** D10 — Infrastructure. */
  readonly infrastructure: {
    readonly network_profile: "GOOD" | "MIXED" | "POOR";
    readonly device_profile: "HIGH_END" | "MIXED" | "LOW_END";
    readonly power_reliability: "HIGH" | "MEDIUM" | "LOW";
    readonly low_bandwidth_default: boolean;
  };
  /** D11 — Channel preference. */
  readonly channels: Readonly<Record<OneOf<typeof CHANNEL_KEYS>, { readonly enabled: boolean; readonly priority: number }>>;
  readonly experience: {
    readonly brand_id: string;
    readonly theme_id: string;
    readonly locales: readonly string[];
    readonly checkout_layout_id: string;
    readonly home_layout_id: string;
  };
  readonly operations: {
    readonly playbook_id: string;
    readonly support_hours: string;
    readonly support_channels: readonly string[];
    readonly sla_promises: Readonly<Record<string, number>>;
    readonly confirmation_model: OneOf<typeof CONFIRMATION_MODELS>;
    readonly business_models: readonly OneOf<typeof BUSINESS_MODELS>[];
    /** §17 delivery_fee_formula: reference to the market's fee formula (§18.3). */
    readonly delivery_fee_formula_id: string;
    /** Largest refund a Support Agent may issue, per accepted currency (§8.2). Above it, Country Finance. */
    readonly support_refund_limit: readonly { readonly currency: string; readonly amount: string }[];
  };
  /**
   * §18 pricing — every rate is per-market configuration. Amounts are major-unit
   * decimal strings in the settlement currency (MR-5); rates are basis points.
   */
  readonly pricing: {
    /** §18.2 customer service charge on the merchant subtotal (group default 1000 = 10%). */
    readonly service_charge_bps: number;
    /** §18.2/§18.9: compulsory fees included in the first price shown (e.g. UK DMCC Act). */
    readonly all_in_pricing: boolean;
    readonly delivery_fee: {
      readonly per_km: string;
      readonly cap: string;
      /** The cap holds up to this distance (group default 7 km). */
      readonly cap_hold_km: number;
      /** Beyond the hold, the fee steps up once per band (group default 8 km, +30%). */
      readonly band_km: number;
      readonly band_step_bps: number;
      /** Rural zones pay this share of the city fee (group default 7500 = 75%). */
      readonly rural_bps: number;
    };
    /** §18.4 rider share of the delivery fee actually charged (group default 7000 = 70%). */
    readonly rider_share_bps: number;
    /** §18.4 performance bonus as a share of the rider's own delivery earnings. */
    readonly rider_bonus_bps: number;
    /** §18.5 published maximum surge multiplier, e.g. "2.0". */
    readonly surge_max_multiplier: string;
    /** §18.6 discovery radius and delivery promise. */
    readonly discovery_radius_km: number;
    readonly promise_minutes: number;
  };
  readonly feature_flags: Readonly<Record<string, boolean>>;
}
