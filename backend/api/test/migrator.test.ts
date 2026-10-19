import { test } from "node:test";
import assert from "node:assert/strict";
import {
  int, mapAll, mapBranch, mapItem, mapMerchant, mapOrder, mapUser, moneyToMinor, normalizePhone,
  parseIdList, parseVariations, resolveAddons, str, toMinorUnits,
  type AddonSource, type MigratorConfig, type Row,
} from "../src/migrator/transform.ts";
import { DRC_CONFIG, stackfoodStateFor, stackfoodStoreTypeFor } from "../src/migrator/mapping.ts";
import { formatReport, reconcile, sumMinor } from "../src/migrator/reconcile.ts";

test("toMinorUnits converts decimals by string math, refusing over-precision", () => {
  assert.equal(toMinorUnits("12.50", 2), "1250");
  assert.equal(toMinorUnits("12", 2), "1200");
  assert.equal(toMinorUnits("0.05", 2), "5");
  assert.equal(toMinorUnits("1500", 0), "1500");
  assert.equal(toMinorUnits("12.509", 2), null);
  assert.equal(toMinorUnits("abc", 2), null);
});

test("moneyToMinor rescales StackFood 2-decimal amounts to the target currency", () => {
  // CDF (0 minor digits): StackFood "1500.00" must become 1500, not 150000.
  assert.equal(moneyToMinor("1500.00", 0), "1500");
  assert.equal(moneyToMinor("1500", 0), "1500");
  assert.equal(moneyToMinor("21890.00", 0), "21890");
  assert.equal(moneyToMinor("1500.50", 0), "1501"); // half-up when the target is coarser
  assert.equal(moneyToMinor("1500.49", 0), "1500");
  // USD (2 minor digits): "1500.00" → 150000 cents; "12.5" → 1250.
  assert.equal(moneyToMinor("1500.00", 2), "150000");
  assert.equal(moneyToMinor("12.5", 2), "1250");
  assert.equal(moneyToMinor("0", 0), "0");
  assert.equal(moneyToMinor("bad", 0), null);
});

test("normalizePhone produces E.164 from national, 00 and + forms", () => {
  assert.equal(normalizePhone("0810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("081 000 0000", "243"), "+243810000000");
  assert.equal(normalizePhone("00243810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("+243 81 000 0000", "243"), "+243810000000");
  assert.equal(normalizePhone("243810000000", "243"), "+243810000000");
  assert.equal(normalizePhone("123", "243"), null);
});

test("str and int read and validate cells", () => {
  const row: Row = { a: "  x ", b: "", c: 7, d: "42", e: "4.2", f: null };
  assert.equal(str(row, "a"), "x");
  assert.equal(str(row, "b"), null);
  assert.equal(str(row, "f"), null);
  assert.equal(int(row, "c"), 7);
  assert.equal(int(row, "d"), 42);
  assert.equal(int(row, "e"), null);
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

test("mapMerchant maps a StackFood vendor to the owner account", () => {
  const m = mapMerchant({ id: "4", f_name: "Jean", l_name: "Mbala", phone: "0812223344" }, DRC_CONFIG);
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.value.sourceId, "4");
    assert.equal(m.value.name, "Jean");
    assert.equal(m.value.ownerPhoneE164, "+243812223344");
  }
});

test("mapItem and mapOrder carry StackFood 2-decimal money as CDF minor units", () => {
  // StackFood stores DECIMAL(x,2); CDF has no minor unit, so "5000.00" → "5000".
  const item = mapItem({ id: "3", restaurant_id: "1", name: "Poulet", price: "5000.00", status: "1" }, DRC_CONFIG);
  assert.ok(item.ok);
  if (item.ok) {
    assert.equal(item.value.priceMinor, "5000");
    assert.equal(item.value.currency, "CDF");
    assert.equal(item.value.available, true);
  }
  const soldOut = mapItem({ id: "3b", restaurant_id: "1", name: "Pondu", price: "3000", status: "0" }, DRC_CONFIG);
  assert.ok(soldOut.ok && soldOut.value.available === false);

  const order = mapOrder({ id: "77", restaurant_id: "1", user_id: "9", order_amount: "21890.00", order_status: "delivered", created_at: "2025-03-01" }, DRC_CONFIG);
  assert.ok(order.ok);
  if (order.ok) {
    assert.equal(order.value.totalMinor, "21890");
    assert.equal(order.value.state, "DELIVERED");
    assert.equal(order.value.customerSourceId, "9");
  }
});

test("parseIdList reads a food's add_ons column as JSON or CSV", () => {
  assert.deepEqual(parseIdList("[1, 2, 3]"), ["1", "2", "3"]);
  assert.deepEqual(parseIdList("1,2,3"), ["1", "2", "3"]);
  assert.deepEqual(parseIdList("[]"), []);
  assert.deepEqual(parseIdList(null), []);
  assert.deepEqual(parseIdList(""), []);
  assert.deepEqual(parseIdList("[5]"), ["5"]);
});

test("resolveAddons resolves a food's add_ons ids against the add_ons catalogue", () => {
  const byId = new Map<string, AddonSource>([
    ["1", { id: "1", name: "Fromage", price: "1500.00" }],
    ["2", { id: "2", name: "Piment", price: "0" }],
  ]);
  // CDF has no minor unit, so "1500.00" → "1500".
  assert.deepEqual(resolveAddons("[1, 2]", byId, 0), [
    { name: "Fromage", priceMinor: "1500" },
    { name: "Piment", priceMinor: "0" },
  ]);
  // A stale id with no catalogue row is skipped, not an error.
  assert.deepEqual(resolveAddons("[1, 99]", byId, 0), [{ name: "Fromage", priceMinor: "1500" }]);
  assert.deepEqual(resolveAddons(null, byId, 0), []);
});

test("parseVariations maps v8.0 food_variations into SINGLE/MULTI option groups", () => {
  const raw = JSON.stringify([
    { name: "Taille", type: "single", min: "0", max: "1", required: "on", values: [{ label: "Normale", optionPrice: "0" }, { label: "Grande", optionPrice: "2000.00" }] },
    { name: "Extras", type: "multi", min: "0", max: "2", required: "off", values: [{ label: "Oignons", optionPrice: "500.00" }] },
  ]);
  const vars = parseVariations(raw, 0);
  assert.equal(vars.length, 2);
  assert.equal(vars[0]!.name, "Taille");
  assert.equal(vars[0]!.type, "SINGLE");
  assert.equal(vars[0]!.required, true);
  assert.deepEqual(vars[0]!.options, [{ name: "Normale", priceMinor: "0" }, { name: "Grande", priceMinor: "2000" }]);
  assert.equal(vars[1]!.type, "MULTI");
  assert.equal(vars[1]!.required, false);
  assert.equal(vars[1]!.max, 2);
  // Malformed / empty blobs never throw and yield no groups; a group with no usable option is dropped.
  assert.deepEqual(parseVariations(null, 0), []);
  assert.deepEqual(parseVariations("not json", 0), []);
  assert.deepEqual(parseVariations(JSON.stringify([{ name: "Empty", values: [] }]), 0), []);
});

test("mapItem carries add-ons (resolved) and variations onto the item record", () => {
  const byId = new Map<string, AddonSource>([["7", { id: "7", name: "Supplément frites", price: "1000.00" }]]);
  const row: Row = {
    id: "42", restaurant_id: "1", name: "Burger", price: "6000.00", status: "1",
    add_ons: "[7]",
    food_variations: JSON.stringify([{ name: "Cuisson", type: "single", required: "on", values: [{ label: "À point", optionPrice: "0" }] }]),
  };
  const r = mapItem(row, DRC_CONFIG, byId);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value.addons, [{ name: "Supplément frites", priceMinor: "1000" }]);
    assert.equal(r.value.variations.length, 1);
    assert.equal(r.value.variations[0]!.name, "Cuisson");
    assert.equal(r.value.variations[0]!.options[0]!.name, "À point");
  }
  // Older dump: `variations` column is used when food_variations is absent; no add_ons lookup given → none.
  const legacy = mapItem({ id: "43", restaurant_id: "1", name: "Pizza", price: "8000.00", status: "1", variations: JSON.stringify([{ name: "Taille", values: [{ label: "Large", optionPrice: "3000.00" }] }]) }, DRC_CONFIG);
  assert.ok(legacy.ok && legacy.value.variations[0]!.options[0]!.priceMinor === "3000" && legacy.value.addons.length === 0);
});

test("mapBranch links to the vendor owner, derives store type, parses coordinates", () => {
  const b = mapBranch({ id: "1", vendor_id: "4", name: "BigBite", latitude: "-4.3217", longitude: "15.3126", zone_id: "7", module_type: "pharmacy" }, DRC_CONFIG);
  assert.ok(b.ok);
  if (b.ok) {
    assert.equal(b.value.merchantSourceId, "4"); // vendor_id → owner
    assert.equal(b.value.storeType, "PHARMACY");
    assert.equal(b.value.lat, -4.3217);
    assert.equal(b.value.lng, 15.3126);
    assert.equal(b.value.commune, "7");
  }
  const missingOwner = mapBranch({ id: "2", name: "No owner" }, DRC_CONFIG);
  assert.ok(!missingOwner.ok);
});

test("stackfoodStateFor covers the v8.0 status set with a safe default", () => {
  assert.equal(stackfoodStateFor("pending"), "PLACED");
  assert.equal(stackfoodStateFor("scheduled"), "PLACED");
  assert.equal(stackfoodStateFor("Cooking"), "PREPARING");
  assert.equal(stackfoodStateFor("ready_for_handover"), "READY");
  assert.equal(stackfoodStateFor("out_for_delivery"), "PICKED_UP");
  assert.equal(stackfoodStateFor("delivered"), "DELIVERED");
  assert.equal(stackfoodStateFor("refund_requested"), "DELIVERED");
  assert.equal(stackfoodStateFor("refunded"), "CANCELLED");
  assert.equal(stackfoodStateFor("canceled"), "CANCELLED");
  assert.equal(stackfoodStateFor("whatever"), "PLACED");
});

test("stackfoodStoreTypeFor reads the joined module_type", () => {
  assert.equal(stackfoodStoreTypeFor({ module_type: "grocery" }), "GROCERY");
  assert.equal(stackfoodStoreTypeFor({ module_type: "pharmacy" }), "PHARMACY");
  assert.equal(stackfoodStoreTypeFor({ module_type: "ecommerce" }), "CONVENIENCE");
  assert.equal(stackfoodStoreTypeFor({ module_type: "food" }), "RESTAURANT");
  assert.equal(stackfoodStoreTypeFor({}), "RESTAURANT");
});

test("mapAll splits clean records from problems", () => {
  const rows: Row[] = [
    { id: "1", phone: "0810000001", f_name: "A" },
    { id: "2", phone: "" },
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
    [{ entity: "orders", source: 100, loaded: 90, skipped: 2 }],
    [{ label: "order value (minor)", sourceMinor: "500000", loadedMinor: "499000" }],
  );
  assert.ok(!bad.ok);
  assert.match(formatReport(bad), /RECONCILE FAILED/);
});

test("DRC_CONFIG targets CDF with no minor unit, StackFood vendors/restaurants mapping", () => {
  const cfg: MigratorConfig = DRC_CONFIG;
  assert.equal(cfg.currency, "CDF");
  assert.equal(cfg.fractionDigits, 0);
  assert.equal(cfg.countryCallingCode, "243");
  assert.equal(cfg.fields.merchant.name, "f_name");
  assert.equal(cfg.fields.branch.merchantId, "vendor_id");
});
