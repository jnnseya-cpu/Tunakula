import { test } from "node:test";
import assert from "node:assert/strict";
import { SandboxConnector } from "@tunakula/payment-connector-sandbox";
import type { PaymentConnector, PaymentIntent } from "@tunakula/ts-contracts";
import { PaymentRouter } from "../src/index.ts";
import { capability, intent, syntheticProfile } from "./helpers.ts";

const cd = syntheticProfile("cd");
const gb = syntheticProfile("gb");
const sn = syntheticProfile("sn");

// The CD profile routes bitripay (priority 0) before sandbox (priority 10).
const pair = (primary: Partial<ConstructorParameters<typeof SandboxConnector>[0]> = {}) => {
  const bitripay = new SandboxConnector({ id: "bitripay", capabilities: [capability(), capability({ methodType: "CARD", countries: ["GB", "CD"], currencies: ["GBP", "USD"] })], ...primary });
  const sandbox = new SandboxConnector({ id: "sandbox", capabilities: [capability()] });
  return { bitripay, sandbox, router: new PaymentRouter([bitripay, sandbox]) };
};

test("ranks eligible routes by Country Profile priority", () => {
  const { router } = pair();
  assert.deepEqual(router.eligibleRoutes(cd, intent()).map((r) => r.connector.id), ["bitripay", "sandbox"]);
});

test("eligibility filters by method, payer country, currency and limits — from data only", () => {
  const { router } = pair();
  // CARD is not a method in the SN profile.
  assert.equal(router.eligibleRoutes(sn, intent({ marketCountry: "SN", payerCountry: "SN", methodType: "CARD", amount: { currency: "XOF", minor: "5000" } })).length, 0);
  // GBP is not a currency the mobile-money capability supports.
  assert.equal(router.eligibleRoutes(cd, intent({ amount: { currency: "GBP", minor: "1000" } })).length, 0);
  // Profile limit: mobile money in CD is capped at 500.00 USD.
  assert.equal(router.eligibleRoutes(cd, intent({ amount: { currency: "USD", minor: "50001" } })).length, 0);
  // Payer in a country no connector serves.
  assert.equal(router.eligibleRoutes(cd, intent({ payerCountry: "BR" })).length, 0);
  assert.throws(() => router.eligibleRoutes(gb, intent()), /does not govern/);
});

test("checkout shows methods in profile rank order and hides unroutable ones (§20.5)", () => {
  const { router } = pair();
  const { methodType: _omit, ...base } = intent();
  // CD ranks: MOBILE_MONEY_PUSH, CASH_ON_DELIVERY, CARD, TUNAKULA_WALLET; only MM and CARD have connectors here.
  assert.deepEqual(router.presentableMethods(cd, base), ["MOBILE_MONEY_PUSH", "CARD"]);
});

test("successful payment uses the top route only", async () => {
  const { router } = pair();
  const outcome = await router.pay(cd, intent());
  assert.equal(outcome.status, "SUCCEEDED");
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.status === "SUCCEEDED" && outcome.connectorId, "bitripay");
});

test("falls back when the request was never sent", async () => {
  const { router } = pair({ unreachable: true });
  const outcome = await router.pay(cd, intent());
  assert.equal(outcome.status, "SUCCEEDED");
  assert.deepEqual(outcome.attempts.map((a) => [a.connectorId, a.state]), [["bitripay", "NOT_SENT"], ["sandbox", "SUCCEEDED"]]);
});

test("falls back on a terminal route failure", async () => {
  const { router } = pair();
  const outcome = await router.pay(cd, intent({ metadata: { sandbox_outcome: "PROVIDER_UNAVAILABLE" } }));
  // The sandbox also fails with the same metadata, so both routes are tried and none succeeds.
  assert.equal(outcome.status, "NO_ROUTE");
  assert.deepEqual(outcome.attempts.map((a) => a.connectorId), ["bitripay", "sandbox"]);
  assert.notEqual(outcome.attempts[0]?.idempotencyKey, outcome.attempts[1]?.idempotencyKey);
});

test("customer declines are not re-routed to another provider", async () => {
  const { router } = pair();
  const outcome = await router.pay(cd, intent({ metadata: { sandbox_outcome: "INSUFFICIENT_FUNDS" } }));
  assert.equal(outcome.status, "DECLINED");
  assert.equal(outcome.attempts.length, 1);
});

test("a pending async payment is returned, never retried elsewhere", async () => {
  const { router } = pair();
  const outcome = await router.pay(cd, intent({ metadata: { sandbox_outcome: "ASYNC_SUCCEED" } }));
  assert.equal(outcome.status, "PENDING");
  assert.equal(outcome.status === "PENDING" && outcome.result.nextAction.type, "PUSH_SENT");
  assert.equal(outcome.attempts.length, 1);
});

test("an ambiguous error stops routing so status can be checked first", async () => {
  const flaky: PaymentConnector = {
    ...new SandboxConnector({ id: "bitripay", capabilities: [capability()] }),
    id: "bitripay",
    capabilities: () => [capability()],
    health: () => ({ latencyMsP95: 1, errorRate: 0, successRate: 1 }),
    initiate: async () => {
      throw new Error("socket hang up after request was written");
    },
  } as unknown as PaymentConnector;
  const router = new PaymentRouter([flaky, new SandboxConnector({ id: "sandbox", capabilities: [capability()] })]);
  const outcome = await router.pay(cd, intent());
  assert.equal(outcome.status, "OUTCOME_UNKNOWN");
  assert.equal(outcome.attempts.length, 1);
});

test("retrying the same intent is idempotent per route", async () => {
  const { router } = pair();
  const i: PaymentIntent = intent();
  const a = await router.pay(cd, i);
  const b = await router.pay(cd, i);
  assert.ok(a.status === "SUCCEEDED" && b.status === "SUCCEEDED");
  assert.equal(a.result.providerRef, b.result.providerRef);
});

test("circuit breaker opens after repeated route failures and half-opens after cooldown", async () => {
  let now = new Date("2026-10-04T12:00:00Z");
  const bitripay = new SandboxConnector({ id: "bitripay", capabilities: [capability()], unreachable: true });
  const sandbox = new SandboxConnector({ id: "sandbox", capabilities: [capability()] });
  const router = new PaymentRouter([bitripay, sandbox], { circuitThreshold: 2, circuitCooldownMs: 1000, minSuccessRate: 0, now: () => now });
  await router.pay(cd, intent());
  await router.pay(cd, intent());
  assert.deepEqual(router.openCircuits(), ["bitripay"]);
  assert.deepEqual(router.eligibleRoutes(cd, intent()).map((r) => r.connector.id), ["sandbox"]);
  now = new Date(now.getTime() + 1000);
  bitripay.unreachable = false;
  assert.deepEqual(router.eligibleRoutes(cd, intent()).map((r) => r.connector.id), ["bitripay", "sandbox"]);
});

test("unhealthy connectors are skipped", async () => {
  const bitripay = new SandboxConnector({ id: "bitripay", capabilities: [capability()] });
  const router = new PaymentRouter([bitripay, new SandboxConnector({ id: "sandbox", capabilities: [capability()] })], { circuitThreshold: 100 });
  bitripay.unreachable = true;
  await router.pay(cd, intent());
  bitripay.unreachable = false;
  // bitripay: 1 call, 1 failure → success rate 0, below the 0.5 floor.
  assert.deepEqual(router.eligibleRoutes(cd, intent()).map((r) => r.connector.id), ["sandbox"]);
});
