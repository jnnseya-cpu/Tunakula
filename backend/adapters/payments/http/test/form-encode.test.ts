/**
 * The form-urlencoded wire format Stripe (and other Rails/PHP-style APIs) require.
 * fetchTransport must send `application/x-www-form-urlencoded` — not JSON — when a
 * request sets `form: true`, so the Stripe connector reaches the real API.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchTransport, formEncode } from "../src/index.ts";

test("formEncode uses bracket notation for nested objects and arrays", () => {
  const encoded = formEncode({
    amount: 2050,
    currency: "usd",
    confirm: true,
    description: "Order #7",
    "metadata[tunakula_intent_id]": "int_123",
    payment_method_types: ["card"],
    shipping: { name: "Amina K.", address: { country: "CD" } },
  });
  const params = new URLSearchParams(encoded);
  assert.equal(params.get("amount"), "2050");
  assert.equal(params.get("currency"), "usd");
  assert.equal(params.get("confirm"), "true", "booleans serialise as true/false, not 1/0");
  assert.equal(params.get("description"), "Order #7");
  assert.equal(params.get("metadata[tunakula_intent_id]"), "int_123", "pre-bracketed keys pass through unchanged");
  assert.equal(params.get("payment_method_types[0]"), "card", "arrays index with brackets");
  assert.equal(params.get("shipping[name]"), "Amina K.");
  assert.equal(params.get("shipping[address][country]"), "CD", "deep nesting keeps nesting");
});

test("formEncode omits undefined and null", () => {
  const params = new URLSearchParams(formEncode({ a: 1, b: undefined, c: null, d: "" }));
  assert.equal(params.get("a"), "1");
  assert.equal(params.has("b"), false);
  assert.equal(params.has("c"), false);
  assert.equal(params.get("d"), "", "an empty string is still sent");
});

test("fetchTransport sends form bodies with the urlencoded content type", async () => {
  let captured: { body?: unknown; contentType?: string | undefined } = {};
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured = { body: init?.body, contentType: headers.get("Content-Type") ?? undefined };
    return new Response(JSON.stringify({ id: "pi_1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const http = fetchTransport({ connectorId: "stripe", baseUrl: "https://api.stripe.com/v1", fetchImpl });
  const res = await http({ method: "POST", path: "/payment_intents", body: { amount: 2050, currency: "usd", confirm: true }, form: true });
  assert.equal(res.status, 200);
  assert.equal(captured.contentType, "application/x-www-form-urlencoded");
  assert.equal(captured.body, "amount=2050&currency=usd&confirm=true");
});

test("fetchTransport still defaults to JSON when form is not set", async () => {
  let captured: { body?: unknown; contentType?: string | undefined } = {};
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured = { body: init?.body, contentType: headers.get("Content-Type") ?? undefined };
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const http = fetchTransport({ connectorId: "bitripay", baseUrl: "https://pay.example", fetchImpl });
  await http({ method: "POST", path: "/charges", body: { amount: 10 } });
  assert.equal(captured.contentType, "application/json");
  assert.equal(captured.body, JSON.stringify({ amount: 10 }));
});
