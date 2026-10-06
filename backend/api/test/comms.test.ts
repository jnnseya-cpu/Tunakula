import { test } from "node:test";
import assert from "node:assert/strict";
import { planChannels, renderSubject, resolveEvent } from "../src/modules/comms/dispatch-core.ts";
import type { CommsChannel } from "@tunakula/ts-contracts/comms";

test("renderSubject fills known tokens and leaves unknown ones visible", () => {
  assert.equal(renderSubject("Commande {{order}} livrée", { order: "A12" }), "Commande A12 livrée");
  assert.equal(renderSubject("Votre code : {{code}}", { code: 4821 }), "Votre code : 4821");
  assert.equal(renderSubject("Bonjour {{name}}", {}), "Bonjour {{name}}");
});

test("resolveEvent returns a known event and throws on an unknown key", () => {
  assert.equal(resolveEvent("order.delivered").severity, "success");
  assert.throws(() => resolveEvent("nope.not_real"), /Unknown communication event/);
});

test("planChannels suppresses opted-out channels for a normal event", () => {
  const event = resolveEvent("promo.coupon_granted"); // not mandatory, has email/inapp/push
  const plan = planChannels(event, new Set<CommsChannel>(["email", "push"]));
  const byChannel = Object.fromEntries(plan.map((p) => [p.channel, p.suppressed]));
  assert.equal(byChannel.email, true, "email opted out");
  assert.equal(byChannel.push, true, "push opted out");
  assert.equal(byChannel.inapp, false, "in-app never opted out here");
});

test("a mandatory event ignores opt-outs entirely", () => {
  const event = resolveEvent("payment.failed"); // mandatory, email/inapp/sms
  const plan = planChannels(event, new Set<CommsChannel>(["email", "sms", "inapp"]));
  assert.ok(plan.every((p) => p.suppressed === false), "mandatory notice reaches every channel");
});
