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
import { SubscriptionService } from "../app/subscriptions.ts";
import { PosService } from "../app/pos.ts";
import { MerchantPlanService } from "../app/merchant-plans.ts";
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
import { AdminConfigController, AdminController, AuthController, AddressController, FavouriteController, CommsController, CouponController, GroupController, KitchenController, MeController, MembershipController, NotificationsController, OnboardingController, OpsController, RefundController, ReferralController, LoyaltyController, CashbackController, ChatController, BannerController, SubscriptionController, PosController, ReservationController, ReviewController, RiderController, WalletController, MerchantOnboardingController, CatalogueController, OrdersController, PaymentsController, PlatformController, WebhooksController } from "./controllers.ts";

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
  /** Channel adapters for notifications. Defaults to the sandbox sender (records, never sends). */
  readonly senders?: ChannelSender;
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
  const reviews = new ReviewService(deps.db, deps.registry, now);
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
  const subscriptions = new SubscriptionService(deps.db, deps.registry, commerce, now);
  const pos = new PosService(deps.db, deps.registry, commerce, now);
  const merchantPlans = new MerchantPlanService(deps.db, deps.registry, now);
  const merchantOnboarding = new MerchantOnboardingService(deps.db, deps.registry);
  const onboarding = new OnboardingService(deps.db, commerce, now, comms);

  @Module({})
  class ApiModule {
    static register(): DynamicModule {
      return {
        module: ApiModule,
        controllers: [AddressController, FavouriteController, AdminConfigController, AdminController, KitchenController, OpsController, OnboardingController, RiderController, MeController, MembershipController, GroupController, CouponController, ReviewController, ReservationController, RefundController, WalletController, ReferralController, LoyaltyController, CashbackController, ChatController, BannerController, SubscriptionController, PosController, MerchantOnboardingController, PlatformController, AuthController, CatalogueController, OrdersController, PaymentsController, WebhooksController, NotificationsController, CommsController],
        providers: [
          { provide: TOKENS.db, useValue: deps.db },
          { provide: TOKENS.registry, useValue: deps.registry },
          { provide: TOKENS.tokens, useValue: tokens },
          { provide: TOKENS.auth, useValue: new AuthService(deps.db, deps.otp, tokens, now) },
          { provide: TOKENS.commerce, useValue: commerce },
          { provide: TOKENS.payments, useValue: payments },
          { provide: TOKENS.catalogue, useValue: new CatalogueService(deps.db, deps.registry) },
          { provide: TOKENS.dispatch, useValue: dispatch },
          { provide: TOKENS.onboarding, useValue: onboarding },
          { provide: TOKENS.comms, useValue: comms },
          { provide: TOKENS.eta, useValue: new EtaService(deps.db, deps.registry, routing, now) },
          { provide: TOKENS.config, useValue: new ConfigService(deps.db, deps.registry) },
          { provide: TOKENS.admin, useValue: new AdminService(deps.db, deps.registry, now) },
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
          { provide: TOKENS.subscriptions, useValue: subscriptions },
          { provide: TOKENS.pos, useValue: pos },
          { provide: TOKENS.merchantPlans, useValue: merchantPlans },
          { provide: TOKENS.onboardingMerchant, useValue: merchantOnboarding },
        ],
      };
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.register(), new FastifyAdapter({ bodyLimit: 1_048_576 }), { logger: false, rawBody: true });
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
