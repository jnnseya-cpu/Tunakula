/** Composes the API: services over one database, NestJS on Fastify. */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PaymentConnector } from "@tunakula/ts-contracts";
import { AdminService } from "../app/admin.ts";
import { AuthService, type OtpSender } from "../app/auth.ts";
import { CatalogueService } from "../app/catalogue.ts";
import { CommerceService } from "../app/commerce.ts";
import { ConfigService } from "../app/config.ts";
import { DispatchService } from "../app/dispatch.ts";
import { EtaService } from "../app/eta.ts";
import { PaymentService } from "../app/payments.ts";
import { straightLineRouting, type RoutingProvider } from "../app/routing.ts";
import { TokenService } from "../app/tokens.ts";
import type { Db } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import { PaymentRouter } from "../modules/payments/payment-router.ts";
import { IdempotencyInterceptor, ProblemFilter, TOKENS } from "./common.ts";
import { AdminConfigController, AdminController, AuthController, KitchenController, MeController, RiderController, CatalogueController, OrdersController, PaymentsController, PlatformController, WebhooksController } from "./controllers.ts";

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
}

export async function createApi(deps: ApiDeps): Promise<NestFastifyApplication> {
  const now = deps.now ?? (() => new Date());
  const tokens = new TokenService(deps.tokenSecret, { now });
  const routing = deps.routing ?? straightLineRouting();
  const commerce = new CommerceService(deps.db, deps.registry, routing, now);
  const dispatch = new DispatchService(deps.db, commerce, now);
  const router = new PaymentRouter(deps.connectors, { now });
  const payments = new PaymentService(deps.db, router, new Map(deps.connectors.map((c) => [c.id, c])), commerce);

  @Module({})
  class ApiModule {
    static register(): DynamicModule {
      return {
        module: ApiModule,
        controllers: [AdminConfigController, AdminController, KitchenController, RiderController, MeController, PlatformController, AuthController, CatalogueController, OrdersController, PaymentsController, WebhooksController],
        providers: [
          { provide: TOKENS.db, useValue: deps.db },
          { provide: TOKENS.registry, useValue: deps.registry },
          { provide: TOKENS.tokens, useValue: tokens },
          { provide: TOKENS.auth, useValue: new AuthService(deps.db, deps.otp, tokens, now) },
          { provide: TOKENS.commerce, useValue: commerce },
          { provide: TOKENS.payments, useValue: payments },
          { provide: TOKENS.catalogue, useValue: new CatalogueService(deps.db, deps.registry) },
          { provide: TOKENS.dispatch, useValue: dispatch },
          { provide: TOKENS.eta, useValue: new EtaService(deps.db, deps.registry, routing, now) },
          { provide: TOKENS.config, useValue: new ConfigService(deps.db, deps.registry) },
          { provide: TOKENS.admin, useValue: new AdminService(deps.db, deps.registry, now) },
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
