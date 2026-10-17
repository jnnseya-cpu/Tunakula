import { test } from "node:test";
import assert from "node:assert/strict";
import { isTerminal, snapshotChanged, sseFrame, SSE_HEARTBEAT, type TrackSnapshot } from "../src/app/order-stream.ts";

const snap = (over: Partial<TrackSnapshot> = {}): TrackSnapshot => ({ state: "PICKED_UP", rider: null, ...over });

test("snapshotChanged is true on the first push", () => {
  assert.equal(snapshotChanged(null, snap()), true);
});

test("snapshotChanged detects a state change", () => {
  assert.equal(snapshotChanged(snap({ state: "PREPARING" }), snap({ state: "PICKED_UP" })), true);
});

test("snapshotChanged ignores an identical snapshot", () => {
  const a = snap({ rider: { name: "Amina", position: { lat: 1, lng: 2, updated_at: "t1" }, meters_to_you: 300 } });
  const b = snap({ rider: { name: "Amina", position: { lat: 1, lng: 2, updated_at: "t1" }, meters_to_you: 300 } });
  assert.equal(snapshotChanged(a, b), false);
});

test("snapshotChanged detects the rider moving", () => {
  const a = snap({ rider: { name: "Amina", position: { lat: 1, lng: 2, updated_at: "t1" } } });
  const b = snap({ rider: { name: "Amina", position: { lat: 1.001, lng: 2, updated_at: "t2" } } });
  assert.equal(snapshotChanged(a, b), true);
});

test("snapshotChanged detects a distance change and a rider appearing", () => {
  const noRider = snap({ rider: null });
  const withRider = snap({ rider: { name: "Amina" } });
  assert.equal(snapshotChanged(noRider, withRider), true);
  const near = snap({ rider: { name: "A", meters_to_you: 100 } });
  const nearer = snap({ rider: { name: "A", meters_to_you: 40 } });
  assert.equal(snapshotChanged(near, nearer), true);
});

test("isTerminal marks finished states only", () => {
  assert.equal(isTerminal("DELIVERED"), true);
  assert.equal(isTerminal("CANCELLED"), true);
  assert.equal(isTerminal("PICKED_UP"), false);
  assert.equal(isTerminal("PREPARING"), false);
});

test("sseFrame formats a named event with JSON data and a blank-line terminator", () => {
  const frame = sseFrame("update", { state: "READY" });
  assert.equal(frame, 'event: update\ndata: {"state":"READY"}\n\n');
  assert.ok(frame.endsWith("\n\n"));
});

test("heartbeat is an SSE comment EventSource ignores", () => {
  assert.equal(SSE_HEARTBEAT, ": ping\n\n");
  assert.ok(SSE_HEARTBEAT.startsWith(":"));
});
