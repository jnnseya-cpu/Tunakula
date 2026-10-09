/** HTTP plumbing: problem+json errors, request context and idempotency (§25.1). */
import { Catch, HttpException, type ArgumentsHost, type CallHandler, type ExecutionContext, type ExceptionFilter, type NestInterceptor } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Observable, from, lastValueFrom } from "rxjs";
import { ApiError, badRequest, unauthorized } from "../app/errors.ts";
import type { TokenService } from "../app/tokens.ts";
import type { Db } from "../db/db.ts";
import { abandonIdempotent, beginIdempotent, completeIdempotent, requestHash } from "../persistence/idempotency.ts";

export const TOKENS = {
  db: "DB",
  tokens: "TOKENS",
  auth: "AUTH_SERVICE",
  commerce: "COMMERCE_SERVICE",
  payments: "PAYMENT_SERVICE",
  registry: "REGISTRY",
  catalogue: "CATALOGUE_SERVICE",
  eta: "ETA_SERVICE",
  dispatch: "DISPATCH_SERVICE",
  onboarding: "ONBOARDING_SERVICE",
  config: "CONFIG_SERVICE",
  admin: "ADMIN_SERVICE",
  comms: "COMMS_SERVICE",
  membership: "MEMBERSHIP_SERVICE",
  group: "GROUP_SERVICE",
  coupons: "COUPON_SERVICE",
  reviews: "REVIEW_SERVICE",
  addresses: "ADDRESS_SERVICE",
  reservations: "RESERVATION_SERVICE",
  refunds: "REFUND_SERVICE",
  wallet: "WALLET_SERVICE",
  referrals: "REFERRAL_SERVICE",
  loyalty: "LOYALTY_SERVICE",
  cashback: "CASHBACK_SERVICE",
  chat: "CHAT_SERVICE",
  banners: "BANNER_SERVICE",
  subscriptions: "SUBSCRIPTION_SERVICE",
  onboardingMerchant: "MERCHANT_ONBOARDING_SERVICE",
  logger: "LOGGER",
} as const;

export type Req = FastifyRequest & { rawBody?: string | Buffer };

@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(private readonly log: (e: unknown) => void = () => undefined) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    let status = 500;
    let code = "INTERNAL";
    let detail = "Something went wrong on our side. It has been logged.";
    let extra: Record<string, unknown> = {};
    if (exception instanceof ApiError) {
      ({ status, code } = exception);
      detail = exception.message;
      extra = { ...exception.extra };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? "NOT_FOUND" : `HTTP_${status}`;
      detail = exception.message;
    } else if ((exception as { code?: string })?.code === "23514") {
      status = 422;
      code = "CONSTRAINT";
      detail = (exception as Error).message;
    } else {
      this.log(exception);
    }
    void reply
      .status(status)
      .header("content-type", "application/problem+json")
      .send({ type: `https://www.tunakula.com/problems/${code.toLowerCase().replace(/_/g, "-")}`, title: code, status, detail, instance: req.url, code, ...extra });
  }
}

export function userId(req: FastifyRequest, tokens: TokenService): string {
  const header = req.headers["authorization"];
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
  const claims = token ? tokens.verify(token) : undefined;
  if (!claims) throw unauthorized();
  return claims.sub;
}

export function country(req: FastifyRequest): string {
  const c = req.headers["x-country"];
  if (typeof c !== "string" || !/^[A-Z]{2}$/.test(c)) throw badRequest("COUNTRY_REQUIRED", "Send the active market in the X-Country header, e.g. X-Country: CD");
  return c;
}

/** Requires Idempotency-Key on mutating calls; replays return the stored response. */
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Db, private readonly tokens: TokenService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method) || req.url.startsWith("/v1/webhooks/")) return next.handle();
    // Nest applies @HttpCode (default 201 for POST) after interceptors, so read it from the handler to store the real status.
    const status = (Reflect.getMetadata("__httpCode__", ctx.getHandler()) as number | undefined) ?? (req.method === "POST" ? 201 : 200);
    return from(this.#run(req, reply, next, status));
  }

  async #run(req: Req, reply: FastifyReply, next: CallHandler, status: number): Promise<unknown> {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (8–200 characters) on every change");
    let principal = "public";
    try {
      principal = userId(req, this.tokens);
    } catch {
      // Public endpoints (sign-in) are keyed per anonymous caller.
    }
    const path = req.url.split("?")[0] as string;
    const outcome = await this.db.tx({}, (sql) => beginIdempotent(sql, principal, key, req.method, path, requestHash(req.method, path, req.body)));
    if (outcome.kind === "MISMATCH") throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different request");
    if (outcome.kind === "IN_PROGRESS") throw new ApiError(409, "REQUEST_IN_PROGRESS", "The original request with this key is still being processed");
    if (outcome.kind === "REPLAY") {
      void reply.header("idempotent-replay", "true");
      return outcome.response;
    }
    try {
      const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.db.tx({}, (sql) => completeIdempotent(sql, principal, key, status, result));
      return result;
    } catch (error) {
      await this.db.tx({}, (sql) => abandonIdempotent(sql, principal, key)).catch(() => undefined);
      throw error;
    }
  }
}

/** Wire format for money (§25.1): minor units as a string so 64-bit amounts stay exact. */
export const wire = (m: { minor: bigint | string; currency: string }) => ({ amount_minor: m.minor.toString(), currency: m.currency });
