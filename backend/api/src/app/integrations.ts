/**
 * Integration credentials, managed from the admin panel. Ops enter the payment-rail keys, the messaging provider,
 * Web Push and the maps key here instead of only as environment variables; the API reads them at start-up (a real
 * environment variable, where set, still wins). The panel shows whether each key is set — never its value — and
 * only this service ever reads the values, to build the providers at boot.
 */
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { authorize, type Principal } from "../modules/identity/policy.ts";
import type { Action } from "../modules/identity/roles.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden } from "./errors.ts";

export interface IntegrationField { readonly envKey: string; readonly label: string; readonly required: boolean; readonly secret: boolean }
export interface IntegrationDef { readonly id: string; readonly name: string; readonly description: string; readonly fields: readonly IntegrationField[] }

/** The catalogue of integrations the panel can configure. `envKey` matches the environment variable the API reads. */
export const INTEGRATIONS: readonly IntegrationDef[] = [
  { id: "bitripay", name: "BitriPay", description: "Mobile money, QR and hosted-checkout card.", fields: [
    { envKey: "BITRIPAY_SECRET_KEY", label: "Secret key (sk_…)", required: true, secret: true },
    { envKey: "BITRIPAY_WEBHOOK_SECRET", label: "Webhook secret (whsec_…)", required: true, secret: true },
  ] },
  { id: "koda", name: "KODA", description: "Mobile money, verified by operator SMS.", fields: [
    { envKey: "KODA_SECRET_KEY", label: "Secret key (sk_…)", required: true, secret: true },
    { envKey: "KODA_WEBHOOK_SECRET", label: "Webhook secret", required: true, secret: true },
  ] },
  { id: "stripe", name: "Stripe", description: "Card payments with 3-D Secure.", fields: [
    { envKey: "STRIPE_SECRET_KEY", label: "Secret key (sk_…)", required: true, secret: true },
    { envKey: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret (whsec_…)", required: true, secret: true },
  ] },
  { id: "twilio", name: "Twilio (SMS / WhatsApp)", description: "Sign-in codes and customer notifications.", fields: [
    { envKey: "TUNAKULA_TWILIO_ACCOUNT_SID", label: "Account SID", required: true, secret: false },
    { envKey: "TUNAKULA_TWILIO_AUTH_TOKEN", label: "Auth token", required: true, secret: true },
    { envKey: "TUNAKULA_TWILIO_SMS_FROM", label: "SMS sender (+243…)", required: false, secret: false },
    { envKey: "TUNAKULA_TWILIO_WHATSAPP_FROM", label: "WhatsApp sender", required: false, secret: false },
  ] },
  { id: "push", name: "Web Push (VAPID)", description: "Order updates pushed to the customer's device.", fields: [
    { envKey: "TUNAKULA_VAPID_PUBLIC_KEY", label: "Public key", required: true, secret: false },
    { envKey: "TUNAKULA_VAPID_PRIVATE_KEY", label: "Private key", required: true, secret: true },
    { envKey: "TUNAKULA_VAPID_SUBJECT", label: "Subject (mailto:…)", required: false, secret: false },
  ] },
  { id: "maps", name: "Maps / routing", description: "Road distances and delivery times.", fields: [
    { envKey: "TUNAKULA_GOOGLE_ROUTES_KEY", label: "Google Routes API key", required: false, secret: true },
    { envKey: "TUNAKULA_OSRM_URL", label: "or self-hosted OSRM URL", required: false, secret: false },
  ] },
  { id: "ai", name: "AI assistant (LLM)", description: "Optional hosted model for the customer-service assistant. With no key the built-in grounded assistant runs.", fields: [
    { envKey: "TUNAKULA_ASSISTANT_PROVIDER", label: "Provider (e.g. anthropic)", required: false, secret: false },
    { envKey: "TUNAKULA_ASSISTANT_API_KEY", label: "API key", required: false, secret: true },
    { envKey: "TUNAKULA_ASSISTANT_MODEL", label: "Model id", required: false, secret: false },
  ] },
];
const FIELD_BY_KEY = new Map(INTEGRATIONS.flatMap((i) => i.fields.map((f) => [f.envKey, f] as const)));

export class IntegrationsService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;

  constructor(db: Db, registry: CountryConfigRegistry) {
    this.db = db;
    this.registry = registry;
  }

  #assertOps(principal: Principal, country: string) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    const actions: Action[] = ["country_config:write"];
    if (!actions.some((a) => authorize(principal, a, { type: "order", country }, { activeCountry: country, profile: v.profile }).allowed)) throw forbidden("Integrations are managed by a market admin");
  }

  /** The catalogue plus, per field, whether a value is set — in the DB or the environment. Never the value itself. */
  async status(country: string, principal: Principal) {
    this.#assertOps(principal, country);
    const stored = await this.db.tx({ country }, (sql) => readKeys(sql));
    const integrations = INTEGRATIONS.map((def) => {
      const fields = def.fields.map((f) => {
        const inDb = stored.has(f.envKey);
        const inEnv = !inDb && !!process.env[f.envKey];
        return { env_key: f.envKey, label: f.label, required: f.required, secret: f.secret, set: inDb || inEnv, source: inDb ? "panel" : inEnv ? "env" : null };
      });
      const configured = def.fields.filter((f) => f.required).every((f) => fields.find((x) => x.env_key === f.envKey)?.set);
      return { id: def.id, name: def.name, description: def.description, configured, fields };
    });
    return { integrations };
  }

  /** Upsert the values for one integration's fields. Blank clears a stored value (falling back to the environment). */
  async set(country: string, principal: Principal, id: string, values: Record<string, unknown>) {
    this.#assertOps(principal, country);
    const def = INTEGRATIONS.find((i) => i.id === id);
    if (!def) throw badRequest("UNKNOWN_INTEGRATION", "No such integration");
    await this.db.tx({ country }, async (sql) => {
      for (const f of def.fields) {
        if (!(f.envKey in values)) continue;
        const raw = String(values[f.envKey] ?? "").trim();
        if (!raw) { await sql.query("DELETE FROM platform.integration WHERE env_key = $1", [f.envKey]); continue; }
        await sql.query(
          "INSERT INTO platform.integration (env_key, value, set_by, set_at) VALUES ($1,$2,$3, now()) ON CONFLICT (env_key) DO UPDATE SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, set_at = now()",
          [f.envKey, raw.slice(0, 2000), principal.userId],
        );
      }
      await audit(sql, { actor: principal.userId, action: "integration.set", target: `integration:${id}`, country, detail: { keys: def.fields.filter((f) => f.envKey in values).map((f) => f.envKey) } });
    });
    return this.status(country, principal);
  }
}

async function readKeys(sql: Sql): Promise<Set<string>> {
  const rows = await sql.query<{ env_key: string } & Record<string, unknown>>("SELECT env_key FROM platform.integration");
  return new Set(rows.map((r) => r.env_key).filter((k) => FIELD_BY_KEY.has(k)));
}

/**
 * Reads every stored integration value for the start-up wiring. Used by main.ts to resolve each credential as
 * (real environment variable, else stored value). Returns a plain map of env-key → value.
 */
export async function loadIntegrationConfig(db: Db): Promise<Map<string, string>> {
  return db.tx({}, async (sql) => {
    const rows = await sql.query<{ env_key: string; value: string } & Record<string, unknown>>("SELECT env_key, value FROM platform.integration");
    return new Map(rows.map((r) => [r.env_key, r.value] as const));
  });
}
