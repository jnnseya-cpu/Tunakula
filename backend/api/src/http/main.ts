/**
 * API entry point. Configuration comes from the environment (secrets from Secret Manager):
 *   DATABASE_URL            application role (no RLS bypass)
 *   DATABASE_OWNER_URL      migration role; migrations run at boot when set
 *   DATABASE_APP_ROLE       role granted by the migrator (default tunakula_app)
 *   TUNAKULA_TOKEN_SECRET   ≥ 32 characters
 *   TUNAKULA_SANDBOX_PAYMENTS=1   enable the sandbox connector (never in production)
 *   TUNAKULA_DEV_OTP=1      log sign-in codes instead of sending them (development only; there is
 *                           no SMS/WhatsApp MessagingChannel adapter yet, so without it the API refuses to start)
 *   BITRIPAY_SECRET_KEY / BITRIPAY_WEBHOOK_SECRET, KODA_SECRET_KEY / KODA_WEBHOOK_SECRET
 *   TUNAKULA_CONSOLE_ORIGINS  comma-separated browser origins allowed to call the API (the admin console)
 *   PORT (default 8080)
 */
import { BitriPayConnector } from "@tunakula/payment-connector-bitripay";
import { KodaConnector } from "@tunakula/payment-connector-koda";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { ConnectorCapability, PaymentConnector } from "@tunakula/ts-contracts";
import type { OtpSender } from "../app/auth.ts";
import { connect } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { createLogger } from "../platform/logger.ts";
import { loadVersions } from "../persistence/config.ts";
import { createApi } from "./app.ts";

const env = (k: string) => process.env[k];
const required = (k: string) => env(k) ?? (() => { throw new Error(`${k} is required`); })();
const log = createLogger({ service: "api" });

const CD_MOBILE_MONEY: ConnectorCapability = {
  methodType: "MOBILE_MONEY_PUSH", countries: ["CD"], currencies: ["USD", "CDF"], limits: [], flow: "ASYNC",
  refund: "PARTIAL", payout: true, settlement: { currency: "USD", delayDays: 1 }, fees: { percentBps: 150 },
};

const connectors: PaymentConnector[] = [];
if (env("BITRIPAY_SECRET_KEY")) {
  connectors.push(new BitriPayConnector({ apiKey: required("BITRIPAY_SECRET_KEY"), webhookSecret: required("BITRIPAY_WEBHOOK_SECRET"), capabilities: [CD_MOBILE_MONEY] }));
}
if (env("KODA_SECRET_KEY")) {
  connectors.push(new KodaConnector({ apiKey: required("KODA_SECRET_KEY"), webhookSecret: required("KODA_WEBHOOK_SECRET"), capabilities: [{ ...CD_MOBILE_MONEY, methodType: "MOBILE_MONEY_REDIRECT", refund: "NONE", payout: false }] }));
}
if (env("TUNAKULA_SANDBOX_PAYMENTS") === "1") connectors.push(new SandboxConnector({ capabilities: [CD_MOBILE_MONEY] }));

if (env("DATABASE_OWNER_URL")) {
  const applied = await migrate(required("DATABASE_OWNER_URL"), env("DATABASE_APP_ROLE") ?? "tunakula_app");
  log.info("migrations applied", { applied });
}
const db = connect(required("DATABASE_URL"));

// Sign-in codes need the MessagingChannel adapter (SMS/WhatsApp, §7.3). Until it is configured,
// only an explicit development flag lets the API start, and codes then go to the log.
if (env("TUNAKULA_DEV_OTP") !== "1") throw new Error("No MessagingChannel adapter is configured for sign-in codes; set TUNAKULA_DEV_OTP=1 for development");
const otp: OtpSender = {
  async send(phone, code, channel) {
    log.warn("development sign-in code", { channel, phoneSuffix: phone.slice(-4), code });
  },
};
const registry = new CountryConfigRegistry({
  brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
  connectors: connectors.map((c) => ({ id: c.id, certified: true })),
  apiHosts: JSON.parse(env("TUNAKULA_API_HOSTS") ?? '{"europe-west2":"https://eu.api.tunakula.com","africa-south1":"https://af.api.tunakula.com"}'),
});
registry.restore(await db.tx({}, loadVersions));

const app = await createApi({
  db,
  registry,
  connectors,
  tokenSecret: required("TUNAKULA_TOKEN_SECRET"),
  otp,
  corsOrigins: (env("TUNAKULA_CONSOLE_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  onError: (e) => log.error("unhandled", { error: e }),
});
// Other instances publish too: pick up their changes (CFG-002 rollback must reach every instance within a minute).
const refresh = setInterval(() => {
  db.tx({}, loadVersions).then((v) => registry.restore(v)).catch((error) => log.error("config refresh failed", { error }));
}, 30_000);
refresh.unref();

await app.listen({ port: Number(env("PORT") ?? 8080), host: "0.0.0.0" });
log.info("api listening", { port: Number(env("PORT") ?? 8080), connectors: connectors.map((c) => c.id) });
