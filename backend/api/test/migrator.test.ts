import { test } from "node:test";
import assert from "node:assert/strict";
import {
  int, mapAll, mapBranch, mapItem, mapOrder, mapUser, normalizePhone, str, toMinorUnits,
  type MigratorConfig, type Row,
} from "../src/migrator/transform.ts";
import { DRC_CONFIG, stackfoodStateFor, stackfoodStoreTypeFor } from "../src/migrator/mapping.ts";
import { formatReport, reconcile, sumMinor } from "../src/migrator/reconcile.ts";

test("toMinorUnits converts decimals by string math, refusing over-precision", () => {
  assert.equal(toMinorUnits("12.50", 2), "1250");
  assert.equal(toMinorUnits("12", 2), "1200");
  assert.equal(toMinorUnits("0.05", 2), "5");
  assert.equal(toMinorUnits("1500", 0), "1500"); // CDF, no minor unit
  assert.equal(toMinorUnits("12.509", 2), null); // more precision than the currency has
  assert.equal(toMinorUnits("abc", 2), null);
  assert.equal(toMinorUnits("0", 2), "0");
});

test("normalizePhone produces E.164 from national, 00 and + forms", () => {
  assert.equal(normalizePhone("0810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("081 000 0000", "243"), "+243810000000");
  assert.equal(normalizePhone("00243810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("+243 81 000 0000", "243"), "+243810000000");
  assert.equal(normalizePhone("243810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("123", "243"), null); // too short
});

test("str and int read and validate cells", () => {
  const row: Row = { a: "  x ", b: "", c: 7, d: "42", e: "4.2", f: null };
  assert.equal(str(row, "a"), "x");
  assert.equal(str(row, "b"), null);
  assert.equal(str(row, "f"), null);
  assert.equal(int(row, "c"), 7);
  assert.equal(int(row, "d"), 42);
  assert.equal(int(row, "e"), null); // not an integer
});

test("mapUser normalises the phone and reports a missing one", () => {
  const ok = mapUser({ id: "9", phone: "081 000 0000", f_name: "Amina", email: "a@x.cd", created_at: "2025-02-01" }, DRC_CONFIG);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.phoneE164, "+243810000000");
    assert.equal(ok.value.displayName, "Amina");
    assert.equal(ok.value.sourceId, "9");
  }
  const bad = mapUser({ id: "10", phone: "" }, DRC_CONFIG);
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.problem.reason, /missing phone/);
});

test("mapItem and mapOrder carry money as integer minor units in the market currency", () => {
  const item = mapItem({ id: "3", restaurant_id: "1", name: "Poulet", price: "5000", status: "1" }, DRC_CONFIG);
  assert.ok(item.ok);
  if (item.ok) {
    assert.equal(item.value.priceMinor, "5000"); // CDF, fractionDigits 0
    assert.equal(item.value.currency, "CDF");
    assert.equal(item.value.available, true);
  }
  const order = mapOrder({ id: "77", restaurant_id: "1", user_id: "9", order_amount: "21890", order_status: "delivered", created_at: "2025-03-01" }, DRC_CONFIG);
  assert.ok(order.ok);
  if (order.ok) {
    assert.equal(order.value.totalMinor, "21890");
    assert.equal(order.value.state, "DELIVERED");
    assert.equal(order.value.customerSourceId, "9");
  }
});

test("mapBranch derives the store type and parses coordinates", () => {
  const b = mapBranch({ id: "1", restaurant_id: "1", name: "BigBite", latitude: "-4.3217", longitude: "15.3126", module_type: "pharmacy" }, DRC_CONFIG);
  assert.ok(b.ok);
  if (b.ok) {
    assert.equal(b.value.storeType, "PHARMACY");
    assert.equal(b.value.lat, -4.3217);
    assert.equal(b.value.lng, 15.3126);
  }
});

test("stackfoodStateFor and storeTypeFor map known values with safe defaults", () => {
  assert.equal(stackfoodStateFor("pending"), "PLACED");
  assert.equal(stackfoodStateFor("Cooking"), "PREPARING");
  assert.equal(stackfoodStateFor("delivered"), "DELIVERED");
  assert.equal(stackfoodStateFor("whatever"), "PLACED"); // unknown → safe default
  assert.equal(stackfoodStoreTypeFor({ module: "grocery store" }), "GROCERY");
  assert.equal(stackfoodStoreTypeFor({}), "RESTAURANT");
});

test("mapAll splits clean records from problems", () => {
  const rows: Row[] = [
    { id: "1", phone: "0810000001", f_name: "A" },
    { id: "2", phone: "" }, // bad
    { id: "3", phone: "0810000003" },
  ];
  const { records, problems } = mapAll(rows, (r) => mapUser(r, DRC_CONFIG));
  assert.equal(records.length, 2);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.sourceId, "2");
});

test("sumMinor adds exactly via BigInt", () => {
  assert.equal(sumMinor(["21890", "5000", "100"]), "26990");
  assert.equal(sumMinor([]), "0");
});

test("reconcile passes when loaded = source - skipped and sums match", () => {
  const ok = reconcile(
    [{ entity: "orders", source: 100, loaded: 98, skipped: 2 }],
    [{ label: "order value (minor)", sourceMinor: "500000", loadedMinor: "500000" }],
  );
  assert.ok(ok.ok);
  assert.match(formatReport(ok), /RECONCILE OK/);

  const bad = reconcile(
    [{ entity: "orders", source: 100, loaded: 90, skipped: 2 }], // 8 missing
    [{ label: "order value (minor)", sourceMinor: "500000", loadedMinor: "499000" }],
  );
  assert.ok(!bad.ok);
  assert.match(formatReport(bad), /RECONCILE FAILED/);
});

test("DRC_CONFIG targets CDF with no minor unit", () => {
  const cfg: MigratorConfig = DRC_CONFIG;
  assert.equal(cfg.currency, "CDF");
  assert.equal(cfg.fractionDigits, 0);
  assert.equal(cfg.countryCallingCode, "243");
});
