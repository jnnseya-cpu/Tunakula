import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { certifyPaymentConnector } from "@tunakula/payment-connector-certification";
import type { ConnectorCapability, PaymentIntent } from "@tunakula/ts-contracts";
import { KodaConnector } from "../src/index.ts";
import { FakeKoda } from "./fake-koda.ts";

const CAPABILITIES: readonly ConnectorCapability[] = [
  {
    methodType: "MOBILE_MONEY_REDIRECT",
    countries: ["CD"],
    currencies: ["CDF", "USD"],
    limits: [],
    flow: "ASYNC",
    refund: "NONE",
    payout: false,
    settlement: { currency: "CDF", delayDays: 0 },
    fees: { percentBps: 0 },
  },
];

let fake = new FakeKoda();
const make = () => new KodaConnector({ apiKey: "sk_test_k", webhookSecret: fake.webhookSecret, capabilities: CAPABILITIES, transport: fake.transport, successUrlFor: (i) => `tunakula://orders/${i.id}` });
const intent = (extra: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: randomUUID(),
  idempotencyKey: randomUUID(),
  amount: { currency: "CDF", minor: "25000" },
  methodType: "MOBILE_MONEY_REDIRECT",
  payerCountry: "CD",
  marketCountry: "CD",
  payer: {},
  description: "Order",
  ...extra,
});

certifyPaymentConnector("koda", {
  createConnector: () => {
    fake = new FakeKoda();
    return make();
  },
  intentFor: (_scenario, overrides = {}) => intent(overrides),
  failureScenarios: [],
  completeAsync: async (connector, ref) => {
    const i = fake.intents.get(ref);
    await (connector as KodaConnector).submitReference(ref, `TEST-OK-${i?.amount}`);
    return fake.signed({ id: `evt_${ref}`, type: "payment.verified", created_at: new Date().toISOString(), data: { intent_id: ref, status: "verified" } });
  },
  statementDate: () => fake.today,
});

test("KODA: hosted checkout redirect, operators and success URL", async () => {
  fake = new FakeKoda();
  const connector = make();
  const i = intent();
  const r = await connector.initiate(i);
  assert.equal(r.state, "PENDING_CUSTOMER_ACTION");
  assert.equal(r.nextAction.type, "REDIRECT");
  const body = fake.requests[0]?.body as Record<string, unknown>;
  assert.equal(body["amount"], 25000);
  assert.deepEqual(body["operators"], ["orange_cd", "mpesa_cd"]);
  assert.equal(body["success_url"], `tunakula://orders/${i.id}`);
});

test("KODA sandbox references: replay and suffix mismatch keep the intent open; late verification arrives by webhook", async () => {
  fake = new FakeKoda();
  const connector = make();
  const { providerRef } = await connector.initiate(intent());
  assert.deepEqual(await connector.submitReference(providerRef, "TEST-REPLAY"), { state: "PENDING_CUSTOMER_ACTION", reasonCode: "DUPLICATE" });
  assert.deepEqual(await connector.submitReference(providerRef, "TEST-SUFFIX"), { state: "PENDING_CUSTOMER_ACTION", reasonCode: "AUTHENTICATION_FAILED" });
  assert.equal((await connector.submitReference(providerRef, "TEST-LATE-90")).state, "PROCESSING");
  const late = fake.completeLate(providerRef);
  const event = connector.parseWebhook(late.headers, late.body);
  assert.deepEqual([event.state, event.providerRef], ["SUCCEEDED", providerRef]);
});

test("KODA: cancel an awaiting intent; empty ACU balance is a route failure, not a decline", async () => {
  fake = new FakeKoda();
  const connector = make();
  const { providerRef } = await connector.initiate(intent());
  assert.equal(await connector.cancel(providerRef), "CANCELLED");
  fake.acuEmpty = true;
  const r = await connector.initiate(intent());
  assert.deepEqual([r.state, r.reasonCode], ["FAILED", "PROVIDER_UNAVAILABLE"]);
});

test("KODA refuses publishable keys server side", () => {
  assert.throws(() => new KodaConnector({ apiKey: "pk_live_x", webhookSecret: "w", capabilities: [] }), /secret/);
});
