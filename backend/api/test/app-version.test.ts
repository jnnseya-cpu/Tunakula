/**
 * App-version gate logic. Pure, no database. Verifies the compare, the ok/optional/required decision, and that an
 * unreadable version is never hard-blocked (we don't brick a client over a malformed version string).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, decide, parseVersion, shouldBlock, type ReleaseFloor } from "../src/modules/appversion/app-version.ts";

const floor = (over: Partial<ReleaseFloor> = {}): ReleaseFloor => ({ min_supported: "2.0.0", latest: "2.3.0", store_url: "https://store", mandatory: false, message: "", ...over });

test("parseVersion reads MAJOR.MINOR.PATCH and tolerates a v prefix / missing parts", () => {
  assert.deepEqual(parseVersion("2.3.4"), [2, 3, 4]);
  assert.deepEqual(parseVersion("v2"), [2, 0, 0]);
  assert.deepEqual(parseVersion("2.3.4-beta.1"), [2, 3, 4]);
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion(undefined), null);
});

test("compareVersions orders by component, unknown operands compare equal", () => {
  assert.equal(compareVersions("2.0.0", "2.0.1"), -1);
  assert.equal(compareVersions("2.1.0", "2.0.9"), 1);
  assert.equal(compareVersions("3.0.0", "3.0.0"), 0);
  assert.equal(compareVersions("junk", "2.0.0"), 0);
});

test("decide: below min is required, between min and latest is optional, at/above latest is ok", () => {
  assert.equal(decide("1.9.0", floor()), "update_required");
  assert.equal(decide("2.0.0", floor()), "update_optional");
  assert.equal(decide("2.2.9", floor()), "update_optional");
  assert.equal(decide("2.3.0", floor()), "ok");
  assert.equal(decide("2.5.0", floor()), "ok");
});

test("decide: no floor, or an unreadable version, is ok (never a false block)", () => {
  assert.equal(decide("1.0.0", null), "ok");
  assert.equal(decide("garbage", floor()), "ok");
  assert.equal(decide(null, floor()), "ok");
});

test("decide: a set latest is only an optional nudge; empty latest never nudges", () => {
  assert.equal(decide("2.0.0", floor({ latest: "" })), "ok");
});

test("shouldBlock only when the floor is mandatory AND the client is below min", () => {
  assert.equal(shouldBlock("1.9.0", floor({ mandatory: false })), false, "advisory floor never hard-blocks");
  assert.equal(shouldBlock("1.9.0", floor({ mandatory: true })), true, "mandatory + below min blocks");
  assert.equal(shouldBlock("2.1.0", floor({ mandatory: true })), false, "optional-update client is not blocked");
  assert.equal(shouldBlock("garbage", floor({ mandatory: true })), false, "unreadable version is not blocked");
  assert.equal(shouldBlock("1.0.0", null), false, "no floor, no block");
});
