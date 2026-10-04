import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validateCountryProfile, type CountryProfile } from "../src/index.ts";

const dir = new URL("../fixtures/country-profiles/", import.meta.url);
const load = (file: string): CountryProfile => JSON.parse(readFileSync(new URL(file, dir), "utf8"));
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json"));

// Deep-clones a fixture and applies a mutation, for negative tests.
const mutate = (file: string, change: (p: any) => void): unknown => {
  const copy = structuredClone(load(file));
  change(copy);
  return copy;
};
const issuesOf = (doc: unknown) => {
  const result = validateCountryProfile(doc);
  assert.equal(result.ok, false, "expected the profile to be rejected");
  return result.ok ? [] : result.issues;
};
const hasIssue = (doc: unknown, path: string, pattern: RegExp) =>
  assert.ok(issuesOf(doc).some((i) => i.path === path && pattern.test(i.message)), JSON.stringify(issuesOf(doc)));

test("§33 multi-market matrix: dual-currency landmark, single-currency postcode, zero-decimal mobile money", () => {
  assert.deepEqual(fixtures.sort(), ["cd.synthetic.json", "gb.synthetic.json", "sn.synthetic.json"]);
  for (const file of fixtures) {
    const result = validateCountryProfile(load(file));
    assert.ok(result.ok, `${file}: ${JSON.stringify(!result.ok && result.issues)}`);
  }
  const [cd, gb, sn] = ["cd", "gb", "sn"].map((c) => load(`${c}.synthetic.json`)) as [CountryProfile, CountryProfile, CountryProfile];
  assert.ok(cd.money.dual_currency && cd.addressing.model === "LANDMARK_PIN");
  assert.ok(!gb.money.dual_currency && gb.addressing.model === "POSTCODE");
  assert.ok(sn.money.currencies[0] === "XOF" && sn.payments.methods[0]?.type === "MOBILE_MONEY_PUSH");
});

test("synthetic profiles are refused in production", () => {
  const result = validateCountryProfile(load("cd.synthetic.json"), { environment: "production" });
  assert.ok(!result.ok && result.issues.some((i) => i.path === "/synthetic"));
});

test("schema rejects unknown fields and bad enums", () => {
  hasIssue(mutate("gb.synthetic.json", (p) => (p.country.colour = "red")), "/country", /additional properties/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.addressing.model = "WHAT3WORDS")), "/addressing/model", /allowed values/);
  hasIssue(mutate("gb.synthetic.json", (p) => delete p.money.settlement_currency), "/money", /settlement_currency/);
});

test("currencies must be in the registry, active and consistent", () => {
  hasIssue(mutate("gb.synthetic.json", (p) => (p.money.currencies = ["GBP", "ABC"], p.money.dual_currency = true)), "/money/currencies/1", /Currency Registry/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.money.currencies = ["GBP", "SLL"], p.money.dual_currency = true)), "/money/currencies/1", /retired/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.money.settlement_currency = "EUR")), "/money/settlement_currency", /not one of/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.money.dual_currency = true)), "/money/dual_currency", /more than one/);
});

test("amounts and increments must be representable in their currency", () => {
  hasIssue(mutate("sn.synthetic.json", (p) => (p.money.cash_rounding[0].increment = "0.5")), "/money/cash_rounding/0/increment", /not representable/);
  hasIssue(mutate("sn.synthetic.json", (p) => (p.payments.cod_policy.cash_cap[0].amount = "100.50")), "/payments/cod_policy/cash_cap/0", /decimal places/);
  hasIssue(mutate("cd.synthetic.json", (p) => (p.payments.methods[0].limits[0].min = "900.00")), "/payments/methods/0/limits/0", /min is greater/);
});

test("payment configuration must be unambiguous", () => {
  hasIssue(mutate("gb.synthetic.json", (p) => (p.payments.methods[1].rank = 1)), "/payments/methods/1/rank", /used twice/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.payments.cod_policy.enabled = true)), "/payments/cod_policy/enabled", /must match/);
  hasIssue(
    mutate("gb.synthetic.json", (p) => (p.payments.connectors[0].methods = ["MOBILE_MONEY_PUSH"])),
    "/payments/connectors/0/methods/0",
    /not an enabled payment method/,
  );
  hasIssue(mutate("cd.synthetic.json", (p) => delete p.payments.cod_policy.cash_cap), "/payments/cod_policy/cash_cap", /cash cap/);
});

test("locale and time zone checks", () => {
  hasIssue(mutate("gb.synthetic.json", (p) => (p.country.default_locale = "de-DE")), "/country/default_locale", /experience.locales/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.country.timezones = ["Mars/Olympus"])), "/country/timezones/0", /IANA/);
});

test("every accepted currency needs a support refund limit", () => {
  hasIssue(mutate("cd.synthetic.json", (p) => p.operations.support_refund_limit.pop()), "/operations/support_refund_limit", /no support refund limit for CDF/);
  hasIssue(mutate("sn.synthetic.json", (p) => (p.operations.support_refund_limit[0].amount = "1.5")), "/operations/support_refund_limit/0", /decimal places/);
});

test("§29.6: cash on delivery needs a CEO-approved, dated exception that is still in force", () => {
  hasIssue(mutate("cd.synthetic.json", (p) => delete p.payments.cod_policy.exception), "/payments/cod_policy/exception", /off by default/);
  hasIssue(mutate("gb.synthetic.json", (p) => (p.payments.cod_policy.exception = structuredClone(load("cd.synthetic.json").payments.cod_policy.exception))), "/payments/cod_policy/exception", /only meaningful/);
  hasIssue(mutate("cd.synthetic.json", (p) => (p.payments.cod_policy.exception.end_date = "2026-09-01")), "/payments/cod_policy/exception/end_date", /follow the approval/);
  const expired = validateCountryProfile(load("cd.synthetic.json"), { asOf: new Date("2027-10-01") });
  assert.ok(!expired.ok && expired.issues.some((i) => /ended on 2027-09-30/.test(i.message)));
  assert.ok(validateCountryProfile(load("cd.synthetic.json"), { asOf: new Date("2026-10-04") }).ok);
});
