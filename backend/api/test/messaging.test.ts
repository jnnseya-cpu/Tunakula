import { test } from "node:test";
import assert from "node:assert/strict";
import { NeverSentError, OutcomeUnknownError, type HttpReply, type HttpRequest } from "../src/modules/messaging/messaging.ts";
import { twilioMessaging } from "../src/modules/messaging/twilio.ts";
import { messagingSender } from "../src/app/channels.ts";

const captured: HttpRequest[] = [];
const transport = (reply: HttpReply | (() => never)) => async (req: HttpRequest): Promise<HttpReply> => {
  captured.push(req);
  if (typeof reply === "function") return reply();
  return reply;
};
const twilio = (reply: HttpReply | (() => never)) =>
  twilioMessaging({ accountSid: "AC123", authToken: "tok", smsFrom: "+1500", whatsappFrom: "+1555", send: transport(reply) });

test("Twilio formats SMS and WhatsApp requests and returns the message id", async () => {
  captured.length = 0;
  const sms = await twilio({ status: 201, body: JSON.stringify({ sid: "SM1" }) }).send({ to: "+243810000001", kind: "SMS", text: "Code 4821" });
  assert.deepEqual(sms, { status: "sent", ref: "SM1" });
  const req = captured[0]!;
  assert.match(req.url, /Accounts\/AC123\/Messages\.json$/);
  assert.equal(req.headers.authorization, `Basic ${Buffer.from("AC123:tok").toString("base64")}`);
  const form = new URLSearchParams(req.body);
  assert.equal(form.get("To"), "+243810000001");
  assert.equal(form.get("From"), "+1500");
  assert.equal(form.get("Body"), "Code 4821");

  captured.length = 0;
  await twilio({ status: 201, body: JSON.stringify({ sid: "WA1" }) }).send({ to: "+243810000001", kind: "WHATSAPP", text: "hi" });
  const wa = new URLSearchParams(captured[0]!.body);
  assert.equal(wa.get("To"), "whatsapp:+243810000001");
  assert.equal(wa.get("From"), "whatsapp:+1555");
});

test("Twilio maps outcomes: 4xx is failed, network is unavailable, timeout/5xx is unknown", async () => {
  const bad = await twilio({ status: 400, body: JSON.stringify({ message: "not a valid number", code: 21211 }) }).send({ to: "+1", kind: "SMS", text: "x" });
  assert.equal(bad.status, "failed");
  assert.match((bad as { failure: string }).failure, /not a valid number \(code 21211\)/);

  const net = await twilio(() => { throw new NeverSentError("ECONNREFUSED"); }).send({ to: "+243810000001", kind: "SMS", text: "x" });
  assert.equal(net.status, "unavailable");

  const timeout = await twilio(() => { throw new OutcomeUnknownError("request timed out"); }).send({ to: "+243810000001", kind: "SMS", text: "x" });
  assert.equal(timeout.status, "unknown");

  const server = await twilio({ status: 503, body: "" }).send({ to: "+243810000001", kind: "SMS", text: "x" });
  assert.equal(server.status, "unknown");
});

test("a channel with no configured sender fails cleanly", async () => {
  const onlySms = twilioMessaging({ accountSid: "AC", authToken: "t", smsFrom: "+1", send: transport({ status: 201, body: "{}" }) });
  const r = await onlySms.send({ to: "+243810000001", kind: "WHATSAPP", text: "x" });
  assert.equal(r.status, "failed");
});

test("the messaging bridge sends SMS/WhatsApp and logs the rest", async () => {
  const sender = messagingSender(twilio({ status: 201, body: JSON.stringify({ sid: "SM9" }) }));
  const event = { key: "order.delivered", title: "", subject: "Livrée", severity: "success", mandatory: false, audience: ["customer"], channels: ["inapp"] } as const;
  const base = { subject: "Livrée", event, data: {} };

  const wa = await sender.send({ channel: "whatsapp", to: { userId: "u", phone: "+243810000001" }, ...base });
  assert.deepEqual(wa, { status: "sent", ref: "SM9" });

  const noPhone = await sender.send({ channel: "sms", to: { userId: "u" }, ...base });
  assert.equal(noPhone.status, "failed");
  assert.match((noPhone as { failure: string }).failure, /no phone/);

  const inapp = await sender.send({ channel: "inapp", to: { userId: "u", phone: "+243810000001" }, ...base });
  assert.deepEqual(inapp, { status: "logged" });
});
