/**
 * Trend Intelligence persistence against a real migrated database (needs Postgres, like the API e2e suite).
 * Covers ingest idempotency/conflict (TI-01), the opportunity freeze, the brief draft→approve→effective
 * lifecycle with expiry, and country RLS isolation (TI-02).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../src/db/testing.ts";
import { approveBrief, effectiveBrief, ingestObservations, saveBriefDraft, saveOpportunity, type ObservationInput } from "../src/persistence/trend.ts";
import type { GrowthBriefV1 } from "../src/modules/trend/brief.ts";
import type { Db } from "../src/db/db.ts";

let t: Awaited<ReturnType<typeof testDatabase>>;
let db: Db;

const obs = (recordId: string, hash: string, value = 25): ObservationInput => ({
  source_id: "first_party_search", source_family: "first_party", source_record_id: recordId, observed_at: "2026-11-10T09:00:00Z",
  window_start: "2026-11-10T08:00:00Z", window_end: "2026-11-10T09:00:00Z", metric: "searches", value, evidence_hash: hash,
});

const brief = (overrides: Partial<GrowthBriefV1> = {}): GrowthBriefV1 => ({
  schema_version: 1, brief_id: "gb_cd_1", brief_version: 1, tenant_id: "tenant_cd", platform_id: "tunakula_cd",
  market: "CD", locale: "fr-CD", topic_id: "poulet-braise", opportunity_score: 86.25, confidence: 83.5,
  valid_from: "2026-11-10T10:00:00Z", expires_at: "2026-11-17T10:00:00Z", evidence_ids: ["ev_1"],
  audience: "Kinshasa lunch crowd", intent: "find grilled chicken nearby", approved_claim_ids: ["claim_1"],
  cta_id: "cta_order_now", allowed_channels: ["seo", "organic_social"], prohibited_claims: [], objective: "orders per session",
  experiment_id: "exp_1", policy_version: 1, ...overrides,
});

before(async () => { t = await testDatabase(); db = t.db; });
after(async () => { await t.drop(); });

test("TI-01: ingest is idempotent — exact replay duplicates, changed hash conflicts", async () => {
  const first = await db.tx({ country: "CD" }, (sql) => ingestObservations(sql, [obs("r1", "h1"), obs("r2", "h2")]));
  assert.deepEqual([first.accepted, first.duplicate, first.conflict], [2, 0, 0]);
  const replay = await db.tx({ country: "CD" }, (sql) => ingestObservations(sql, [obs("r1", "h1")]));
  assert.deepEqual([replay.accepted, replay.duplicate, replay.conflict], [0, 1, 0]);
  const changed = await db.tx({ country: "CD" }, (sql) => ingestObservations(sql, [obs("r1", "h1-DIFFERENT")]));
  assert.deepEqual([changed.accepted, changed.duplicate, changed.conflict], [0, 0, 1]);
  assert.ok(changed.conflicts[0]?.includes("r1"));
});

test("opportunity snapshot freezes on its input digest", async () => {
  const rec = { topic_id: "poulet-braise", market: "CD", locale: "fr-CD", window_end: "2026-11-10T09:00:00Z",
    scoring_version: 1, input_digest: "digestA", opportunity_score: 86.25, confidence: 83.5, band: "BRIEF" as const, breakdown: { demand: 80 } };
  const a = await db.tx({ country: "CD" }, (sql) => saveOpportunity(sql, rec));
  assert.equal(a.frozen, false);
  const b = await db.tx({ country: "CD" }, (sql) => saveOpportunity(sql, { ...rec, opportunity_score: 99 }));
  assert.equal(b.frozen, true, "same digest returns the frozen row");
  assert.equal(b.id, a.id, "and the same id — the score did not change");
});

test("brief lifecycle: a draft does not steer; an approved, fresh, channel-matching brief does; expiry stops it", async () => {
  await db.tx({ country: "CD" }, (sql) => saveBriefDraft(sql, brief(), null));
  const during = new Date("2026-11-12T00:00:00Z");

  // A DRAFT must not resolve as effective.
  assert.equal(await db.tx({ country: "CD" }, (sql) => effectiveBrief(sql, { market: "CD", locale: "fr-CD", topic_id: "poulet-braise", channel: "seo", now: during })), null);

  // Approve it — now it steers the seo channel, but not a channel it does not allow.
  const user = await db.tx({}, (sql) => sql.query<{ id: string }>("INSERT INTO identity.app_user (phone_e164, display_name) VALUES ('+243810000001','Approver') RETURNING id"));
  await db.tx({ country: "CD" }, (sql) => approveBrief(sql, "gb_cd_1", 1, user[0]!.id));
  const eff = await db.tx({ country: "CD" }, (sql) => effectiveBrief(sql, { market: "CD", locale: "fr-CD", topic_id: "poulet-braise", channel: "seo", now: during }));
  assert.equal(eff?.brief_id, "gb_cd_1");
  assert.equal(await db.tx({ country: "CD" }, (sql) => effectiveBrief(sql, { market: "CD", locale: "fr-CD", topic_id: "poulet-braise", channel: "paid", now: during })), null, "channel not allowed");

  // After expiry the same approved brief no longer steers.
  const expired = new Date("2026-11-18T00:00:00Z");
  assert.equal(await db.tx({ country: "CD" }, (sql) => effectiveBrief(sql, { market: "CD", locale: "fr-CD", topic_id: "poulet-braise", channel: "seo", now: expired })), null, "expired brief");
});

test("TI-02: country RLS isolates observations and briefs across tenants", async () => {
  await db.tx({ country: "CD" }, (sql) => ingestObservations(sql, [obs("iso1", "h")]));
  // A different country sees none of CD's rows.
  const gbCount = await db.tx({ country: "GB" }, (sql) => sql.query<{ n: string }>("SELECT count(*)::text AS n FROM trend.observation"));
  assert.equal(gbCount[0]!.n, "0", "GB sees no CD observations");
  const gbBrief = await db.tx({ country: "GB" }, (sql) => effectiveBrief(sql, { market: "CD", locale: "fr-CD", topic_id: "poulet-braise", channel: "seo", now: new Date("2026-11-12T00:00:00Z") }));
  assert.equal(gbBrief, null, "GB cannot resolve CD's brief");
});
