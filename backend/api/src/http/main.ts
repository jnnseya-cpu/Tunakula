/**
 * API entry point. Configuration comes from the environment (secrets from Secret Manager):
 *   DATABASE_URL            application role (no RLS bypass)
 *   DATABASE_OWNER_URL      migration role; migrations run at boot when set
 *   DATABASE_APP_ROLE       role granted by the migrator (default tunakula_app)
 *   TUNAKULA_TOKEN_SECRET   ≥ 32 characters
 *   TUNAKULA_SANDBOX_PAYMENTS=1   enable the sandbox connector (never in production)
 *   TUNAKULA_MESSAGING_PROVIDER=twilio   the SMS/WhatsApp MessagingChannel adapter (sign-in codes and
 *                           the comms dispatch engine). Needs TUNAKULA_TWILIO_ACCOUNT_SID,
 *                           TUNAKULA_TWILIO_AUTH_TOKEN, and TUNAKULA_TWILIO_SMS_FROM and/or
 *                           TUNAKULA_TWILIO_WHATSAPP_FROM (E.164 sender numbers).
 *   TUNAKULA_DEV_OTP=1      log sign-in codes instead of sending them (development only; used when no
 *                           messaging provider is configured, else the API refuses to start)
 *   BITRIPAY_SECRET_KEY / BITRIPAY_WEBHOOK_SECRET, KODA_SECRET_KEY / KODA_WEBHOOK_SECRET
 *   TUNAKULA_CONSOLE_ORIGINS  comma-separated browser origins allowed to call the API (the admin console, the website)
 *   TUNAKULA_GOOGLE_ROUTES_KEY  Google Routes API key: road distance and live-traffic travel times
 *   TUNAKULA_OSRM_URL       or a self-hosted OSRM server (road distance; congestion profile for time)
 *                           With neither, distances are estimated from straight lines × 1.3.
 *   TUNAKULA_DISPATCH_MS    dispatcher interval in ms (default 5000; 0 turns it off on this instance)
 *   PORT (default 8080)
 */
import { BitriPayConnector } from "@tunakula/payment-connector-bitripay";
import { KodaConnector } from "@tunakula/payment-connector-koda";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { ConnectorCapability, PaymentConnector } from "@tunakula/ts-contracts";
import type { OtpSender } from "../app/auth.ts";
import { messagingSender, otpViaMessaging } from "../app/channels.ts";
import type { ChannelSender } from "../app/comms.ts";
import type { MessagingChannel } from "../modules/messaging/messaging.ts";
import { twilioMessaging } from "../modules/messaging/twilio.ts";
import { connect } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../modules/config/brand.ts";
import { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { createLogger } from "../platform/logger.ts";
import { loadVersions } from "../persistence/config.ts";
import { cachedRouting, googleRoutesRouting, osrmRouting, straightLineRouting, withFallback } from "../app/routing.ts";
import type { DispatchService } from "../app/dispatch.ts";
import type { PaymentService } from "../app/payments.ts";
import type { WalletService } from "../app/wallet.ts";
import type { ReferralService } from "../app/referrals.ts";
import type { LoyaltyService } from "../app/loyalty.ts";
import type { CashbackService } from "../app/cashback.ts";
import type { SubscriptionService } from "../app/subscriptions.ts";
import { createApi } from "./app.ts";
import { TOKENS } from "./common.ts";

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

// The MessagingChannel adapter (SMS/WhatsApp, §7.3) serves both sign-in codes and the communication
// dispatch engine. Configure a provider for production; without one, the dev flag logs codes instead.
let messaging: MessagingChannel | undefined;
if (env("TUNAKULA_MESSAGING_PROVIDER") === "twilio") {
  messaging = twilioMessaging({
    accountSid: required("TUNAKULA_TWILIO_ACCOUNT_SID"),
    authToken: required("TUNAKULA_TWILIO_AUTH_TOKEN"),
    ...(env("TUNAKULA_TWILIO_SMS_FROM") ? { smsFrom: required("TUNAKULA_TWILIO_SMS_FROM") } : {}),
    ...(env("TUNAKULA_TWILIO_WHATSAPP_FROM") ? { whatsappFrom: required("TUNAKULA_TWILIO_WHATSAPP_FROM") } : {}),
  });
  log.info("messaging provider configured", { provider: "twilio", sms: Boolean(env("TUNAKULA_TWILIO_SMS_FROM")), whatsapp: Boolean(env("TUNAKULA_TWILIO_WHATSAPP_FROM")) });
}
if (!messaging && env("TUNAKULA_DEV_OTP") !== "1") throw new Error("No MessagingChannel adapter is configured; set TUNAKULA_MESSAGING_PROVIDER=twilio (with its keys) for production, or TUNAKULA_DEV_OTP=1 for development");
const otp: OtpSender = messaging
  ? otpViaMessaging(messaging)
  : { async send(phone, code, channel) { log.warn("development sign-in code", { channel, phoneSuffix: phone.slice(-4), code }); } };
const senders: ChannelSender | undefined = messaging ? messagingSender(messaging) : undefined;
const registry = new CountryConfigRegistry({
  brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
  connectors: connectors.map((c) => ({ id: c.id, certified: true })),
  apiHosts: JSON.parse(env("TUNAKULA_API_HOSTS") ?? '{"europe-west2":"https://eu.api.tunakula.com","africa-south1":"https://af.api.tunakula.com"}'),
});
registry.restore(await db.tx({}, loadVersions));

// Map provider for distances and travel times; any outage falls back to the estimate, never to an error.
const estimate = straightLineRouting();
const onRoutingError = (error: unknown) => log.warn("routing provider failed; using estimate", { error });
const routing = cachedRouting(
  env("TUNAKULA_GOOGLE_ROUTES_KEY") ? withFallback(googleRoutesRouting({ apiKey: required("TUNAKULA_GOOGLE_ROUTES_KEY") }), estimate, onRoutingError)
  : env("TUNAKULA_OSRM_URL") ? withFallback(osrmRouting({ baseUrl: required("TUNAKULA_OSRM_URL") }), estimate, onRoutingError)
  : estimate,
);

const app = await createApi({
  db,
  registry,
  connectors,
  tokenSecret: required("TUNAKULA_TOKEN_SECRET"),
  otp,
  ...(senders ? { senders } : {}),
  routing,
  corsOrigins: (env("TUNAKULA_CONSOLE_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  onError: (e) => log.error("unhandled", { error: e }),
});
// Other instances publish too: pick up their changes (CFG-002 rollback must reach every instance within a minute).
const refresh = setInterval(() => {
  db.tx({}, loadVersions).then((v) => registry.restore(v)).catch((error) => log.error("config refresh failed", { error }));
}, 30_000);
refresh.unref();

// Operations loop: offers waiting orders to riders, expires stale offers, cancels orders no kitchen answered, refunds.
const dispatchMs = Number(env("TUNAKULA_DISPATCH_MS") ?? 5000);
if (dispatchMs > 0) {
  const dispatcher = app.get<DispatchService>(TOKENS.dispatch);
  const payments = app.get<PaymentService>(TOKENS.payments);
  const wallet = app.get<WalletService>(TOKENS.wallet);
  const referrals = app.get<ReferralService>(TOKENS.referrals);
  const loyalty = app.get<LoyaltyService>(TOKENS.loyalty);
  const cashback = app.get<CashbackService>(TOKENS.cashback);
  const subscriptions = app.get<SubscriptionService>(TOKENS.subscriptions);
  let running = false;
  const loop = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const c of registry.countries()) {
        if (!registry.published(c.iso2)) continue;
        const r = await dispatcher.tick(c.iso2);
        if (r.offered || r.cancelled) log.info("dispatch", { country: c.iso2, ...r });
        // Paid orders that ended before delivery get their money back automatically.
        const refunds = await payments.refundSweep(c.iso2);
        if (refunds.refunded || refunds.failed) log.info("refunds", { country: c.iso2, ...refunds });
        // Wallet-funded orders that ended before delivery are credited back to the wallet.
        const walletRefunds = await wallet.refundSweep(c.iso2);
        if (walletRefunds.refunded) log.info("wallet refunds", { country: c.iso2, ...walletRefunds });
        // Referral rewards unlock once the referee has spent the threshold.
        const unlocked = await referrals.unlockSweep(c.iso2);
        if (unlocked.unlocked) log.info("referrals", { country: c.iso2, ...unlocked });
        // Delivered orders earn loyalty points.
        const loyaltyAwards = await loyalty.awardSweep(c.iso2);
        if (loyaltyAwards.awarded) log.info("loyalty", { country: c.iso2, ...loyaltyAwards });
        // Delivered orders placed during a cashback campaign are credited back to the wallet.
        const cashbackAwards = await cashback.awardSweep(c.iso2);
        if (cashbackAwards.awarded) log.info("cashback", { country: c.iso2, ...cashbackAwards });
        // Recurring (subscription) orders due now are placed from the wallet.
        const subRuns = await subscriptions.runSweep(c.iso2);
        if (subRuns.placed || subRuns.skipped) log.info("subscriptions", { country: c.iso2, ...subRuns });
      }
    } catch (error) { log.error("dispatch failed", { error }); } finally { running = false; }
  }, dispatchMs);
  loop.unref();
}

await app.listen({ port: Number(env("PORT") ?? 8080), host: "0.0.0.0" });
log.info("api listening", { port: Number(env("PORT") ?? 8080), connectors: connectors.map((c) => c.id) });
