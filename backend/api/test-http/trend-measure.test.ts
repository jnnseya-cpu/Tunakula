/**
 * Trend Intelligence measurement (spec §10): compare an approved brief's first-party outcome (orders on its
 * branch) against a matched baseline and recommend continue / revise / rollback — read-only, invisible, honest
 * about insufficient evidence. Needs Postgres.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { syntheticProfileDocument } from "@tunakula/ts-contracts/testing";
import { testDatabase } from "../src/db/testing.ts";
import { CountryConfigRegistry, READINESS_AREAS } from "../src/modules/config/config-registry.ts";
import { GROUP_INTERNAL_BRAND, TUNAKULA_BRAND } from "../src/modules/config/brand.ts";
import { saveVersions } from "../src/persistence/config.ts";
import { addMenuItem, createBranch, ensureGroup, publishBranch } from "../src/persistence/catalogue.ts";
import { addBinding, createUser } from "../src/persistence/identity.ts";
import { loadPrincipal } from "../src/app/principal.ts";
import { TrendService } from "../src/app/trend.ts";
import type { Db } from "../src/db/db.ts";
import type { Principal } from "../src/modules/identity/policy.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;
let registry: CountryConfigRegistry;
let admin: Principal;
let svc: TrendService;
let branchId: string;
let customerId: string;
const NOW = new Date("2026-11-17T00:00:00Z");
const CHANGE_AT = "2026-11-10T00:00:00Z"; // brief valid_from; baseline is the week before

before(async () => {
  t = await testDatabase();
  db = t.db;
  registry = new CountryConfigRegistry({ brands: [TUNAKULA_BRAND, GROUP_INTERNAL_BRAND], connectors: [{ id: "bitripay", certified: true }, { id: "sandbox", certified: true }], apiHosts: { "africa-south1": "https://af.api.tunakula.com" } });
  const doc = syntheticProfileDocument("cd");
  delete doc.synthetic; doc.country.status = "LIVE"; doc.compliance.data_residency = "africa-south1";
  const draft = registry.saveDraft("test", doc);
  registry.publish("test", "CD", draft.version, Object.fromEntries(READINESS_AREAS.map((a) => [a, { signedBy: "test", at: new Date() }])));
  await db.tx({}, (sql) => saveVersions(sql, registry.allVersions()));
  svc = new TrendService(db, registry, () => NOW);
  const brand = registry.published("CD")!.profile.experience.brand_id;

  const u = await db.tx({}, async (sql) => {
    const user = await createUser(sql, { phone: "+243810000030", displayName: "Admin", homeCountry: "CD" });
    await addBinding(sql, { userId: user.id, role: "COUNTRY_ADMIN", scope: { type: "COUNTRY", id: "CD" } });
    return user;
  });
  customerId = u.id;
  admin = await db.tx({}, (sql) => loadPrincipal(sql, u.id));

  await db.tx({ country: "CD" }, async (sql) => {
    await ensureGroup(sql, { id: "rg-m", country: "CD", name: "M", createdBy: u.id });
    const branch = await createBranch(sql, { country_iso2: "CD", brand_id: brand, restaurant_group_id: "rg-m", name: "B", city: null, commune: "Gombe", lat: "-4.3", lng: "15.3", store_type: "RESTAURANT" }, true);
    branchId = branch.id;
    await addMenuItem(sql, branch, { names: { fr: "Poulet" }, prices: { CDF: "5000" } });
    await publishBranch(sql, branchId);
    const order = (createdAt: string) => sql.query(
      `INSERT INTO ordering.order_view (order_id, country_iso2, brand_id, branch_id, customer_id, type, channel, payment_mode, state, total_minor, currency, version, created_at, updated_at)
       VALUES ($1,'CD',$2,$3,$4,'DELIVERY','web','CASH','DELIVERED',5000,'CDF',1,$5,$5)`, [randomUUID(), brand, branchId, u.id, createdAt]);
    // Baseline week [11-03, 11-10): 10 orders. Treated week [11-10, 11-17): 20 orders → clear positive lift.
    for (let i = 0; i < 10; i++) await order(`2026-11-0${(i % 6) + 3}T09:00:00Z`);
    for (let i = 0; i < 20; i++) await order(`2026-11-1${i % 7}T09:00:00Z`);
  });
});
after(async () => { await t.drop(); });

const brief = (topic: string) => ({
  topic_id: topic, locale: "fr-CD", opportunity_score: 80, confidence: 76,
  valid_from: CHANGE_AT, expires_at: "2026-11-24T00:00:00Z", evidence_ids: ["ev_1"],
  audience: "Lunch crowd", intent: "order grilled chicken", approved_claim_ids: ["claim_1"], cta_id: "cta_order",
  allowed_channels: ["owned_placement"] as const, prohibited_claims: [], objective: "orders per session",
  experiment_id: "exp_1", policy_version: 1,
});

test("inconclusive when there is no approved brief for the topic", async () => {
  const r = await svc.measure("CD", admin, { topic_id: `branch-${branchId}` });
  assert.equal(r.recommendation, "inconclusive");
});

test("a positive lift yields a continue recommendation against a matched baseline", async () => {
  const topic = `branch-${branchId}`;
  const created = await svc.createBrief("CD", admin, brief(topic));
  await svc.approveBrief("CD", admin, created.brief_id, 1);
  const r = await svc.measure("CD", admin, { topic_id: topic });
  assert.equal(r.sufficient, true);
  assert.equal(r.treated, 20);
  assert.equal(r.baseline, 10);
  assert.ok(r.lift! > 0, "treated beats baseline");
  assert.equal(r.recommendation, "continue");
});

test("inconclusive when the topic has no first-party outcome source", async () => {
  const created = await svc.createBrief("CD", admin, brief("abstract-topic"));
  await svc.approveBrief("CD", admin, created.brief_id, 1);
  const r = await svc.measure("CD", admin, { topic_id: "abstract-topic" });
  assert.equal(r.recommendation, "inconclusive");
  assert.match(r.reason!, /no first-party outcome source/);
});
