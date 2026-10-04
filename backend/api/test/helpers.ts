import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { randomUUID } from "node:crypto";
import { validateCountryProfile, type ConnectorCapability, type CountryProfile, type PaymentIntent } from "@tunakula/ts-contracts";

export function syntheticProfile(iso2: "cd" | "gb" | "sn"): CountryProfile {
  const result = validateCountryProfile(syntheticProfileDocument(iso2));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.profile;
}

export function capability(overrides: Partial<ConnectorCapability> = {}): ConnectorCapability {
  return {
    methodType: "MOBILE_MONEY_PUSH",
    countries: ["CD", "SN"],
    currencies: ["USD", "CDF", "XOF"],
    limits: [],
    flow: "ASYNC",
    refund: "PARTIAL",
    payout: true,
    settlement: { currency: "USD", delayDays: 1 },
    fees: { percentBps: 150 },
    ...overrides,
  };
}

export function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: randomUUID(),
    idempotencyKey: randomUUID(),
    amount: { currency: "USD", minor: "2050" },
    methodType: "MOBILE_MONEY_PUSH",
    payerCountry: "CD",
    marketCountry: "CD",
    payer: { msisdn: "+243810000000" },
    description: "test",
    ...overrides,
  };
}
