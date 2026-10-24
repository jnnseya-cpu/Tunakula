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
 *   BITRIPAY_SECRET_KEY / BITRIPAY_WEBHOOK_SECRET, KODA_SECRET_KEY / KODA_WEBHOOK_SECRET,
 *                           STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (card payments)
 *   TUNAKULA_CONSOLE_ORIGINS  comma-separated browser origins allowed to call the API (the admin console, the website)
 *   TUNAKULA_GOOGLE_ROUTES_KEY  Google Routes API key: road distance and live-traffic travel times
 *   TUNAKULA_OSRM_URL       or a self-hosted OSRM server (road distance; congestion profile for time)
 *                           With neither, distances are estimated from straight lines × 1.3.
 *   TUNAKULA_DISPATCH_MS    dispatcher interval in ms (default 5000; 0 turns it off on this instance)
 *   PORT (default 8080)
 */
import { BitriPayConnector } from "@tunakula/payment-connector-bitripay";
import { KodaConnector } from "@tunakula/payment-connector-koda";
import { StripeConnector } from "@tunakula/payment-connector-stripe";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { ConnectorCapability, PaymentConnector } from "@tunakula/ts-contracts";
import type { OtpSender } from "../app/auth.ts";
import { emailSender, messagingSender, otpViaMessaging } from "../app/channels.ts";
import { smtpSender } from "../modules/messaging/smtp.ts";
import { composeSenders, expoPushSender, webPushSender, type VapidConfig } from "../app/push.ts";
import type { ChannelSender } from "../app/comms.ts";
import { fetchSend, type MessagingChannel } from "../modules/messaging/messaging.ts";
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
import type { MerchantPlanService } from "../app/merchant-plans.ts";
import { loadIntegrationConfig } from "../app/integrations.ts";
import { LlmAssistantBrain } from "../modules/assistant/llm-brain.ts";
import { SandboxBrain } from "../modules/assistant/sandbox-brain.ts";
import { LlmMenuWriter } from "../modules/merchant/llm-menu-writer.ts";
import { TemplateMenuWriter } from "../modules/merchant/template-menu-writer.ts";
import { LlmWinBackWriter } from "../modules/growth/llm-win-back-writer.ts";
import { TemplateWinBackWriter } from "../modules/growth/template-win-back-writer.ts";
import { LlmReviewReplyWriter } from "../modules/merchant/llm-review-reply-writer.ts";
import { TemplateReviewReplyWriter } from "../modules/merchant/template-review-reply-writer.ts";
import { LlmRiderBriefWriter } from "../modules/rider/llm-rider-brief-writer.ts";
import { TemplateRiderBriefWriter } from "../modules/rider/template-rider-brief-writer.ts";
import { LlmUpsellWriter } from "../modules/growth/llm-upsell-writer.ts";
import { TemplateUpsellWriter } from "../modules/growth/template-upsell-writer.ts";
import type { AssistantBrain, MenuWriterBrain, WinBackWriter, ReviewReplyWriter, RiderBriefWriter, UpsellWriter } from "@tunakula/ts-contracts";
import { createApi } from "./app.ts";
import { TOKENS } from "./common.ts";

const log = createLogger({ service: "api" });

// Run migrations and connect first, so integration credentials entered from the admin panel are available when
// the providers are built. A real environment variable still wins; otherwise the stored value is used.
if (process.env["DATABASE_OWNER_URL"]) {
  const applied = await migrate(process.env["DATABASE_OWNER_URL"], process.env["DATABASE_APP_ROLE"] ?? "tunakula_app");
  log.info("migrations applied", { applied });
}
const db = connect(process.env["DATABASE_URL"] ?? (() => { throw new Error("DATABASE_URL is required"); })());
const integrationConfig = await loadIntegrationConfig(db);
if (integrationConfig.size) log.info("integration credentials loaded from the admin panel", { keys: integrationConfig.size });

// Each credential resolves to the real environment variable, else the value stored from the admin panel.
const env = (k: string) => process.env[k] ?? integrationConfig.get(k);
const required = (k: string) => env(k) ?? (() => { throw new Error(`${k} is required`); })();

const CD_MOBILE_MONEY: ConnectorCapability = {
  methodType: "MOBILE_MONEY_PUSH", countries: ["CD"], currencies: ["USD", "CDF"], limits: [], flow: "ASYNC",
  refund: "PARTIAL", payout: true, settlement: { currency: "USD", delayDays: 1 }, fees: { percentBps: 150 },
};
const CD_CARD: ConnectorCapability = {
  methodType: "CARD", countries: ["CD"], currencies: ["USD"], limits: [], flow: "ASYNC",
  refund: "PARTIAL", payout: false, settlement: { currency: "USD", delayDays: 2 }, fees: { percentBps: 290, fixed: { currency: "USD", minor: "30" } },
};

// BitriPay carries three method types on the same rail: mobile-money push, a scannable QR, and hosted-checkout card.
const CD_QR: ConnectorCapability = { ...CD_MOBILE_MONEY, methodType: "QR" };
const CD_CARD_BITRIPAY: ConnectorCapability = { ...CD_CARD, payout: false };

const connectors: PaymentConnector[] = [];
if (env("BITRIPAY_SECRET_KEY")) {
  connectors.push(new BitriPayConnector({ apiKey: required("BITRIPAY_SECRET_KEY"), webhookSecret: required("BITRIPAY_WEBHOOK_SECRET"), capabilities: [CD_MOBILE_MONEY, CD_QR, CD_CARD_BITRIPAY] }));
}
if (env("KODA_SECRET_KEY")) {
  connectors.push(new KodaConnector({ apiKey: required("KODA_SECRET_KEY"), webhookSecret: required("KODA_WEBHOOK_SECRET"), capabilities: [{ ...CD_MOBILE_MONEY, methodType: "MOBILE_MONEY_REDIRECT", refund: "NONE", payout: false }] }));
}
if (env("STRIPE_SECRET_KEY")) {
  connectors.push(new StripeConnector({ apiKey: required("STRIPE_SECRET_KEY"), webhookSecret: required("STRIPE_WEBHOOK_SECRET"), capabilities: [CD_CARD] }));
}
if (env("TUNAKULA_SANDBOX_PAYMENTS") === "1") connectors.push(new SandboxConnector({ capabilities: [CD_MOBILE_MONEY] }));

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
// Web Push (VAPID): when keys are set, customers can enable push and the comms push channel delivers to their devices.
const vapid: VapidConfig | undefined = env("TUNAKULA_VAPID_PUBLIC_KEY")
  ? { publicKey: required("TUNAKULA_VAPID_PUBLIC_KEY"), privateKey: required("TUNAKULA_VAPID_PRIVATE_KEY"), subject: env("TUNAKULA_VAPID_SUBJECT") ?? "mailto:info@tunakula.com" }
  : undefined;
const senderParts: ChannelSender[] = [];
if (messaging) senderParts.push(messagingSender(messaging));
if (vapid) senderParts.push(webPushSender(db, vapid));
// Native push (Expo) is always on: it needs no Apple/FCM credentials — Expo fans out behind the token.
// An access token only raises production rate limits. It handles the `push` channel for native devices;
// a user with no registered device yields "logged", so web push (above) still gets its turn.
senderParts.push(expoPushSender(db, fetchSend(), env("TUNAKULA_EXPO_ACCESS_TOKEN")));
// Email channel over SMTP, when configured (host + from). Secure=1 for implicit TLS (465); otherwise
// STARTTLS is used opportunistically on 587/25. Without it, the email channel logs like SMS without Twilio.
if (env("TUNAKULA_SMTP_HOST") && env("TUNAKULA_SMTP_FROM")) {
  senderParts.push(emailSender(smtpSender({
    host: required("TUNAKULA_SMTP_HOST"),
    port: Number(env("TUNAKULA_SMTP_PORT") ?? 587),
    secure: env("TUNAKULA_SMTP_SECURE") === "1",
    from: required("TUNAKULA_SMTP_FROM"),
    ...(env("TUNAKULA_SMTP_USER") ? { user: required("TUNAKULA_SMTP_USER") } : {}),
    ...(env("TUNAKULA_SMTP_PASS") ? { pass: required("TUNAKULA_SMTP_PASS") } : {}),
  })));
  log.info("email configured", { host: env("TUNAKULA_SMTP_HOST") });
}
const senders: ChannelSender | undefined = senderParts.length ? composeSenders(...senderParts) : undefined;
if (vapid) log.info("web push configured", {});
const registry = new CountryConfigRegistry({
  brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
  connectors: connectors.map((c) => ({ id: c.id, certified: true })),
  apiHosts: JSON.parse(env("TUNAKULA_API_HOSTS") ?? '{"europe-west2":"https://eu.api.tunakula.com","africa-south1":"https://af.api.tunakula.com"}'),
});
registry.restore(await db.tx({}, loadVersions));

// AI customer-service assistant: when a hosted-model key is configured (env var or the admin Integrations panel),
// the LLM brain answers, grounded on the customer's own order and the policies, with the in-house deterministic
// brain as the automatic fallback on any error. With no key, the deterministic brain runs on its own.
let assistantBrain: AssistantBrain | undefined;
let menuWriterBrain: MenuWriterBrain | undefined;
let winBackWriter: WinBackWriter | undefined;
let reviewReplyWriter: ReviewReplyWriter | undefined;
let riderBriefWriter: RiderBriefWriter | undefined;
let upsellWriter: UpsellWriter | undefined;
const assistantKey = env("TUNAKULA_ASSISTANT_API_KEY");
const assistantProvider = (env("TUNAKULA_ASSISTANT_PROVIDER") ?? "anthropic").toLowerCase();
if (assistantKey && assistantProvider === "anthropic") {
  const model = env("TUNAKULA_ASSISTANT_MODEL") ?? "claude-opus-5-5";
  assistantBrain = new LlmAssistantBrain({ apiKey: assistantKey, model }, new SandboxBrain());
  // The same key powers the merchant copilot's AI dish writer (draft / translate), with the template fallback.
  menuWriterBrain = new LlmMenuWriter({ apiKey: assistantKey, model }, new TemplateMenuWriter());
  // …and the growth agent's win-back copywriter, which personalises re-engagement messages, template fallback.
  winBackWriter = new LlmWinBackWriter({ apiKey: assistantKey, model }, new TemplateWinBackWriter());
  // …and the merchant copilot's review-reply drafter, which writes a reply to a customer review, template fallback.
  reviewReplyWriter = new LlmReviewReplyWriter({ apiKey: assistantKey, model }, new TemplateReviewReplyWriter());
  // …and the rider copilot's shift-outlook briefing, phrased from the rider's own grounded facts, template fallback.
  riderBriefWriter = new LlmRiderBriefWriter({ apiKey: assistantKey, model }, new TemplateRiderBriefWriter());
  // …and the storefront upsell line, pitching one complementary dish the service chose, template fallback.
  upsellWriter = new LlmUpsellWriter({ apiKey: assistantKey, model }, new TemplateUpsellWriter());
  log.info("AI assistant, menu, win-back, review-reply, rider-brief and upsell writers: hosted model enabled", { model });
}

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
  ...(vapid ? { vapid } : {}),
  ...(assistantBrain ? { assistantBrain } : {}),
  ...(menuWriterBrain ? { menuWriterBrain } : {}),
  ...(winBackWriter ? { winBackWriter } : {}),
  ...(reviewReplyWriter ? { reviewReplyWriter } : {}),
  ...(riderBriefWriter ? { riderBriefWriter } : {}),
  ...(upsellWriter ? { upsellWriter } : {}),
  routing,
  corsOrigins: (env("TUNAKULA_CONSOLE_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  ...(env("TUNAKULA_TRUST_PROXY") === "1" ? { trustProxy: true } : {}),
  ...(Number(env("TUNAKULA_RATE_LIMIT_RPM") ?? 0) > 0 ? { rateLimit: { rpm: Number(env("TUNAKULA_RATE_LIMIT_RPM")) } } : {}),
  authOtpPerIp: Number(env("TUNAKULA_OTP_PER_IP") ?? 20),
  ...(env("TUNAKULA_METRICS") === "1" ? { metrics: { ...(env("TUNAKULA_METRICS_TOKEN") ? { token: required("TUNAKULA_METRICS_TOKEN") } : {}) } } : {}),
  onError: (e) => log.error("unhandled", { error: e }),
});
// Other instances publish too: pick up their changes (CFG-002 rollback must reach every instance within a minute).
const refresh = setInterval(() => {
  db.tx({}, loadVersions).then((v) => registry.restore(v)).catch((error) => log.error("config refresh failed", { error }));
}, 30_000);
refresh.unref();

// Operations loop: offers waiting orders to riders, expires stale offers, cancels orders no kitchen answered, refunds.
let loop: ReturnType<typeof setInterval> | undefined;
const dispatchMs = Number(env("TUNAKULA_DISPATCH_MS") ?? 5000);
if (dispatchMs > 0) {
  const dispatcher = app.get<DispatchService>(TOKENS.dispatch);
  const payments = app.get<PaymentService>(TOKENS.payments);
  const wallet = app.get<WalletService>(TOKENS.wallet);
  const referrals = app.get<ReferralService>(TOKENS.referrals);
  const loyalty = app.get<LoyaltyService>(TOKENS.loyalty);
  const cashback = app.get<CashbackService>(TOKENS.cashback);
  const subscriptions = app.get<SubscriptionService>(TOKENS.subscriptions);
  const merchantPlans = app.get<MerchantPlanService>(TOKENS.merchantPlans);
  let running = false;
  loop = setInterval(async () => {
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
        // Merchants on a paid plan are billed this month's fee (netted from their payout).
        const planBills = await merchantPlans.billSweep(c.iso2);
        if (planBills.billed) log.info("merchant plans", { country: c.iso2, ...planBills });
      }
    } catch (error) { log.error("dispatch failed", { error }); } finally { running = false; }
  }, dispatchMs);
  loop.unref();
}

await app.listen({ port: Number(env("PORT") ?? 8080), host: "0.0.0.0" });
log.info("api listening", { port: Number(env("PORT") ?? 8080), connectors: connectors.map((c) => c.id) });

// Graceful shutdown: on a rolling deploy or scale-down the orchestrator sends SIGTERM. Stop the background
// sweeps, then let Nest/Fastify drain in-flight requests before the process exits, so no request is cut off.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    clearInterval(refresh);
    if (loop) clearInterval(loop);
    const timer = setTimeout(() => { log.error("shutdown timed out; forcing exit", {}); process.exit(1); }, 25_000);
    timer.unref();
    app.close().then(() => { log.info("shutdown complete", {}); process.exit(0); }).catch((error) => { log.error("shutdown error", { error }); process.exit(1); });
  });
}
