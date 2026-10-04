import { test } from "node:test";
import assert from "node:assert/strict";
import { CurrencyRegistry, UnknownCurrencyError, currencies, displayName, displaySymbol } from "../src/index.ts";

// PRD Appendix A — every currency must be present from day one.
const APPENDIX_A = {
  central: ["CDF", "XAF", "AOA", "STN"],
  west: ["XOF", "NGN", "GHS", "GNF", "GMD", "LRD", "SLE", "CVE", "MRU"],
  east: ["KES", "UGX", "TZS", "RWF", "BIF", "ETB", "ERN", "DJF", "SOS", "SSP", "SDG"],
  southern: ["ZAR", "BWP", "NAD", "LSL", "SZL", "ZMW", "MWK", "MZN", "ZWG", "MGA", "MUR", "SCR", "KMF"],
  north: ["EGP", "MAD", "DZD", "TND", "LYD"],
  corridors: ["USD", "EUR", "GBP"],
};

test("registry holds every Appendix A currency as ACTIVE", () => {
  for (const [region, codes] of Object.entries(APPENDIX_A)) {
    for (const code of codes) {
      assert.equal(currencies.get(code).status, "ACTIVE", `${region}: ${code}`);
    }
  }
  assert.equal(Object.values(APPENDIX_A).flat().length - APPENDIX_A.corridors.length, 42);
});

test("minor units come from ISO 4217 (0, 2 and 3 decimal currencies)", () => {
  assert.equal(currencies.get("XOF").minorUnits, 0);
  assert.equal(currencies.get("XAF").minorUnits, 0);
  assert.equal(currencies.get("UGX").minorUnits, 0);
  assert.equal(currencies.get("CDF").minorUnits, 2);
  assert.equal(currencies.get("TND").minorUnits, 3);
  assert.equal(currencies.get("LYD").minorUnits, 3);
  assert.ok(currencies.isoPublished);
});

test("volatility classes: pegs are PEGGED, unreviewed currencies default to VOLATILE", () => {
  assert.equal(currencies.get("XOF").volatilityClass, "PEGGED");
  assert.equal(currencies.get("USD").volatilityClass, "MANAGED");
  assert.equal(currencies.get("CDF").volatilityClass, "VOLATILE");
});

test("redenominated currencies are retired and point to their replacement", () => {
  const sll = currencies.get("SLL");
  assert.equal(sll.status, "RETIRED");
  assert.equal(sll.replacedBy, "SLE");
  assert.equal(sll.conversionFactor, "1000");
  assert.throws(() => currencies.getActive("SLL"), /retired/);
  assert.ok(currencies.list({ status: "RETIRED" }).every((c) => c.replacedBy && currencies.has(c.replacedBy)));
});

test("unknown and malformed currencies are rejected", () => {
  assert.throws(() => currencies.get("ABC"), UnknownCurrencyError);
  const registry = new CurrencyRegistry([]);
  const base = {
    numericCode: "999",
    name: "Test",
    minorUnits: 2,
    volatilityClass: "MANAGED",
    fxSources: [],
    controls: {},
    status: "ACTIVE",
  } as const;
  assert.throws(() => registry.register({ ...base, code: "abc" }), TypeError);
  assert.throws(() => registry.register({ ...base, code: "ABC", minorUnits: 5 }), RangeError);
  registry.register({ ...base, code: "ABC" });
  assert.throws(() => registry.register({ ...base, code: "ABC" }), /already registered/);
});

test("names and symbols are localised from CLDR, not hard-coded", () => {
  assert.match(displayName("CDF", "fr"), /franc congolais/i);
  assert.equal(displaySymbol("CDF", "fr-CD"), "FC");
  assert.equal(displaySymbol("GBP", "en-GB"), "£");
});
