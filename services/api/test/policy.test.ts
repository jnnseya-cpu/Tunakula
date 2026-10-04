import { test } from "node:test";
import assert from "node:assert/strict";
import type { CountryProfile } from "@tunakula/ts-contracts";
import { ACTIONS, ROLES, assertValidBinding, authorize, type Principal, type ResourceContext, type Role, type RoleBinding, type Scope } from "../src/index.ts";
import { syntheticProfile } from "./helpers.ts";

const live = (p: CountryProfile): CountryProfile => ({ ...p, country: { ...p.country, status: "LIVE" } });
const cd = live(syntheticProfile("cd"));
const gb = live(syntheticProfile("gb"));
const inCD = { activeCountry: "CD", profile: cd } as const;

let n = 0;
const principal = (role: Role, scope: Scope, extra: Partial<RoleBinding> = {}): Principal => {
  const binding: RoleBinding = { id: `b${++n}`, userId: "u1", role, scope, ...extra };
  assertValidBinding(binding);
  return { userId: "u1", bindings: [binding] };
};

// A Kinshasa order: Gombe city, zone Z1, restaurant group RG1, branch BR1, placed by customer c1.
const order: ResourceContext = {
  type: "order",
  country: "CD",
  brandId: "tunakula",
  cityId: "kinshasa",
  zoneIds: ["z-gombe"],
  restaurantGroupId: "rg-1",
  branchId: "br-1",
  ownerUserId: "c1",
};

test("deny by default, with a reason", () => {
  const d = authorize({ userId: "u1", bindings: [] }, "order:read", order, inCD);
  assert.equal(d.allowed, false);
  assert.match(!d.allowed ? d.reason : "", /no binding grants order:read/);
});

test("roles can only be bound at their §8.2 scope", () => {
  assert.throws(() => principal("SUPER_ADMIN", { type: "COUNTRY", id: "CD" }), /cannot be bound at COUNTRY/);
  assert.throws(() => principal("RIDER", { type: "COUNTRY", id: "CD" }), /cannot be bound/);
  assert.throws(() => principal("COUNTRY_ADMIN", { type: "COUNTRY", id: "cd" }), /Invalid country/);
  assert.throws(() => principal("FLEET_PARTNER", { type: "COUNTRY", id: "CD" }), /must name a fleet/);
  for (const [role, def] of Object.entries(ROLES)) {
    for (const g of def.grants) assert.ok(g.action === "*" || (ACTIONS as readonly string[]).includes(g.action), `${role}: ${g.action}`);
  }
});

test("scopes follow the Country → City → Zone and Group → Branch hierarchies", () => {
  assert.ok(authorize(principal("COUNTRY_ADMIN", { type: "COUNTRY", id: "CD" }), "order:read", order, inCD).allowed);
  assert.ok(authorize(principal("CITY_OPS", { type: "CITY", id: "kinshasa" }), "dispatch:manage", order, inCD).allowed);
  assert.ok(!authorize(principal("CITY_OPS", { type: "CITY", id: "lubumbashi" }), "dispatch:manage", order, inCD).allowed);
  assert.ok(authorize(principal("RIDER", { type: "ZONE", id: "z-gombe" }), "job:accept", order, inCD).allowed);
  assert.ok(!authorize(principal("RIDER", { type: "ZONE", id: "z-limete" }), "job:accept", order, inCD).allowed);
  assert.ok(authorize(principal("RESTAURANT_OWNER", { type: "RESTAURANT_GROUP", id: "rg-1" }), "menu:write", order, inCD).allowed);
  assert.ok(!authorize(principal("BRANCH_MANAGER", { type: "BRANCH", id: "br-2" }), "order:accept", order, inCD).allowed);
});

test("kitchen staff can only accept, prepare and hand over", () => {
  const kitchen = principal("KITCHEN_STAFF", { type: "BRANCH", id: "br-1" });
  for (const a of ["order:accept", "order:prepare", "order:handover"] as const) assert.ok(authorize(kitchen, a, order, inCD).allowed, a);
  for (const a of ["menu:write", "price:write", "payout:read", "refund:issue"] as const) assert.ok(!authorize(kitchen, a, order, inCD).allowed, a);
});

test("support refunds are capped by the country's configured limit; finance handles above", () => {
  const support = principal("SUPPORT_AGENT", { type: "COUNTRY", id: "CD" });
  const finance = principal("COUNTRY_FINANCE", { type: "COUNTRY", id: "CD" });
  const refund = (currency: string, minor: string) => ({ ...inCD, amount: { currency, minor } });
  assert.ok(authorize(support, "refund:issue", order, refund("USD", "2500")).allowed); // = 25.00 limit
  const over = authorize(support, "refund:issue", order, refund("USD", "2501"));
  assert.ok(!over.allowed && /WITHIN_SUPPORT_REFUND_LIMIT/.test(over.reason));
  assert.ok(authorize(support, "refund:issue", order, refund("CDF", "7000000")).allowed); // 70 000 FC
  assert.ok(!authorize(support, "refund:issue", order, inCD).allowed, "no amount, no refund");
  assert.ok(authorize(finance, "refund:issue", order, refund("USD", "100000")).allowed);
});

test("customers act on their own orders; any open market; pilot by invitation", () => {
  const kinshasaWorker: Principal = { userId: "c1", bindings: [{ id: "c", userId: "c1", role: "CUSTOMER", scope: { type: "GLOBAL_IDENTITY" } }] };
  const stranger: Principal = { userId: "c2", bindings: [{ id: "s", userId: "c2", role: "CUSTOMER", scope: { type: "GLOBAL_IDENTITY" } }] };
  assert.ok(authorize(kinshasaWorker, "order:read", order, inCD).allowed);
  assert.ok(!authorize(stranger, "order:read", order, inCD).allowed);
  assert.ok(authorize(stranger, "order:place", order, inCD).allowed);

  const pilot = { activeCountry: "CD", profile: { ...cd, country: { ...cd.country, status: "PILOT" as const } } };
  assert.ok(!authorize(stranger, "order:place", order, pilot).allowed);
  assert.ok(authorize({ ...stranger, pilotInvites: ["CD"] }, "order:place", order, pilot).allowed);
});

test("diaspora payer in the UK sends to Kinshasa within the CD request context", () => {
  const payer: Principal = { userId: "p1", bindings: [{ id: "p", userId: "p1", role: "CUSTOMER", scope: { type: "GLOBAL_IDENTITY" } }] };
  assert.ok(authorize(payer, "xbo:send", { ...order, ownerUserId: "p1" }, inCD).allowed);
});

test("fleet partners see only their own fleet's riders", () => {
  const fleet = principal("FLEET_PARTNER", { type: "COUNTRY", id: "CD" }, { fleetId: "moto-1" });
  const rider = { type: "rider", country: "CD", fleetId: "moto-1" };
  assert.ok(authorize(fleet, "fleet_rider:manage", rider, inCD).allowed);
  assert.ok(!authorize(fleet, "fleet_rider:manage", { ...rider, fleetId: "moto-2" }, inCD).allowed);
});

test("riders read only their own earnings", () => {
  const rider = principal("RIDER", { type: "ZONE", id: "z-gombe" });
  const earnings = { type: "earnings", country: "CD", zoneIds: ["z-gombe"] };
  assert.ok(authorize(rider, "earnings:read", { ...earnings, ownerUserId: "u1" }, inCD).allowed);
  assert.ok(!authorize(rider, "earnings:read", { ...earnings, ownerUserId: "u9" }, inCD).allowed);
});

test("§9.5: a request never crosses its active country, even for group roles", () => {
  const admin = principal("SUPER_ADMIN", { type: "GROUP" });
  assert.ok(authorize(admin, "country_config:write", order, inCD).allowed);
  const d = authorize(admin, "order:read", order, { activeCountry: "GB", profile: gb });
  assert.ok(!d.allowed && /request is scoped to GB/.test(d.reason));
  assert.ok(!authorize(principal("COUNTRY_ADMIN", { type: "COUNTRY", id: "GB" }), "order:read", order, inCD).allowed);
  assert.ok(!authorize(admin, "order:read", order, { activeCountry: "CD", profile: gb }).allowed, "mismatched profile");
});

test("bindings of another user are ignored", () => {
  const p: Principal = { userId: "u1", bindings: [{ id: "x", userId: "u2", role: "SUPER_ADMIN", scope: { type: "GROUP" } }] };
  assert.ok(!authorize(p, "order:read", order, inCD).allowed);
});
