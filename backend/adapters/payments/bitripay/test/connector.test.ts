import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConnectorOutcomeUnknownError, ConnectorUnavailableError, type PaymentIntent } from "@tunakula/ts-contracts";
import { BitriPayConnector } from "../src/index.ts";
import { BITRIPAY_CAPABILITIES } from "./certification.test.ts";
import { FakeBitriPay } from "./fake-bitripay.ts";

function setup(extra: Partial<ConstructorParameters<typeof BitriPayConnector>[0]> = {}) {
  const fake = new FakeBitriPay();
  const connector = new BitriPayConnector({
    apiKey: "sk_test_abc",
    webhookSecret: fake.webhookSecret,
    platformKeys: { [fake.kid]: fake.publicKeyPem },
    capabilities: BITRIPAY_CAPABILITIES,
    transport: fake.transport,
    ...extra,
  });
  return { fake, connector };
}
const intent = (msisdn: string, extra: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: randomUUID(),
  idempotencyKey: randomUUID(),
  amount: { currency: "CDF", minor: "250000" },
  methodType: "MOBILE_MONEY_PUSH",
  payerCountry: "CD",
  marketCountry: "CD",
  payer: { msisdn },
  description: "Order 1042",
  ...extra,
});

test("creates intents with the documented request: amount_minor, operators, Idempotency-Key", async () => {
  const { fake, connector } = setup();
  const i = intent("+243000000501");
  await connector.initiate(i);
  const req = fake.requests[0]!;
  assert.equal(req.path, "/payment_intents");
  assert.equal(req.headers?.["Idempotency-Key"], i.idempotencyKey);
  assert.deepEqual((req.body as Record<string, unknown>)["allowed_operators"], ["orange_cd", "mpesa_cd", "airtel_cd", "africell_cd"]);
  assert.equal((req.body as Record<string, unknown>)["amount_minor"], 250000);
  assert.equal(connector.liveMode, false);
});

test("AMBIGUOUS (provider outcome unknown) stays in flight — never a failure that could be re-routed", async () => {
  const { connector } = setup();
  const r = await connector.initiate(intent("+243000000408"));
  assert.equal(r.state, "PROCESSING");
  assert.equal((await connector.getStatus(r.providerRef)).state, "PROCESSING");
});

test("marketplace: payments settle to the merchant's connected account", async () => {
  const { fake, connector } = setup({ connectedAccountFor: () => "acct_pauline" });
  await connector.initiate(intent("+243000000501"));
  assert.equal(fake.requests[0]?.headers?.["BitriPay-Account"], "acct_pauline");
});

test("rate limiting is 'not sent' (safe to fall back); 5xx is 'outcome unknown'", async () => {
  const { fake, connector } = setup();
  fake.down = "rate_limited";
  await assert.rejects(connector.initiate(intent("+243000000501")), ConnectorUnavailableError);
  fake.down = "server_error";
  await assert.rejects(connector.initiate(intent("+243000000501")), ConnectorOutcomeUnknownError);
  assert.ok(connector.health().errorRate > 0);
});

test("webhooks need both the endpoint HMAC and the platform Ed25519 signature", async () => {
  const { fake, connector } = setup();
  const r = await connector.initiate(intent("+243000000500"));
  const hook = fake.completePending(r.providerRef);
  assert.ok(connector.verifyWebhook(hook.headers, hook.body));
  assert.equal(connector.parseWebhook(hook.headers, hook.body).state, "SUCCEEDED");
  const noPlatform = { "BitriPay-Signature": hook.headers["BitriPay-Signature"] as string };
  assert.equal(connector.verifyWebhook(noPlatform, hook.body), false);
  const otherKey = new FakeBitriPay();
  const forged = otherKey.signedEvent(JSON.parse(hook.body));
  assert.equal(connector.verifyWebhook(forged.headers, forged.body), false, "a different secret and key are rejected");
});

test("refunds and payouts carry idempotency keys and map documented errors", async () => {
  const { fake, connector } = setup();
  const paid = await connector.initiate(intent("+243000000501"));
  const over = await connector.refund(paid.providerRef, { currency: "CDF", minor: "250001" }, "r-1");
  assert.deepEqual([over.state, over.reasonCode], ["FAILED", "LIMIT_EXCEEDED"]);
  const payout = await connector.payout({ id: "rider-1", kind: "RIDER", rail: "MOBILE_MONEY", account: "+243810000123", country: "CD" }, { currency: "CDF", minor: "70000" }, "po-1");
  assert.equal(payout.state, "PENDING");
  assert.equal(fake.requests.at(-1)?.headers?.["Idempotency-Key"], "po-1");
  const bad = await connector.payout({ id: "rider-2", kind: "RIDER", rail: "MOBILE_MONEY", account: "+243000000404", country: "CD" }, { currency: "CDF", minor: "70000" }, "po-2");
  assert.deepEqual([bad.state, bad.reasonCode], ["FAILED", "INVALID_ACCOUNT"]);
});

test("refuses publishable keys and amounts JSON cannot carry exactly", async () => {
  assert.throws(() => new BitriPayConnector({ apiKey: "pk_live_x", webhookSecret: "w", capabilities: [] }), /secret/);
  const { connector } = setup();
  await assert.rejects(connector.initiate(intent("+243000000501", { amount: { currency: "CDF", minor: "9007199254740993" } })), /exactly/);
});
