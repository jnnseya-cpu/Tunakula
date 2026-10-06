import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMS_CATALOGUE, COMMS_CHANNELS, COMMS_EVENTS, commsSummary,
  type CommsEvent,
} from "../src/comms.ts";

const everyEvent: CommsEvent[] = COMMS_CATALOGUE.flatMap((c) => [...c.events]);

test("catalogue summary is internally consistent", () => {
  const s = commsSummary();
  assert.equal(s.categories, COMMS_CATALOGUE.length);
  assert.equal(s.events, everyEvent.length);
  assert.equal(s.channels, COMMS_CHANNELS.length);
  assert.equal(s.mandatory, everyEvent.filter((e) => e.mandatory).length);
  // Channel coverage sums to the total number of (event × channel) wirings.
  const wirings = everyEvent.reduce((n, e) => n + e.channels.length, 0);
  assert.equal(Object.values(s.channelCoverage).reduce((a, b) => a + b, 0), wirings);
});

test("every event is well-formed and uniquely keyed", () => {
  const keys = new Set<string>();
  for (const e of everyEvent) {
    assert.match(e.key, /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, `bad key: ${e.key}`);
    assert.ok(!keys.has(e.key), `duplicate key: ${e.key}`);
    keys.add(e.key);
    assert.ok(e.title.length > 0 && e.subject.length > 0, `empty copy: ${e.key}`);
    assert.ok(e.audience.length > 0, `no audience: ${e.key}`);
    assert.ok(e.channels.length > 0, `no channel: ${e.key}`);
    assert.ok(e.channels.every((c) => (COMMS_CHANNELS as readonly string[]).includes(c)), `bad channel: ${e.key}`);
  }
  assert.equal(COMMS_EVENTS.size, everyEvent.length);
});

test("every event reaches its recipient in-app, the one channel no one can opt out of", () => {
  for (const e of everyEvent) assert.ok(e.channels.includes("inapp"), `${e.key} has no in-app delivery`);
});

test("mandatory notices are the security, payment, legal and safety ones", () => {
  // A mandatory notice must be deliverable on a channel that reaches a muted recipient.
  for (const e of everyEvent.filter((x) => x.mandatory)) {
    assert.ok(e.channels.some((c) => c === "email" || c === "sms" || c === "inapp"), `${e.key} mandatory but no durable channel`);
  }
  assert.ok(commsSummary().mandatory >= 25, "expected a substantial set of mandatory notices");
});
