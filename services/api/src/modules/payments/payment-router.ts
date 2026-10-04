/**
 * Payment Orchestration routing (PRD §20.4–20.5).
 *
 * Eligibility and ranking come entirely from data — the market's Country
 * Profile and each connector's declared capabilities and measured health —
 * so the core never contains "if country = X".
 */
import { Money } from "@tunakula/ts-money";
import {
  FAILED_STATES,
  ROUTE_FAILURE_REASONS,
  type ConnectorCapability,
  type CountryProfile,
  type InitiateResult,
  type PaymentConnector,
  type PaymentIntent,
  type PaymentMethodType,
  type PaymentReasonCode,
  type PaymentState,
} from "@tunakula/ts-contracts";

export interface Route {
  readonly connector: PaymentConnector;
  readonly capability: ConnectorCapability;
  readonly priority: number;
}

export interface PaymentAttempt {
  readonly connectorId: string;
  readonly idempotencyKey: string;
  readonly state: PaymentState | "NOT_SENT" | "OUTCOME_UNKNOWN";
  readonly providerRef?: string;
  readonly reasonCode?: PaymentReasonCode;
  readonly at: Date;
}

export type PaymentOutcome =
  | { readonly status: "SUCCEEDED" | "PENDING"; readonly result: InitiateResult; readonly connectorId: string; readonly attempts: readonly PaymentAttempt[] }
  /** The payer's side failed — offer another method, do not silently re-route. */
  | { readonly status: "DECLINED"; readonly reasonCode: PaymentReasonCode; readonly attempts: readonly PaymentAttempt[] }
  /** Every eligible route failed for route reasons, or none was eligible. */
  | { readonly status: "NO_ROUTE"; readonly attempts: readonly PaymentAttempt[] }
  /** A provider may have received the request; resolve by status polling before anything else. */
  | { readonly status: "OUTCOME_UNKNOWN"; readonly connectorId: string; readonly attempts: readonly PaymentAttempt[] };

export interface RouterOptions {
  /** Connectors with a rolling success rate below this are skipped. */
  readonly minSuccessRate?: number;
  /** Consecutive route failures that open a connector's circuit. */
  readonly circuitThreshold?: number;
  readonly circuitCooldownMs?: number;
  readonly now?: () => Date;
  /**
   * Distinguishes "never sent" errors (safe to fall back) from ambiguous ones.
   * Defaults to checking for `name === "ConnectorUnavailableError"`.
   */
  readonly isNotSentError?: (error: unknown) => boolean;
}

export class PaymentRouter {
  readonly #connectors = new Map<string, PaymentConnector>();
  readonly #circuit = new Map<string, { failures: number; openedAt?: number }>();
  readonly #minSuccessRate: number;
  readonly #threshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => Date;
  readonly #isNotSent: (error: unknown) => boolean;

  constructor(connectors: readonly PaymentConnector[], options: RouterOptions = {}) {
    for (const c of connectors) {
      if (this.#connectors.has(c.id)) throw new Error(`Duplicate connector id ${c.id}`);
      this.#connectors.set(c.id, c);
    }
    this.#minSuccessRate = options.minSuccessRate ?? 0.5;
    this.#threshold = options.circuitThreshold ?? 5;
    this.#cooldownMs = options.circuitCooldownMs ?? 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#isNotSent = options.isNotSentError ?? ((e) => e instanceof Error && e.name === "ConnectorUnavailableError");
  }

  /**
   * Methods to show at checkout, in Country Profile rank order (§20.5).
   * Methods with no eligible route are hidden rather than shown as errors.
   */
  presentableMethods(profile: CountryProfile, intent: Omit<PaymentIntent, "methodType">): PaymentMethodType[] {
    return [...profile.payments.methods]
      .sort((a, b) => a.rank - b.rank)
      .map((m) => m.type)
      .filter((methodType) => this.eligibleRoutes(profile, { ...intent, methodType }).length > 0);
  }

  /** Eligible routes, best first (§20.4 eligibility + ranking). */
  eligibleRoutes(profile: CountryProfile, intent: PaymentIntent): Route[] {
    if (profile.country.iso2 !== intent.marketCountry) {
      throw new Error(`Profile ${profile.country.iso2} does not govern market ${intent.marketCountry}`);
    }
    const amount = Money.fromJSON(intent.amount);
    const method = profile.payments.methods.find((m) => m.type === intent.methodType);
    if (!method || !withinLimits(amount, method.limits ?? [])) return [];

    const routes: Route[] = [];
    for (const configured of profile.payments.connectors) {
      if (configured.methods && !configured.methods.includes(intent.methodType)) continue;
      const connector = this.#connectors.get(configured.id);
      if (!connector || this.#isOpen(connector.id)) continue;
      if (connector.health().successRate < this.#minSuccessRate) continue;
      const capability = connector
        .capabilities()
        .find(
          (c) =>
            c.methodType === intent.methodType &&
            c.countries.includes(intent.payerCountry) &&
            c.currencies.includes(amount.currency) &&
            withinLimits(amount, c.limits),
        );
      if (capability) routes.push({ connector, capability, priority: configured.priority });
    }

    return routes.sort(
      (a, b) =>
        a.priority - b.priority ||
        b.connector.health().successRate - a.connector.health().successRate ||
        a.capability.fees.percentBps - b.capability.fees.percentBps,
    );
  }

  /**
   * Initiates the payment on the best route and falls back only when it is
   * provably safe: the request was never sent, or the provider returned a
   * terminal route failure. A payment that may still succeed is never retried.
   */
  async pay(profile: CountryProfile, intent: PaymentIntent): Promise<PaymentOutcome> {
    const attempts: PaymentAttempt[] = [];
    for (const route of this.eligibleRoutes(profile, intent)) {
      const id = route.connector.id;
      // Per-route key: a retry on the same route is idempotent; a fallback is a new attempt.
      const idempotencyKey = `${intent.idempotencyKey}:${id}`;
      let result: InitiateResult;
      try {
        result = await route.connector.initiate({ ...intent, idempotencyKey });
      } catch (error) {
        if (this.#isNotSent(error)) {
          this.#recordFailure(id);
          attempts.push({ connectorId: id, idempotencyKey, state: "NOT_SENT", reasonCode: "PROVIDER_UNAVAILABLE", at: this.#now() });
          continue;
        }
        attempts.push({ connectorId: id, idempotencyKey, state: "OUTCOME_UNKNOWN", at: this.#now() });
        return { status: "OUTCOME_UNKNOWN", connectorId: id, attempts };
      }

      attempts.push({
        connectorId: id,
        idempotencyKey,
        state: result.state,
        providerRef: result.providerRef,
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
        at: this.#now(),
      });

      if (result.state === "SUCCEEDED") {
        this.#recordSuccess(id);
        return { status: "SUCCEEDED", result, connectorId: id, attempts };
      }
      if (!(FAILED_STATES as readonly string[]).includes(result.state)) {
        return { status: "PENDING", result, connectorId: id, attempts };
      }
      const reason = result.reasonCode ?? "UNKNOWN";
      if ((ROUTE_FAILURE_REASONS as readonly string[]).includes(reason)) {
        this.#recordFailure(id);
        continue;
      }
      return { status: "DECLINED", reasonCode: reason, attempts };
    }
    return { status: "NO_ROUTE", attempts };
  }

  /** Connector ids whose circuit is currently open, for the Admin health view. */
  openCircuits(): string[] {
    return [...this.#connectors.keys()].filter((id) => this.#isOpen(id));
  }

  #isOpen(id: string): boolean {
    const state = this.#circuit.get(id);
    if (state?.openedAt === undefined) return false;
    if (this.#now().getTime() - state.openedAt >= this.#cooldownMs) {
      // Half-open: allow traffic again; one more failure re-opens it.
      this.#circuit.set(id, { failures: this.#threshold - 1 });
      return false;
    }
    return true;
  }

  #recordFailure(id: string): void {
    const failures = (this.#circuit.get(id)?.failures ?? 0) + 1;
    this.#circuit.set(id, failures >= this.#threshold ? { failures, openedAt: this.#now().getTime() } : { failures });
  }

  #recordSuccess(id: string): void {
    this.#circuit.set(id, { failures: 0 });
  }
}

function withinLimits(amount: Money, limits: readonly { currency: string; min?: string; max?: string }[]): boolean {
  const limit = limits.find((l) => l.currency === amount.currency);
  if (!limit) return true;
  if (limit.min !== undefined && amount.compare(Money.of(limit.min, amount.currency)) < 0) return false;
  if (limit.max !== undefined && amount.compare(Money.of(limit.max, amount.currency)) > 0) return false;
  return true;
}
