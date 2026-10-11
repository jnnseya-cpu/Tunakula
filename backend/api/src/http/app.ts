/** Composes the API: services over one database, NestJS on Fastify. */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PaymentConnector } from "@tunakula/ts-contracts";
import { AdminService } from "../app/admin.ts";
import { AuthService, type OtpSender } from "../app/auth.ts";
import { NotificationService, sandboxSender, type ChannelSender } from "../app/comms.ts";
import { CatalogueService } from "../app/catalogue.ts";
import { CommerceService } from "../app/commerce.ts";
import { ConfigService } from "../app/config.ts";
import { DispatchService } from "../app/dispatch.ts";
import { EtaService } from "../app/eta.ts";
import { CouponService } from "../app/coupons.ts";
import { ReviewService } from "../app/reviews.ts";
import { AddressService } from "../app/addresses.ts";
import { ReservationService } from "../app/reservations.ts";
import { RefundService } from "../app/refunds.ts";
import { WalletService } from "../app/wallet.ts";
import { ReferralService } from "../app/referrals.ts";
import { LoyaltyService } from "../app/loyalty.ts";
import { CashbackService } from "../app/cashback.ts";
import { ChatService } from "../app/chat.ts";
import { BannerService } from "../app/banners.ts";
import { SiteContentService } from "../app/site-content.ts";
import { ChefService } from "../app/chef.ts";
import { AssistantService } from "../app/assistant.ts";
import { SandboxBrain } from "../modules/assistant/sandbox-brain.ts";
import { GrowthService } from "../app/growth.ts";
import { SandboxGrowthBrain } from "../modules/growth/sandbox-growth-brain.ts";
import { TemplateWinBackWriter } from "../modules/growth/template-win-back-writer.ts";
import { TemplateReviewReplyWriter } from "../modules/merchant/template-review-reply-writer.ts";
import { MerchantCopilotService } from "../app/merchant-copilot.ts";
import { SandboxMerchantBrain } from "../modules/merchant/sandbox-merchant-brain.ts";
import { MenuWriterService } from "../app/menu-writer.ts";
import { TemplateMenuWriter } from "../modules/merchant/template-menu-writer.ts";
import { UpsellService } from "../app/upsell.ts";
import { TemplateUpsellWriter } from "../modules/growth/template-upsell-writer.ts";
import { RiderCopilotService } from "../app/rider-copilot.ts";
import { SandboxRiderBrain } from "../modules/rider/sandbox-rider-brain.ts";
import { TemplateRiderBriefWriter } from "../modules/rider/template-rider-brief-writer.ts";
import type { AssistantBrain, GrowthBrain, MerchantBrain, RiderBrain, MenuWriterBrain, WinBackWriter, ReviewReplyWriter, RiderBriefWriter, UpsellWriter } from "@tunakula/ts-contracts";
import { IntegrationsService } from "../app/integrations.ts";
import { SubscriptionService } from "../app/subscriptions.ts";
import { PosService } from "../app/pos.ts";
import { KioskService } from "../app/kiosk.ts";
import { MerchantPlanService } from "../app/merchant-plans.ts";
import { PushService, type VapidConfig } from "../app/push.ts";
import { MerchantOnboardingService } from "../app/merchant-onboarding.ts";
import { GroupOrderService } from "../app/group.ts";
import { MembershipService } from "../app/membership.ts";
import { OnboardingService } from "../app/onboarding.ts";
import { PaymentService } from "../app/payments.ts";
import { straightLineRouting, type RoutingProvider } from "../app/routing.ts";
import { TokenService } from "../app/tokens.ts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { PaymentRouter } from "../modules/payments/payment-router.ts";
import { IdempotencyInterceptor, ProblemFilter, TOKENS } from "./common.ts";
import { createMetrics } from "./metrics.ts";
import { AdminConfigController, AdminController, AuthController, AddressController, FavouriteController, CommsController, CouponController, GroupController, KitchenController, MeController, MembershipController, NotificationsController, OnboardingController, OpsController, RefundController, ReferralController, LoyaltyController, CashbackController, ChatController, BannerController, SiteContentController, ChefController, SupportController, GrowthController, MerchantCopilotController, IntegrationsController, SubscriptionController, PosController, KioskController, PushController, ReservationController, ReviewController, RiderController, WalletController, MerchantOnboardingController, CatalogueController, OrdersController, PaymentsController, PlatformController, WebhooksController } from "./controllers.ts";

export interface ApiDeps {
  readonly db: Db;
  readonly registry: CountryConfigRegistry;
  readonly connectors: readonly PaymentConnector[];
  readonly tokenSecret: string;
  readonly otp: OtpSender;
  readonly routing?: RoutingProvider;
  readonly now?: () => Date;
  readonly onError?: (e: unknown) => void;
  /** Browser origins allowed to call the API (the admin console, the website). None by default. */
  readonly corsOrigins?: readonly string[];
  /** Trust the X-Forwarded-* headers from a front proxy / load balancer, so req.ip is the real client. */
  readonly trustProxy?: boolean;
  /** Opt-in per-IP rate limit (requests per minute per instance). Omit or 0 to disable. */
  readonly rateLimit?: { readonly rpm: number };
  /** Opt-in Prometheus metrics at GET /metrics. Provide a token to require `Authorization: Bearer <token>`. */
  readonly metrics?: { readonly token?: string };
  /** Channel adapters for notifications. Defaults to the sandbox sender (records, never sends). */
  readonly senders?: ChannelSender;
  /** VAPID keys for Web Push; when set, customers can enable push and the push channel delivers to their devices. */
  readonly vapid?: VapidConfig;
  /** The AI support assistant brain. Defaults to the in-house deterministic SandboxBrain (no external call). */
  readonly assistantBrain?: AssistantBrain;
  /** The growth agent brain. Defaults to the in-house deterministic SandboxGrowthBrain. */
  readonly growthBrain?: GrowthBrain;
  /** The win-back copywriter. Defaults to the offline TemplateWinBackWriter; a hosted model personalises the copy. */
  readonly winBackWriter?: WinBackWriter;
  /** The review-reply drafter. Defaults to the offline TemplateReviewReplyWriter; a hosted model personalises it. */
  readonly reviewReplyWriter?: ReviewReplyWriter;
  /** The merchant copilot brain. Defaults to the in-house deterministic SandboxMerchantBrain. */
  readonly merchantBrain?: MerchantBrain;
  /** The rider copilot brain. Defaults to the in-house deterministic SandboxRiderBrain. */
  readonly riderBrain?: RiderBrain;
  /** The rider shift-outlook writer. Defaults to the offline TemplateRiderBriefWriter; a hosted model phrases it. */
  readonly riderBriefWriter?: RiderBriefWriter;
  /** The storefront upsell writer. Defaults to the offline TemplateUpsellWriter; a hosted model phrases the pitch. */
  readonly upsellWriter?: UpsellWriter;
  /** The menu writer brain. Defaults to the offline TemplateMenuWriter (describes; can't translate without a model). */
  readonly menuWriterBrain?: MenuWriterBrain;
}

export async function createApi(deps: ApiDeps): Promise<NestFastifyApplication> {
  const now = deps.now ?? (() => new Date());
  const tokens = new TokenService(deps.tokenSecret, { now });
  const routing = deps.routing ?? straightLineRouting();
  const comms = new NotificationService(deps.db, deps.registry, deps.senders ?? sandboxSender, now);
  const commerce = new CommerceService(deps.db, deps.registry, routing, now, comms);
  const membership = new MembershipService(deps.db, deps.registry, now);
  commerce.useMembership(membership);
  const coupons = new CouponService(deps.db, deps.registry, now);
  commerce.useCoupons(coupons);
  const reviews = new ReviewService(deps.db, deps.registry, deps.reviewReplyWriter ?? new TemplateReviewReplyWriter(), now);
  const addresses = new AddressService(deps.db);
  const reservations = new ReservationService(deps.db, deps.registry, now);
  const group = new GroupOrderService(deps.db, deps.registry, commerce, now);
  const dispatch = new DispatchService(deps.db, commerce, now);
  const router = new PaymentRouter(deps.connectors, { now });
  const payments = new PaymentService(deps.db, router, new Map(deps.connectors.map((c) => [c.id, c])), commerce);
  const refunds = new RefundService(deps.db, deps.registry, commerce, payments, now);
  const wallet = new WalletService(deps.db, deps.registry, payments, commerce, now);
  commerce.useWallet(wallet);
  payments.useWallet(wallet);
  const referrals = new ReferralService(deps.db, deps.registry, wallet, now);
  commerce.useReferral(referrals);
  const loyalty = new LoyaltyService(deps.db, deps.registry, wallet, now);
  const cashback = new CashbackService(deps.db, deps.registry, wallet, now);
  const chat = new ChatService(deps.db, now);
  const banners = new BannerService(deps.db, deps.registry, now);
  const siteContent = new SiteContentService(deps.db, deps.registry);
  const chef = new ChefService(deps.db, deps.registry, now);
  const assistant = new AssistantService(deps.db, deps.registry, deps.assistantBrain ?? new SandboxBrain(), now);
  const growth = new GrowthService(deps.db, deps.registry, deps.growthBrain ?? new SandboxGrowthBrain(), wallet, comms, deps.winBackWriter ?? new TemplateWinBackWriter(), now);
  const catalogue = new CatalogueService(deps.db, deps.registry);
  const admin = new AdminService(deps.db, deps.registry, now);
  const merchantCopilot = new MerchantCopilotService(deps.db, deps.registry, deps.merchantBrain ?? new SandboxMerchantBrain(), catalogue, admin);
  const menuWriter = new MenuWriterService(deps.db, deps.registry, catalogue, deps.menuWriterBrain ?? new TemplateMenuWriter());
  const upsell = new UpsellService(catalogue, deps.upsellWriter ?? new TemplateUpsellWriter());
  const riderCopilot = new RiderCopilotService(deps.registry, deps.riderBrain ?? new SandboxRiderBrain(), deps.riderBriefWriter ?? new TemplateRiderBriefWriter(), dispatch, now);
  const integrations = new IntegrationsService(deps.db, deps.registry);
  const subscriptions = new SubscriptionService(deps.db, deps.registry, commerce, now);
  const pos = new PosService(deps.db, deps.registry, commerce, now);
  const kiosk = new KioskService(deps.db, deps.registry, commerce, payments);
  const merchantPlans = new MerchantPlanService(deps.db, deps.registry, now);
  const push = new PushService(deps.db, deps.vapid);
  const merchantOnboarding = new MerchantOnboardingService(deps.db, deps.registry);
  const onboarding = new OnboardingService(deps.db, commerce, now, comms);

  @Module({})
  class ApiModule {
    static register(): DynamicModule {
      return {
        module: ApiModule,
        controllers: [AddressController, FavouriteController, AdminConfigController, AdminController, KitchenController, OpsController, OnboardingController, RiderController, MeController, MembershipController, GroupController, CouponController, ReviewController, ReservationController, RefundController, WalletController, ReferralController, LoyaltyController, CashbackController, ChatController, BannerController, SiteContentController, ChefController, SupportController, GrowthController, MerchantCopilotController, IntegrationsController, SubscriptionController, PosController, KioskController, PushController, MerchantOnboardingController, PlatformController, AuthController, CatalogueController, OrdersController, PaymentsController, WebhooksController, NotificationsController, CommsController],
        providers: [
          { provide: TOKENS.db, useValue: deps.db },
          { provide: TOKENS.registry, useValue: deps.registry },
          { provide: TOKENS.tokens, useValue: tokens },
          { provide: TOKENS.auth, useValue: new AuthService(deps.db, deps.otp, tokens, now) },
          { provide: TOKENS.commerce, useValue: commerce },
          { provide: TOKENS.payments, useValue: payments },
          { provide: TOKENS.catalogue, useValue: catalogue },
          { provide: TOKENS.dispatch, useValue: dispatch },
          { provide: TOKENS.onboarding, useValue: onboarding },
          { provide: TOKENS.comms, useValue: comms },
          { provide: TOKENS.eta, useValue: new EtaService(deps.db, deps.registry, routing, now) },
          { provide: TOKENS.config, useValue: new ConfigService(deps.db, deps.registry) },
          { provide: TOKENS.admin, useValue: admin },
          { provide: TOKENS.membership, useValue: membership },
          { provide: TOKENS.group, useValue: group },
          { provide: TOKENS.coupons, useValue: coupons },
          { provide: TOKENS.reviews, useValue: reviews },
          { provide: TOKENS.addresses, useValue: addresses },
          { provide: TOKENS.reservations, useValue: reservations },
          { provide: TOKENS.refunds, useValue: refunds },
          { provide: TOKENS.wallet, useValue: wallet },
          { provide: TOKENS.referrals, useValue: referrals },
          { provide: TOKENS.loyalty, useValue: loyalty },
          { provide: TOKENS.cashback, useValue: cashback },
          { provide: TOKENS.chat, useValue: chat },
          { provide: TOKENS.banners, useValue: banners },
          { provide: TOKENS.siteContent, useValue: siteContent },
          { provide: TOKENS.chef, useValue: chef },
          { provide: TOKENS.assistant, useValue: assistant },
          { provide: TOKENS.growth, useValue: growth },
          { provide: TOKENS.merchantCopilot, useValue: merchantCopilot },
          { provide: TOKENS.menuWriter, useValue: menuWriter },
          { provide: TOKENS.upsell, useValue: upsell },
          { provide: TOKENS.riderCopilot, useValue: riderCopilot },
          { provide: TOKENS.integrations, useValue: integrations },
          { provide: TOKENS.subscriptions, useValue: subscriptions },
          { provide: TOKENS.pos, useValue: pos },
          { provide: TOKENS.kiosk, useValue: kiosk },
          { provide: TOKENS.merchantPlans, useValue: merchantPlans },
          { provide: TOKENS.push, useValue: push },
          { provide: TOKENS.onboardingMerchant, useValue: merchantOnboarding },
        ],
      };
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule.register(),
    new FastifyAdapter({ bodyLimit: 1_048_576, ...(deps.trustProxy ? { trustProxy: true } : {}) }),
    { logger: false, rawBody: true },
  );

  // Opt-in per-IP rate limit (a baseline abuse control; per-instance, so pair it with a shared limiter at the
  // edge for a fleet). Health and CORS preflight are never limited. Enabled only when a positive rpm is given.
  if (deps.rateLimit && deps.rateLimit.rpm > 0) {
    const rpm = deps.rateLimit.rpm;
    const windowMs = 60_000;
    const hits = new Map<string, number[]>();
    app.getHttpAdapter().getInstance().addHook("onRequest", (req, reply, done) => {
      if (req.method === "OPTIONS" || req.url === "/v1/health") return done();
      const now = Date.now();
      const ip = req.ip || "unknown";
      const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= rpm) {
        void reply.code(429).header("retry-after", "60").type("application/problem+json").send(
          JSON.stringify({ type: "https://www.tunakula.com/problems/rate-limited", title: "RATE_LIMITED", status: 429, detail: "Too many requests; slow down.", code: "RATE_LIMITED" }),
        );
        return;
      }
      recent.push(now);
      hits.set(ip, recent);
      done();
    });
    const prune = setInterval(() => {
      const now = Date.now();
      for (const [ip, arr] of hits) { const keep = arr.filter((t) => now - t < windowMs); if (keep.length) hits.set(ip, keep); else hits.delete(ip); }
    }, windowMs);
    prune.unref();
  }

  // Opt-in Prometheus metrics. An onResponse hook records every request by method + matched route template
  // (bounded cardinality) and status; GET /metrics renders them for a scraper. Restrict it at the edge, or pass
  // a token to require a bearer header. Its own requests are not counted.
  if (deps.metrics) {
    const metrics = createMetrics();
    const token = deps.metrics.token;
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook("onResponse", (req, reply, done) => {
      const route = req.routeOptions?.url ?? "unmatched";
      if (route !== "/metrics") metrics.observe(req.method, route, reply.statusCode, reply.elapsedTime / 1000);
      done();
    });
    fastify.get("/metrics", (req, reply) => {
      if (token && req.headers.authorization !== `Bearer ${token}`) { void reply.code(401).type("text/plain").send("unauthorized\n"); return; }
      void reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8").send(metrics.scrape());
    });
  }

  if (deps.corsOrigins?.length) {
    app.enableCors({
      origin: [...deps.corsOrigins],
      methods: ["GET", "POST", "DELETE", "PATCH", "PUT"],
      allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-country"],
      exposedHeaders: ["idempotent-replay"],
      maxAge: 600,
    });
  }
  app.useGlobalFilters(new ProblemFilter(deps.onError ?? ((e) => console.error(e))));
  app.useGlobalInterceptors(new IdempotencyInterceptor(deps.db, tokens));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
