import { randomUUID } from "node:crypto";
import { certifyPaymentConnector } from "@tunakula/payment-connector-certification";
import type { ConnectorCapability, PaymentIntent } from "@tunakula/ts-contracts";
import { StripeConnector } from "../src/index.ts";
import { FakeStripe } from "./fake-stripe.ts";

export const STRIPE_CAPABILITIES: readonly ConnectorCapability[] = [
  {
    methodType: "CARD",
    countries: ["CD", "GB"],
    currencies: ["USD", "GBP"],
    limits: [{ currency: "USD", min: "0.50", max: "5000.00" }],
    flow: "ASYNC",
    refund: "PARTIAL",
    payout: false,
    settlement: { currency: "USD", delayDays: 2 },
    fees: { percentBps: 290, fixed: { currency: "USD", minor: "30" } },
  },
];

// Scenario → Stripe test payment-method token (the sandbox decides the outcome from the card).
const TOKEN: Record<string, string> = {
  SUCCEED: "pm_card_visa",
  ASYNC_SUCCEED: "pm_card_authRequired",
  CUSTOMER_DECLINED: "pm_card_chargeDeclined",
  INSUFFICIENT_FUNDS: "pm_card_insufficient",
  AUTHENTICATION_FAILED: "pm_card_authFail",
};

let fake = new FakeStripe();
certifyPaymentConnector("stripe", {
  createConnector: () => {
    fake = new FakeStripe();
    return new StripeConnector({
      apiKey: "sk_test_abc",
      webhookSecret: fake.webhookSecret,
      capabilities: STRIPE_CAPABILITIES,
      transport: fake.transport,
    });
  },
  intentFor: (scenario, overrides = {}): PaymentIntent => ({
    id: randomUUID(),
    idempotencyKey: randomUUID(),
    amount: { currency: "USD", minor: "2500" },
    methodType: "CARD",
    payerCountry: "CD",
    marketCountry: "CD",
    payer: { token: TOKEN[scenario] ?? "pm_card_visa" },
    description: "Certification",
    ...overrides,
  }),
  failureScenarios: ["CUSTOMER_DECLINED", "INSUFFICIENT_FUNDS", "AUTHENTICATION_FAILED"],
  completeAsync: async (_c, ref) => fake.completePending(ref),
  statementDate: () => fake.today,
});
