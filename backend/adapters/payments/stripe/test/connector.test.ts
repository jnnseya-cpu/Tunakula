import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PaymentIntent } from "@tunakula/ts-contracts";
import { StripeConnector } from "../src/index.ts";
import { FakeStripe } from "./fake-stripe.ts";
import { STRIPE_CAPABILITIES } from "./certification.test.ts";

const make = (fake: FakeStripe) => new StripeConnector({ apiKey: "sk_test_abc", webhookSecret: fake.webhookSecret, capabilities: STRIPE_CAPABILITIES, transport: fake.transport });
const intent = (token: string, overrides: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: randomUUID(), idempotencyKey: randomUUID(), amount: { currency: "USD", minor: "2500" }, methodType: "CARD",
  payerCountry: "CD", marketCountry: "CD", payer: { token }, description: "x", ...overrides,
});

test("rejects publishable or malformed keys and a missing webhook secret", () => {
  assert.throws(() => new StripeConnector({ apiKey: "pk_test_x", webhookSecret: "whsec_1", capabilities: STRIPE_CAPABILITIES }), /secret/);
  assert.throws(() => new StripeConnector({ apiKey: "sk_test_x", webhookSecret: "nope", capabilities: STRIPE_CAPABILITIES }), /whsec_/);
});

test("a 3-D Secure intent returns a redirect the client can complete", async () => {
  const fake = new FakeStripe();
  const r = await make(fake).initiate(intent("pm_card_authRequired"));
  assert.equal(r.state, "PENDING_CUSTOMER_ACTION");
  assert.equal(r.nextAction.type, "REDIRECT");
});

test("a declined card maps to a normalised reason and stays readable by id", async () => {
  const fake = new FakeStripe();
  const c = make(fake);
  const r = await c.initiate(intent("pm_card_insufficient"));
  assert.equal(r.state, "FAILED");
  assert.equal(r.reasonCode, "INSUFFICIENT_FUNDS");
  assert.ok(!r.providerRef.startsWith("rejected:"), "the failed intent keeps its Stripe id");
  assert.equal((await c.getStatus(r.providerRef)).state, "FAILED");
});

test("a tampered webhook body fails signature verification", async () => {
  const fake = new FakeStripe();
  const c = make(fake);
  const { providerRef } = await c.initiate(intent("pm_card_authRequired"));
  const hook = fake.completePending(providerRef);
  assert.equal(c.verifyWebhook(hook.headers, hook.body), true);
  assert.equal(c.verifyWebhook(hook.headers, `${hook.body} `), false);
  assert.equal(c.verifyWebhook({}, hook.body), false);
});
