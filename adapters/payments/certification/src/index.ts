/**
 * Connector certification contract suite — PRD §20.7, sandbox stage.
 *
 * Every PaymentConnector (BitriPay or direct) must pass this suite before it
 * can be enabled in any Country Profile. A connector package calls
 * `certifyPaymentConnector` from its own test file with a harness that knows
 * how to provoke each scenario in that provider's sandbox.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Money, currencies, type MoneyJSON } from "@tunakula/ts-money";
import {
  FAILED_STATES,
  IN_FLIGHT_STATES,
  PAYMENT_METHOD_TYPES,
  PAYMENT_REASON_CODES,
  PAYMENT_STATES,
  type PaymentConnector,
  type PaymentIntent,
  type PaymentReasonCode,
} from "@tunakula/ts-contracts";

export type Scenario = "SUCCEED" | "ASYNC_SUCCEED" | PaymentReasonCode;

export interface CertificationHarness {
  /** Fresh connector instance per test. */
  createConnector(): PaymentConnector | Promise<PaymentConnector>;
  /** An intent that, in this provider's sandbox, produces the given scenario. */
  intentFor(scenario: Scenario, overrides?: Partial<PaymentIntent>): PaymentIntent;
  /** Customer-side failures the provider can produce; each must map into the reason catalogue. */
  failureScenarios: readonly PaymentReasonCode[];
  /** Drives an async payment to completion and returns the webhook the provider sends. */
  completeAsync?(connector: PaymentConnector, providerRef: string): Promise<{ headers: Record<string, string>; body: string }>;
  /** Today's statement date for reconciliation (YYYY-MM-DD). */
  statementDate(): string;
}

const isInFlight = (s: string) => (IN_FLIGHT_STATES as readonly string[]).includes(s);
const isFailed = (s: string) => (FAILED_STATES as readonly string[]).includes(s);

export function certifyPaymentConnector(name: string, harness: CertificationHarness): void {
  describe(`PaymentConnector certification: ${name}`, () => {
    test("declares valid capabilities", async () => {
      const connector = await harness.createConnector();
      const caps = connector.capabilities();
      assert.ok(caps.length > 0, "at least one capability");
      for (const cap of caps) {
        assert.ok(PAYMENT_METHOD_TYPES.includes(cap.methodType), `method ${cap.methodType}`);
        assert.ok(cap.countries.length > 0 && cap.countries.every((c) => /^[A-Z]{2}$/.test(c)), "ISO 3166 countries");
        for (const code of [...cap.currencies, cap.settlement.currency]) {
          assert.equal(currencies.getActive(code).code, code, `${code} is an active registry currency`);
        }
        for (const limit of cap.limits) {
          // Throws if a limit has more precision than its currency allows.
          if (limit.min) Money.of(limit.min, limit.currency);
          if (limit.max) Money.of(limit.max, limit.currency);
        }
        assert.ok(cap.fees.percentBps >= 0);
      }
    });

    test("successful payment reaches SUCCEEDED", async () => {
      const connector = await harness.createConnector();
      const result = await connector.initiate(harness.intentFor("SUCCEED"));
      assert.ok(result.providerRef);
      assert.ok(PAYMENT_STATES.includes(result.state));
      const status = await connector.getStatus(result.providerRef);
      assert.equal(status.state, "SUCCEEDED");
    });

    test("idempotency: the same key never charges twice", async () => {
      const connector = await harness.createConnector();
      const intent = harness.intentFor("SUCCEED");
      const first = await connector.initiate(intent);
      const second = await connector.initiate(intent);
      assert.equal(second.providerRef, first.providerRef);
      const lines = await connector.fetchStatement(harness.statementDate());
      assert.equal(lines.filter((l) => l.providerRef === first.providerRef).length, 1);
    });

    for (const reason of harness.failureScenarios) {
      test(`failure ${reason} is normalised`, async () => {
        const connector = await harness.createConnector();
        const result = await connector.initiate(harness.intentFor(reason));
        const status = await connector.getStatus(result.providerRef);
        assert.ok(isFailed(status.state), `terminal failure, got ${status.state}`);
        assert.equal(status.reasonCode, reason);
        assert.ok(PAYMENT_REASON_CODES.includes(status.reasonCode));
      });
    }

    if (harness.completeAsync) {
      const completeAsync = harness.completeAsync;
      test("async flow: pending, then a verified webhook confirms success", async () => {
        const connector = await harness.createConnector();
        const result = await connector.initiate(harness.intentFor("ASYNC_SUCCEED"));
        assert.ok(isInFlight(result.state), `in flight, got ${result.state}`);
        assert.notEqual(result.nextAction.type, "NONE");
        const webhook = await completeAsync(connector, result.providerRef);
        assert.ok(connector.verifyWebhook(webhook.headers, webhook.body));
        const event = connector.parseWebhook(webhook.headers, webhook.body);
        assert.equal(event.providerRef, result.providerRef);
        assert.equal(event.state, "SUCCEEDED");
        assert.equal((await connector.getStatus(result.providerRef)).state, "SUCCEEDED");
        // Duplicate delivery parses to the same event id, so consumers can dedupe.
        assert.equal(connector.parseWebhook(webhook.headers, webhook.body).eventId, event.eventId);
      });

      test("webhooks with a bad or missing signature are rejected", async () => {
        const connector = await harness.createConnector();
        const result = await connector.initiate(harness.intentFor("ASYNC_SUCCEED"));
        const webhook = await completeAsync(connector, result.providerRef);
        const tampered = webhook.body.replace("SUCCEEDED", "REFUNDED");
        assert.equal(connector.verifyWebhook(webhook.headers, tampered), false);
        assert.equal(connector.verifyWebhook({}, webhook.body), false);
        assert.throws(() => connector.parseWebhook(webhook.headers, tampered));
      });
    }

    test("refunds respect declared capability and never exceed the amount paid", async () => {
      const connector = await harness.createConnector();
      const intent = harness.intentFor("SUCCEED");
      const cap = connector.capabilities().find((c) => c.methodType === intent.methodType);
      assert.ok(cap, "intent uses a declared method");
      const { providerRef } = await connector.initiate(intent);
      const paid = Money.fromJSON(intent.amount);
      if (cap.refund === "NONE") return;

      const over = await connector.refund(providerRef, paid.add(Money.ofMinor(1n, paid.currency)).toJSON(), "r-over");
      assert.equal(over.state, "FAILED");

      if (cap.refund === "PARTIAL") {
        const [part, rest] = paid.allocate([1, 1]) as [Money, Money];
        assert.equal((await connector.refund(providerRef, part.toJSON(), "r1")).state, "SUCCEEDED");
        // Replaying the same refund key must not refund twice.
        assert.equal((await connector.refund(providerRef, part.toJSON(), "r1")).state, "SUCCEEDED");
        assert.equal((await connector.getStatus(providerRef)).state, "PARTIALLY_REFUNDED");
        assert.equal((await connector.refund(providerRef, rest.toJSON(), "r2")).state, "SUCCEEDED");
      } else {
        assert.equal((await connector.refund(providerRef, paid.toJSON(), "r1")).state, "SUCCEEDED");
      }
      assert.equal((await connector.getStatus(providerRef)).state, "REFUNDED");
    });

    test("statement lines reconcile to successful payments", async () => {
      const connector = await harness.createConnector();
      const ok = harness.intentFor("SUCCEED");
      const okRef = (await connector.initiate(ok)).providerRef;
      const failed = harness.failureScenarios[0];
      const failedRef = failed ? (await connector.initiate(harness.intentFor(failed))).providerRef : undefined;
      const lines = await connector.fetchStatement(harness.statementDate());
      const line = lines.find((l) => l.providerRef === okRef);
      assert.ok(line, "successful payment appears on the statement");
      assert.ok(Money.fromJSON(line.amount).equals(Money.fromJSON(ok.amount)));
      assert.ok(!Money.fromJSON(line.fee as MoneyJSON).isNegative());
      if (failedRef) assert.ok(!lines.some((l) => l.providerRef === failedRef), "failed payments are not settled");
    });

    test("reports health within range", async () => {
      const h = (await harness.createConnector()).health();
      assert.ok(h.latencyMsP95 >= 0);
      assert.ok(h.errorRate >= 0 && h.errorRate <= 1);
      assert.ok(h.successRate >= 0 && h.successRate <= 1);
    });
  });
}
