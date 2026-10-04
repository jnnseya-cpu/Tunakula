import { randomUUID } from "node:crypto";
import { certifyPaymentConnector } from "@tunakula/payment-connector-certification";
import type { ConnectorCapability, PaymentIntent } from "@tunakula/ts-contracts";
import { BitriPayConnector } from "../src/index.ts";
import { FakeBitriPay } from "./fake-bitripay.ts";

export const BITRIPAY_CAPABILITIES: readonly ConnectorCapability[] = [
  {
    methodType: "MOBILE_MONEY_PUSH",
    countries: ["CD"],
    currencies: ["CDF", "USD"],
    limits: [{ currency: "USD", min: "0.50", max: "2000.00" }],
    flow: "ASYNC",
    refund: "PARTIAL",
    payout: true,
    settlement: { currency: "USD", delayDays: 1 },
    fees: { percentBps: 150 },
  },
];

const MSISDN: Record<string, string> = {
  SUCCEED: "+243000000501",
  ASYNC_SUCCEED: "+243000000500",
  INVALID_ACCOUNT: "+243000000404",
  PROVIDER_UNAVAILABLE: "+243000000503",
  CUSTOMER_DECLINED: "+243810000000",
};

let fake = new FakeBitriPay();
certifyPaymentConnector("bitripay", {
  createConnector: () => {
    fake = new FakeBitriPay();
    return new BitriPayConnector({
      apiKey: "sk_test_abc",
      webhookSecret: fake.webhookSecret,
      platformKeys: { [fake.kid]: fake.publicKeyPem },
      capabilities: BITRIPAY_CAPABILITIES,
      transport: fake.transport,
    });
  },
  intentFor: (scenario, overrides = {}): PaymentIntent => ({
    id: randomUUID(),
    idempotencyKey: randomUUID(),
    amount: { currency: "CDF", minor: "250000" },
    methodType: "MOBILE_MONEY_PUSH",
    payerCountry: "CD",
    marketCountry: "CD",
    payer: { msisdn: MSISDN[scenario] ?? "+243000000501" },
    description: "Certification",
    ...overrides,
  }),
  failureScenarios: ["INVALID_ACCOUNT", "CUSTOMER_DECLINED", "PROVIDER_UNAVAILABLE"],
  completeAsync: async (_c, ref) => fake.completePending(ref),
  statementDate: () => fake.today,
});
