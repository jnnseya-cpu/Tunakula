import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "@tunakula/ts-money";
import {
  FeatureFlags,
  FlagError,
  PLATFORM_SLOS,
  REDACTED,
  createJournal,
  createLogger,
  errorBudget,
  proveLedger,
  redact,
  releaseFreeze,
  type StoredJournal,
} from "../src/index.ts";

test("§28.3 logs are structured JSON with trace id and PII redacted at source", () => {
  const lines: string[] = [];
  const log = createLogger({ service: "api", sink: { write: (l) => lines.push(l) }, now: () => new Date("2026-10-04T12:00:00Z") });
  log.child({ traceId: "trace-1", country: "CD" }).info("Refund issued to +243 810 000 001 (maman@example.cd)", {
    orderId: "o1",
    customer: { userId: "u1", displayName: "Maman Thérèse", phoneE164: "+243810000001", email: "maman@example.cd" },
    recipientCode: "4821",
    card: "paid with 4111 1111 1111 1111",
    note: "rider id r1, order total 2050 minor",
    dropLocation: { lat: -4.32, lng: 15.31 },
    reasonCode: "MISSING_ITEM",
  });
  const line = JSON.parse(lines[0] as string);
  assert.equal(line.traceId, "trace-1");
  assert.equal(line.country, "CD");
  assert.equal(line.msg, "Refund issued to [PHONE] ([EMAIL])");
  assert.equal(line.customer.userId, "u1", "pseudonymous ids are kept");
  assert.equal(line.customer.displayName, REDACTED);
  assert.equal(line.customer.phoneE164, REDACTED);
  assert.equal(line.recipientCode, REDACTED);
  assert.equal(line.card, "paid with [CARD]");
  assert.equal(line.note, "rider id r1, order total 2050 minor", "ordinary numbers are left alone");
  assert.equal(line.dropLocation, REDACTED);
  assert.equal(line.reasonCode, "MISSING_ITEM");
  assert.ok(!lines[0]?.includes("0001") && !lines[0]?.includes("Thérèse"));
});

test("sensitive keys are caught by suffix, ordinary ids and codes are kept", async () => {
  const { isSensitiveKey } = await import("../src/index.ts");
  for (const k of ["dropLocation", "customer_phone", "payoutAccountNumber", "accessToken", "recipient_code", "lat", "deviceId"]) assert.ok(isSensitiveKey(k), k);
  for (const k of ["orderId", "reasonCode", "currency", "country", "branchId", "riderId", "amountMinor"]) assert.ok(!isSensitiveKey(k), k);
});

test("redaction handles errors, bigints and deep structures; debug is filtered by level", () => {
  assert.deepEqual(redact({ e: new Error("call +44 7700 900123"), n: 10n }), { e: { name: "Error", message: "call [PHONE]" }, n: "10" });
  const lines: string[] = [];
  const log = createLogger({ service: "api", sink: { write: (l) => lines.push(l) }, level: "info" });
  log.debug("noise");
  log.warn("kept");
  assert.equal(lines.length, 1);
});

const j = (id: string, entries: [string, string, string][], extra: Partial<StoredJournal> = {}): StoredJournal => ({
  id,
  idempotencyKey: `k-${id}`,
  entries: entries.map(([account, currency, amountMinor]) => ({ account, country: "CD", currency, amountMinor })),
  ...extra,
});

test("NFR-08 nightly ledger proof passes a clean ledger", () => {
  const real = createJournal({
    id: "j1",
    idempotencyKey: "o1",
    description: "x",
    entries: [
      { account: "psp_clearing", country: "CD", amount: Money.of("10.00", "USD") },
      { account: "restaurant_payable", country: "CD", amount: Money.of("-10.00", "USD") },
    ],
  });
  const stored: StoredJournal = { id: real.id, idempotencyKey: real.idempotencyKey, entries: real.entries.map((e) => ({ account: e.account, country: e.country, currency: e.amount.currency, amountMinor: e.amount.minor })) };
  const proof = proveLedger([stored, j("j2", [["rounding", "CDF", "-40"], ["psp_clearing", "CDF", "40"]], { reverses: "j1" })]);
  assert.deepEqual([proof.ok, proof.severity, proof.journals, proof.entries], [true, "NONE", 2, 4]);
});

test("NFR-08 any stored corruption is a SEV1 with the exact break", () => {
  const proof = proveLedger([
    j("a", [["psp_clearing", "USD", "1000"], ["restaurant_payable", "USD", "-999"]]),
    j("b", [["psp_clearing", "USD", "100"], ["rider_payable", "GBP", "-100"]]),
    j("c", [["psp_clearing", "USD", "0"], ["rider_payable", "USD", "0"]]),
    j("c", [["x", "USD", "1"], ["y", "USD", "-1"]], { idempotencyKey: "k-a" }),
    j("d", [["x", "USD", "1.5"], ["y", "USD", "-1"]]),
    j("e", [["x", "USD", "1"], ["y", "USD", "-1"]], { reverses: "ghost" }),
    j("f", [["x", "USD", "1"], ["y", "USD", "-1"]], { reverses: "a" }),
    j("g", [["x", "USD", "1"], ["y", "USD", "-1"]], { reverses: "a" }),
    j("h", [["x", "USD", "1"]]),
  ]);
  assert.equal(proof.severity, "SEV1");
  const codes = proof.breaks.map((b) => `${b.journalId}:${b.code}`);
  for (const expected of [
    "a:UNBALANCED",
    "b:UNBALANCED",
    "c:ZERO_ENTRY",
    "c:DUPLICATE_JOURNAL_ID",
    "c:DUPLICATE_IDEMPOTENCY_KEY",
    "d:INVALID_AMOUNT",
    "e:ORPHAN_REVERSAL",
    "g:DOUBLE_REVERSAL",
    "h:TOO_FEW_ENTRIES",
  ]) assert.ok(codes.includes(expected), expected);
  assert.ok(proof.breaks.find((b) => b.journalId === "a")?.detail.includes("USD off by 1"));
});

test("§28.5 feature flags: per market, city, brand and segment; owner and removal date required", () => {
  const flags = new FeatureFlags({ now: () => new Date("2026-10-04") });
  flags.define({
    key: "whatsapp_order",
    description: "Order through WhatsApp",
    owner: "product@tunakula",
    removeBy: "2027-03-31",
    defaultValue: false,
    rules: [
      { when: { country: "CD", cityId: "lubumbashi" }, value: false },
      { when: { country: "CD" }, value: true },
      { when: { segment: "beta" }, value: true },
    ],
  });
  assert.ok(flags.isEnabled("whatsapp_order", { country: "CD", cityId: "kinshasa" }));
  assert.ok(!flags.isEnabled("whatsapp_order", { country: "CD", cityId: "lubumbashi" }));
  assert.ok(!flags.isEnabled("whatsapp_order", { country: "GB" }));
  assert.ok(flags.isEnabled("whatsapp_order", { country: "GB", segments: ["beta"] }));
  assert.ok(!flags.isEnabled("never_defined", { country: "CD" }), "unknown flags are off");

  assert.throws(() => flags.define({ key: "x_flag", description: "", owner: "", removeBy: "2027-01-01", defaultValue: false, rules: [] }), FlagError);
  assert.throws(() => flags.define({ key: "y_flag", description: "", owner: "me", removeBy: "soon", defaultValue: false, rules: [] }), /removal date/);
  assert.throws(() => flags.define({ key: "z_flag", description: "", owner: "me", removeBy: "2026-01-01", defaultValue: false, rules: [] }), /in the past/);
});

test("§28.5 percentage rollouts are sticky per user and roughly proportional; overdue flags are reported", () => {
  let now = new Date("2026-10-04");
  const flags = new FeatureFlags({ now: () => now });
  flags.define({ key: "new_checkout", description: "", owner: "pm", removeBy: "2026-12-01", defaultValue: false, rules: [{ when: { country: "GB" }, value: true, rolloutPercent: 25 }] });
  const on = Array.from({ length: 2000 }, (_, i) => flags.isEnabled("new_checkout", { country: "GB", userId: `u${i}` })).filter(Boolean).length;
  assert.ok(on > 400 && on < 600, `~25% enabled, got ${on}`);
  const first = flags.isEnabled("new_checkout", { country: "GB", userId: "u7" });
  for (let i = 0; i < 5; i++) assert.equal(flags.isEnabled("new_checkout", { country: "GB", userId: "u7" }), first);
  assert.equal(flags.overdue().length, 0);
  now = new Date("2026-12-02");
  assert.deepEqual(flags.overdue().map((f) => f.key), ["new_checkout"]);
});

test("§28.2 error budgets: releases for an area freeze when its budget is spent", () => {
  const ordering = PLATFORM_SLOS.find((s) => s.id === "api-availability-ordering")!;
  const healthy = errorBudget(ordering, { total: 1_000_000, good: 999_400 });
  assert.equal(healthy.allowedBad, 1000);
  assert.equal(healthy.bad, 600);
  assert.ok(!healthy.exhausted && Math.abs(healthy.remaining - 0.4) < 1e-9);
  const spent = errorBudget(ordering, { total: 1_000_000, good: 998_999 });
  assert.ok(spent.exhausted);
  const payments = errorBudget(PLATFORM_SLOS.find((s) => s.id === "api-availability-payments")!, { total: 50_000, good: 50_000 });
  assert.deepEqual(releaseFreeze([spent, payments]), { frozen: ["ordering"], reasons: { ordering: ["api-availability-ordering"] } });
  assert.throws(() => errorBudget(ordering, { total: 10, good: 11 }), RangeError);
});
