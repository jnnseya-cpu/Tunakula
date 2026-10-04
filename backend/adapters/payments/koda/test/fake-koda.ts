/** In-memory KODA following the documented sandbox magic references. */
import { createHmac } from "node:crypto";
import type { HttpRequest, HttpResponse, HttpTransport } from "@tunakula/payment-http";

interface Intent {
  intent_id: string;
  status: string;
  amount: number;
  currency: string;
  verified_at?: string;
  usedCodes: Set<string>;
}

export class FakeKoda {
  readonly webhookSecret = "koda_whsec_test";
  readonly intents = new Map<string, Intent>();
  readonly requests: HttpRequest[] = [];
  readonly #used = new Set<string>();
  #n = 0;
  acuEmpty = false;
  today = "2026-10-04";

  transport: HttpTransport = async (req) => {
    this.requests.push(req);
    if (!req.headers?.["Authorization"]?.startsWith("Bearer sk_test_")) return { status: 401, headers: {}, body: { error: { code: "unauthorized" } } };
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (req.method === "POST" && req.path === "/intents") {
      if (this.acuEmpty) return { status: 402, headers: {}, body: { error: { code: "acu_exhausted" } } };
      const intent: Intent = { intent_id: `int_${++this.#n}`, status: "awaiting", amount: b["amount"] as number, currency: b["currency"] as string, usedCodes: new Set() };
      this.intents.set(intent.intent_id, intent);
      return ok({ intent_id: intent.intent_id, client_secret: `cs_${this.#n}`, checkout_url: `https://kodajnn.com/pay/${intent.intent_id}?cs=cs_${this.#n}`, status: "awaiting" });
    }
    const v = /^\/intents\/([^/]+)\/verify$/.exec(req.path);
    if (req.method === "POST" && v) return this.#verify(v[1] as string, b["reference"] as string);
    const c = /^\/intents\/([^/]+)\/cancel$/.exec(req.path);
    if (req.method === "POST" && c) {
      const i = this.intents.get(c[1] as string);
      if (!i || i.status !== "awaiting") return { status: 409, headers: {}, body: { error: { code: "not_awaiting" } } };
      i.status = "cancelled";
      return ok({ intent_id: i.intent_id, status: "cancelled" });
    }
    const g = /^\/intents\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && g) {
      const i = this.intents.get(g[1] as string);
      return i ? ok({ intent_id: i.intent_id, status: i.status }) : { status: 404, headers: {}, body: { error: { code: "not_found" } } };
    }
    if (req.method === "GET" && req.path === "/receipts") {
      const from = req.query?.["from"] ?? "";
      const data = [...this.intents.values()].filter((i) => i.verified_at?.startsWith(from)).map((i) => ({ intent_id: i.intent_id, amount: i.amount, currency: i.currency, verified_at: i.verified_at }));
      return ok({ data });
    }
    return { status: 404, headers: {}, body: { error: { code: "not_found" } } };
  };

  #verify(id: string, reference: string): HttpResponse {
    const i = this.intents.get(id);
    if (!i) return { status: 404, headers: {}, body: { error: { code: "not_found" } } };
    if (reference === "TEST-REPLAY" || this.#used.has(reference)) return { status: 409, headers: {}, body: { error: { code: "code_already_used" } } };
    if (reference === "TEST-SUFFIX") return { status: 409, headers: {}, body: { error: { code: "msisdn_suffix_mismatch" } } };
    if (reference === "TEST-LATE-90") {
      i.status = "verifying";
      return ok({ intent_id: id, status: "verifying" });
    }
    if (reference === `TEST-OK-${i.amount}`) {
      this.#used.add(reference + id);
      i.status = "verified";
      i.verified_at = `${this.today}T12:00:00Z`;
      return ok({ intent_id: id, status: "verified" });
    }
    return { status: 422, headers: {}, body: { error: { code: "no_match" } } };
  }

  /** Completes a TEST-LATE-90 verification and returns the late webhook. */
  completeLate(id: string) {
    const i = this.intents.get(id) as Intent;
    i.status = "verified";
    i.verified_at = `${this.today}T12:01:30Z`;
    return this.signed({ id: `evt_${++this.#n}`, type: "payment.verified.late", created_at: i.verified_at, data: { intent_id: id, status: "verified" } });
  }

  signed(event: unknown) {
    const body = JSON.stringify(event);
    return { headers: { "x-koda-signature": createHmac("sha256", this.webhookSecret).update(body).digest("hex") }, body };
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, headers: {}, body });
