/** JSON Schema (draft 2020-12) for the Country Profile — PRD §7.2. */
import { PAYMENT_METHOD_TYPES } from "./payments.ts";
import {
  ADDRESS_MODELS,
  BUSINESS_MODELS,
  CHANNEL_KEYS,
  CONFIRMATION_MODELS,
  COUNTRY_STATUSES,
  LABOUR_MODELS,
  MARKET_ROLES,
  OTP_CHANNELS,
  PROFILE_STATUSES,
  VEHICLE_TYPES,
} from "./country-profile.ts";

const ccy = { type: "string", pattern: "^[A-Z]{3}$" } as const;
const decimal = { type: "string", pattern: "^\\d+(\\.\\d+)?$" } as const;
const id = { type: "string", minLength: 1 } as const;
const ids = { type: "array", items: id } as const;
const bool = { type: "boolean" } as const;
const enumOf = (values: readonly string[]) => ({ enum: [...values] });
/** Closed object; every property required unless listed in `optional`. */
const obj = (properties: Record<string, unknown>, optional: readonly string[] = []) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  properties,
});
const limits = {
  type: "array",
  items: { type: "object", additionalProperties: false, required: ["currency"], properties: { currency: ccy, min: decimal, max: decimal } },
} as const;

export const COUNTRY_PROFILE_SCHEMA_ID = "https://schemas.tunakula.com/country-profile/v1.json";

export const countryProfileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: COUNTRY_PROFILE_SCHEMA_ID,
  title: "Tunakula Country Profile",
  ...obj(
    {
      schema_version: { const: 1 },
      version: { type: "integer", minimum: 1 },
      status: enumOf(PROFILE_STATUSES),
      country: obj({
        iso2: { type: "string", pattern: "^[A-Z]{2}$" },
        name: id,
        status: enumOf(COUNTRY_STATUSES),
        market_role: enumOf(MARKET_ROLES),
        default_locale: id,
        timezones: { type: "array", minItems: 1, items: id },
        phone_country_code: { type: "string", pattern: "^\\+\\d{1,4}$" },
      }),
      money: obj({
        currencies: { type: "array", minItems: 1, uniqueItems: true, items: ccy },
        settlement_currency: ccy,
        display_default: ccy,
        dual_currency: bool,
        cash_rounding: {
          type: "array",
          items: obj({ currency: ccy, increment: decimal, mode: enumOf(["half-up", "half-even", "floor", "ceil", "truncate"]) }),
        },
        price_refresh_policy: enumOf(["STANDARD", "DRIFT_ALERT", "CONTINUOUS"]),
      }),
      payments: obj({
        methods: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "rank"],
            properties: { type: enumOf(PAYMENT_METHOD_TYPES), rank: { type: "integer", minimum: 1 }, limits },
          },
        },
        connectors: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "priority"],
            properties: { id, priority: { type: "integer", minimum: 0 }, methods: { type: "array", items: enumOf(PAYMENT_METHOD_TYPES) } },
          },
        },
        cod_policy: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: { enabled: bool, cash_cap: { type: "array", items: obj({ currency: ccy, amount: decimal }) } },
        },
        payout_rails: ids,
      }),
      trust: obj({
        otp_channels: { type: "array", minItems: 1, items: enumOf(OTP_CHANNELS) },
        id_document_types: ids,
        kyc_levels: { type: "object", additionalProperties: ids },
        fraud_profile_id: id,
        rider_kyc_rules_id: id,
      }),
      addressing: obj({ model: enumOf(ADDRESS_MODELS), fields: ids, resolver_adapter: id, access_notes_enabled: bool }),
      mobility: obj({
        vehicle_types: { type: "array", minItems: 1, items: enumOf(VEHICLE_TYPES) },
        routing_adapter: id,
        seasonal_factors: {
          type: "array",
          items: obj({ name: id, months: { type: "array", items: { type: "integer", minimum: 1, maximum: 12 } }, travel_time_factor: decimal }),
        },
      }),
      labour: obj({ model: enumOf(LABOUR_MODELS), adapter: id, max_shift_hours: { type: "number", exclusiveMinimum: 0, maximum: 24 }, transparency_disclosures: bool }),
      compliance: obj({ pack_id: id, data_residency: id, retention_policy_id: id, tax_profile_id: id, invoice_format: id }),
      calendar: obj({
        holidays: { type: "array", items: obj({ name: id, date: { type: "string", pattern: "^(\\d{4}-)?\\d{2}-\\d{2}$" } }) },
        religious_periods: ids,
        paydays: ids,
        seasonal_events: ids,
      }),
      food: obj({ tags: ids, allergen_rules: id, group_orders: bool, gifting: bool }),
      infrastructure: obj({
        network_profile: enumOf(["GOOD", "MIXED", "POOR"]),
        device_profile: enumOf(["HIGH_END", "MIXED", "LOW_END"]),
        power_reliability: enumOf(["HIGH", "MEDIUM", "LOW"]),
        low_bandwidth_default: bool,
      }),
      channels: obj(Object.fromEntries(CHANNEL_KEYS.map((k) => [k, obj({ enabled: bool, priority: { type: "integer", minimum: 0 } })]))),
      experience: obj({ brand_id: id, theme_id: id, locales: { type: "array", minItems: 1, items: id }, checkout_layout_id: id, home_layout_id: id }),
      operations: obj({
        playbook_id: id,
        support_hours: id,
        support_channels: ids,
        sla_promises: { type: "object", additionalProperties: { type: "number" } },
        confirmation_model: enumOf(CONFIRMATION_MODELS),
        business_models: { type: "array", minItems: 1, items: enumOf(BUSINESS_MODELS) },
        delivery_fee_formula_id: id,
        support_refund_limit: { type: "array", items: obj({ currency: ccy, amount: decimal }) },
      }),
      feature_flags: { type: "object", additionalProperties: bool },
      synthetic: bool,
    },
    ["synthetic"],
  ),
} as const;
