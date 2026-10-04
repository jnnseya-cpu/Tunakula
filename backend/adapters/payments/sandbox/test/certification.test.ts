import { randomUUID } from "node:crypto";
import { certifyPaymentConnector } from "@tunakula/payment-connector-certification";
import type { ConnectorCapability, PaymentIntent } from "@tunakula/ts-contracts";
import { SandboxConnector } from "../src/index.ts";

export const SANDBOX_CAPABILITIES: readonly ConnectorCapability[] = [
  {
    methodType: "MOBILE_MONEY_PUSH",
    countries: ["CD", "SN"],
    currencies: ["USD", "CDF", "XOF"],
    limits: [{ currency: "USD", min: "0.50", max: "1000.00" }],
    flow: "ASYNC",
    refund: "PARTIAL",
    payout: true,
    settlement: { currency: "USD", delayDays: 1 },
    fees: { percentBps: 150 },
  },
  {
    methodType: "CARD",
    countries: ["CD", "GB"],
    currencies: ["USD", "GBP"],
    limits: [],
    flow: "SYNC",
    refund: "PARTIAL",
    payout: false,
    settlement: { currency: "GBP", delayDays: 2 },
    fees: { percentBps: 250 },
  },
];

certifyPaymentConnector("sandbox", {
  createConnector: () => new SandboxConnector({ capabilities: SANDBOX_CAPABILITIES }),
  intentFor: (scenario, overrides = {}): PaymentIntent => ({
    id: randomUUID(),
    idempotencyKey: randomUUID(),
    amount: { currency: "USD", minor: "2050" },
    methodType: "MOBILE_MONEY_PUSH",
    payerCountry: "CD",
    marketCountry: "CD",
    payer: { msisdn: "+243810000000" },
    description: "Certification",
    metadata: { sandbox_outcome: scenario },
    ...overrides,
  }),
  failureScenarios: ["INSUFFICIENT_FUNDS", "CUSTOMER_DECLINED", "LIMIT_EXCEEDED", "PROVIDER_UNAVAILABLE"],
  completeAsync: async (connector, ref) => (connector as SandboxConnector).completeAsync(ref),
  statementDate: () => new Date().toISOString().slice(0, 10),
});
