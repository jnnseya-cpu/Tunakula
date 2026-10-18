import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExpoMessages,
  chunk,
  deliverExpoPush,
  isExpoPushToken,
  readExpoReceipts,
} from "../src/modules/comms/expo-push.ts";
import type { HttpRequest, HttpReply } from "../src/modules/messaging/messaging.ts";

const TOK = (s: string) => `ExponentPushToken[${s}]`;

test("isExpoPushToken accepts Expo/Exponent tokens and rejects junk", () => {
  assert.ok(isExpoPushToken(TOK("abc")));
  assert.ok(isExpoPushToken("ExpoPushToken[xyz]"));
  assert.ok(!isExpoPushToken("not-a-token"));
  assert.ok(!isExpoPushToken("ExponentPushToken[]"));
  assert.ok(!isExpoPushToken("")); // empty
});

test("buildExpoMessages drops invalid tokens and carries the notification", () => {
  const msgs = buildExpoMessages([TOK("a"), "garbage", TOK("b")], { title: "Order", body: "On its way", data: { orderId: "o1" } });
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map((m) => m.to), [TOK("a"), TOK("b")]);
  assert.equal(msgs[0]!.title, "Order");
  assert.equal(msgs[0]!.body, "On its way");
  assert.equal(msgs[0]!.sound, "default");
  assert.deepEqual(msgs[0]!.data, { orderId: "o1" });
});

test("chunk splits into Expo-sized batches", () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const batches = chunk(items, 100);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
});

test("readExpoReceipts counts accepted and flags DeviceNotRegistered tokens", () => {
  const tokens = [TOK("a"), TOK("b"), TOK("c")];
  const body = JSON.stringify({
    data: [
      { status: "ok", id: "1" },
      { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "3" },
    ],
  });
  const r = readExpoReceipts(tokens, body);
  assert.equal(r.accepted, 2);
  assert.deepEqual(r.dead, [TOK("b")]);
});

test("readExpoReceipts treats a malformed body as zero accepted, nothing pruned", () => {
  const r = readExpoReceipts([TOK("a")], "<html>502</html>");
  assert.deepEqual(r, { accepted: 0, dead: [] });
});

test("deliverExpoPush posts to Expo, sets auth header, returns accepted + dead", async () => {
  const seen: HttpRequest[] = [];
  const http = async (req: HttpRequest): Promise<HttpReply> => {
    seen.push(req);
    return { status: 200, body: JSON.stringify({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }) };
  };
  const r = await deliverExpoPush(http, [TOK("live"), TOK("dead")], { title: "T", body: "B", data: {} }, "secret-token");
  assert.equal(r.accepted, 1);
  assert.deepEqual(r.dead, [TOK("dead")]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://exp.host/--/api/v2/push/send");
  assert.equal(seen[0]!.headers.authorization, "Bearer secret-token");
});

test("deliverExpoPush with no valid tokens sends nothing", async () => {
  let called = false;
  const http = async (): Promise<HttpReply> => { called = true; return { status: 200, body: "{}" }; };
  const r = await deliverExpoPush(http, ["junk"], { title: "T", body: "B", data: {} });
  assert.deepEqual(r, { accepted: 0, dead: [] });
  assert.equal(called, false);
});

test("deliverExpoPush survives a transport error without pruning tokens", async () => {
  const http = async (): Promise<HttpReply> => { throw new Error("connection reset"); };
  const r = await deliverExpoPush(http, [TOK("a")], { title: "T", body: "B", data: {} });
  assert.deepEqual(r, { accepted: 0, dead: [] });
});

test("deliverExpoPush batches more than 100 tokens across requests", async () => {
  let requests = 0;
  const http = async (req: HttpRequest): Promise<HttpReply> => {
    requests++;
    const n = (JSON.parse(req.body) as unknown[]).length;
    return { status: 200, body: JSON.stringify({ data: Array.from({ length: n }, () => ({ status: "ok" })) }) };
  };
  const tokens = Array.from({ length: 150 }, (_, i) => TOK(`t${i}`));
  const r = await deliverExpoPush(http, tokens, { title: "T", body: "B", data: {} });
  assert.equal(requests, 2);
  assert.equal(r.accepted, 150);
});
