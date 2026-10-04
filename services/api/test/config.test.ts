import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AccountDirectory,
  ConfigPublishError,
  CountryConfigRegistry,
  GROUP_INTERNAL_BRAND,
  READINESS_AREAS,
  TUNAKULA_BRAND,
  assertPrintable,
  composePrintDocument,
  contrastRatio,
  validateBrand,
  type Brand,
  type PrintDocument,
  type ReadinessReview,
} from "../src/index.ts";

const raw = (iso: "cd" | "gb" | "sn") =>
  JSON.parse(readFileSync(new URL(`../../../packages/ts-contracts/fixtures/country-profiles/${iso}.synthetic.json`, import.meta.url), "utf8"));
/** A production-ready profile: the synthetic flag removed and residency decided. */
const realProfile = (iso: "cd" | "gb" | "sn", status = "DRAFT") => {
  const p = raw(iso);
  delete p.synthetic;
  p.country.status = status;
  if (iso === "cd") p.compliance.data_residency = "africa-south1";
  return p;
};
const fullReview = (): ReadinessReview => Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "ceo", at: new Date() }]));

function registry() {
  let now = new Date("2026-10-04T12:00:00Z");
  const r = new CountryConfigRegistry({
    brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND],
    connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }],
    apiHosts: { "europe-west2": "https://eu.api.tunakula.com", "africa-south1": "https://af.api.tunakula.com" },
    now: () => (now = new Date(now.getTime() + 1000)),
  });
  return r;
}
const issuesOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigPublishError) return e.issues.map((i) => i.path);
    throw e;
  }
  return assert.fail("expected ConfigPublishError");
};

test("a market is launched by publishing a profile — no code change (§17)", () => {
  const r = registry();
  const draft = r.saveDraft("country-admin", realProfile("cd", "PILOT"));
  const config = r.publish("ceo", "CD", draft.version, fullReview());
  assert.equal(config.apiHost, "https://af.api.tunakula.com");
  assert.deepEqual(config.currencies.accepted.map((c) => c.code), ["USD", "CDF"]);
  assert.equal(config.currencies.accepted.find((c) => c.code === "CDF")?.symbol, "FC");
  assert.deepEqual(config.currencies.accepted.map((c) => c.flag?.emoji), ["🇺🇸", "🇨🇩"], "every currency carries its flag");
  assert.deepEqual(config.paymentMethods, ["MOBILE_MONEY_PUSH", "CASH_ON_DELIVERY", "CARD", "TUNAKULA_WALLET"]);
  assert.deepEqual(config.languages, ["fr-CD", "ln", "sw", "en"]);
  assert.equal(config.confirmationModel, "RIDER_FIRST");
  assert.equal(config.brand.copy["tagline"], "Tunakula — on mange ensemble");
  assert.ok(config.brand.light.colors.primary && config.brand.dark.colors.primary, "light and dark themes served");
  assert.deepEqual(r.countries(), [{ iso2: "CD", name: "RD Congo", status: "PILOT" }]);
  // Internal settings never reach the public config.
  const json = JSON.stringify(config);
  for (const secret of ["fraud", "bitripay", "kyc", "rider-kyc"]) assert.ok(!json.includes(secret), secret);
});

test("invalid configs cannot be published (CFG-002)", () => {
  const r = registry();
  // Synthetic profiles never go to production.
  const synthetic = r.saveDraft("a", raw("gb"));
  assert.ok(issuesOf(() => r.publish("ceo", "GB", synthetic.version)).includes("/synthetic"));
  // Residency undecided → no regional host.
  const undecided = realProfile("sn");
  assert.ok(issuesOf(() => r.publish("ceo", "SN", r.saveDraft("a", undecided).version)).includes("/compliance/data_residency"));
  // Unknown brand/theme and uncertified connectors.
  const bad = realProfile("gb");
  bad.experience.theme_id = "neon";
  bad.payments.connectors.push({ id: "shady-psp", priority: 5 });
  const paths = issuesOf(() => r.publish("ceo", "GB", r.saveDraft("a", bad).version));
  assert.ok(paths.includes("/experience/theme_id"));
  assert.ok(paths.includes("/payments/connectors/2/id"));
  // Schema-invalid documents are not even saved as drafts.
  assert.throws(() => r.saveDraft("a", { ...realProfile("gb"), money: {} }), ConfigPublishError);
});

test("going live the first time needs every §28.10 readiness area signed", () => {
  const r = registry();
  const v = r.saveDraft("a", realProfile("gb", "LIVE")).version;
  const missing = issuesOf(() => r.publish("ceo", "GB", v, { PRODUCT: { signedBy: "pm", at: new Date() } }));
  assert.deepEqual(missing.filter((p) => p.startsWith("/readiness")).length, READINESS_AREAS.length - 1);
  r.publish("ceo", "GB", v, fullReview());
  // Later changes to a market that has been live do not repeat the go-live review.
  const change = realProfile("gb", "LIVE");
  change.feature_flags.xbo_send = false;
  assert.equal(r.publish("ceo", "GB", r.saveDraft("a", change).version).featureFlags["xbo_send"], false);
});

test("versions are append-only, diffable, and rollback republishes the previous one", () => {
  const r = registry();
  const events: number[] = [];
  r.onPublished((e) => events.push(e.version));
  r.publish("ceo", "GB", r.saveDraft("a", realProfile("gb", "LIVE")).version, fullReview());
  const v2 = realProfile("gb", "LIVE");
  v2.payments.methods[0].rank = 2;
  v2.payments.methods[1].rank = 1;
  r.publish("ceo", "GB", r.saveDraft("a", v2).version);
  assert.deepEqual(r.config("GB").paymentMethods.slice(0, 2), ["WALLET_TOKEN", "CARD"]);
  assert.deepEqual(r.diff("GB", 1, 2).map((d) => d.path), ["/payments/methods/0/rank", "/payments/methods/1/rank"]);

  const rolled = r.rollback("ops", "GB");
  assert.deepEqual(rolled.paymentMethods.slice(0, 2), ["CARD", "WALLET_TOKEN"]);
  assert.deepEqual(r.history("GB").map((h) => [h.version, h.status]), [[1, "SUPERSEDED"], [2, "SUPERSEDED"], [3, "PUBLISHED"]]);
  assert.equal(r.history("GB")[2]?.rolledBackFrom, 1);
  assert.deepEqual(events, [1, 2, 3]);
});

test("brand themes change at runtime without republishing the country (§17.1)", () => {
  const r = registry();
  r.publish("ceo", "GB", r.saveDraft("a", realProfile("gb")).version);
  const before = r.config("GB").brand.themeVersion;
  const recoloured: Brand = structuredClone(TUNAKULA_BRAND) as Brand;
  (recoloured.themes[0]!.light.colors as Record<string, string>)["primary"] = "#8A2F12";
  r.upsertBrand(recoloured);
  assert.notEqual(r.config("GB").brand.themeVersion, before);
  assert.equal(r.config("GB").brand.light.colors.primary, "#8A2F12");
});

test("themes must meet WCAG AA contrast; teal #1BA996 needs dark text", () => {
  assert.ok(contrastRatio("#1BA996", "#FFFFFF") < 3, "white on teal fails even large-text AA");
  assert.ok(contrastRatio("#1BA996", "#0B1F1C") >= 4.5);
  assert.deepEqual(validateBrand(GROUP_INTERNAL_BRAND), []);
  assert.deepEqual(validateBrand(TUNAKULA_BRAND), []);
  const bad: Brand = structuredClone(GROUP_INTERNAL_BRAND) as Brand;
  (bad.themes[0]!.light.colors as Record<string, string>)["onPrimary"] = "#FFFFFF";
  assert.match(validateBrand(bad)[0]?.message ?? "", /contrast 2\.\d+:1; WCAG AA needs 4.5:1/);
  assert.throws(() => registry().upsertBrand(bad), ConfigPublishError);
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
});

test("every printed document carries the Tunakula logo and the business logo", () => {
  const dir = new AccountDirectory({ checks: { openOrders: async () => 0, outstandingBalances: async () => [] } });
  const owner = dir.registerUser({ displayName: "Mama Pauline" });
  const shop = dir.createBusinessAccount(owner.id, { kind: "MERCHANT", name: "Chez Pauline", country: "CD" });
  const body = [{ text: "Poulet mayo x1   18.50 USD" }];

  // No logo uploaded yet: the name prints in the logo position and the merchant is prompted.
  const noLogo = composePrintDocument({ kind: "RECEIPT", platformBrand: TUNAKULA_BRAND, business: dir.account(shop.id), body });
  assert.deepEqual(noLogo.header.platformLogo, { type: "IMAGE", assetId: "asset://brand/tunakula/logo-print", alt: "Tunakula" });
  assert.deepEqual(noLogo.header.businessLogo, { type: "TEXT", text: "Chez Pauline" });
  assert.deepEqual(noLogo.warnings, [{ code: "BUSINESS_LOGO_MISSING", accountId: shop.id }]);

  dir.setAccountImage(owner.id, shop.id, "profile", { assetId: "pauline-logo", contentType: "image/png", bytes: 20_000, width: 400, height: 400 });
  for (const kind of ["RECEIPT", "ORDER_LABEL", "INVOICE", "KITCHEN_TICKET", "CASH_DRAWER_REPORT", "PAYOUT_STATEMENT"] as const) {
    const doc = composePrintDocument({ kind, platformBrand: TUNAKULA_BRAND, business: dir.account(shop.id), body });
    assertPrintable(doc);
    assert.deepEqual(doc.header.businessLogo, { type: "IMAGE", assetId: "pauline-logo", alt: "Chez Pauline" });
    assert.equal(doc.warnings.length, 0);
    assert.equal(doc.paperWidthMm, kind === "INVOICE" || kind === "PAYOUT_STATEMENT" ? 210 : 80);
  }

  // A document assembled anywhere else without both logos is refused by the printer adapters.
  const forged = { ...noLogo, header: { ...noLogo.header, platformLogo: undefined } } as unknown as PrintDocument;
  assert.throws(() => assertPrintable(forged), /Missing Tunakula logo/);
  assert.throws(() => composePrintDocument({ kind: "RECEIPT", platformBrand: TUNAKULA_BRAND, business: dir.account(shop.id), body: [] }), /needs content/);
});
