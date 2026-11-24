import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JavaScript (it runs on Cloudflare)
import worker, { makeKey, readKey } from "../../license-server/worker.js";

// The license service (license-server/worker.js) against a fake Stripe: checkout, the key it hands
// out, verification (paid, cancelled, tampered), and the manage-subscription link.
const env = { STRIPE_SECRET_KEY: "sk_test_fake", LICENSE_SECRET: "a-long-random-secret-for-tests-only", PRICE_MONTHLY: "price_month", PRICE_YEARLY: "price_year", SITE_URL: "https://orbitalai.us" };
const subs: Record<string, any> = {
  sub_PAID12345: { id: "sub_PAID12345", status: "active", customer: "cus_1", cancel_at_period_end: false, items: { data: [{ price: { recurring: { interval: "year" } }, current_period_end: 1893456000 }] } },
  sub_GONE12345: { id: "sub_GONE12345", status: "canceled", customer: "cus_2", cancel_at_period_end: false, items: { data: [{ price: { recurring: { interval: "month" } }, current_period_end: 1700000000 }] } },
};
const calls: { method: string; path: string; body: string; auth: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname !== "api.stripe.com") return realFetch(input, init);
  calls.push({ method: init.method ?? "GET", path: u.pathname, body: String(init.body ?? ""), auth: init.headers?.authorization ?? "" });
  const ok = (d: any) => new Response(JSON.stringify(d), { status: 200 });
  if (u.pathname === "/v1/checkout/sessions" && init.method === "POST") return ok({ id: "cs_test_abcdefghijk", url: "https://checkout.stripe.com/c/pay/cs_test_abcdefghijk" });
  if (u.pathname === "/v1/checkout/sessions/cs_test_abcdefghijk") return ok({ id: "cs_test_abcdefghijk", status: "complete", subscription: "sub_PAID12345" });
  if (u.pathname === "/v1/checkout/sessions/cs_test_unfinished") return ok({ status: "open", subscription: null });
  const m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname);
  if (m) return subs[m[1]] ? ok(subs[m[1]]) : new Response(JSON.stringify({ error: { message: "No such subscription" } }), { status: 404 });
  if (u.pathname.startsWith("/v1/customers/")) return ok({ email: "buyer@example.com" });
  if (u.pathname === "/v1/billing_portal/sessions") return ok({ url: "https://billing.stripe.com/p/session/test_123" });
  return new Response("{}", { status: 404 });
}) as any;

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://license.orbitalai.us${path}`, init), env);
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("license service: checkout, key, verify, manage", async () => {
  // Checkout: monthly by default, yearly on request, coming back to /success.
  const buy = await call("/buy?plan=yearly");
  assert.equal(buy.status, 303);
  assert.equal(buy.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_abcdefghijk");
  const created = calls.find((c) => c.path === "/v1/checkout/sessions")!;
  assert.equal(created.auth, "Bearer sk_test_fake");
  const params = new URLSearchParams(created.body);
  assert.equal(params.get("mode"), "subscription");
  assert.equal(params.get("line_items[0][price]"), "price_year");
  assert.equal(params.get("success_url"), "https://license.orbitalai.us/success?session_id={CHECKOUT_SESSION_ID}");

  // Success page: shows the key and an "Activate in Orbital" link.
  const page = await (await call("/success?session_id=cs_test_abcdefghijk")).text();
  const key = await makeKey(env.LICENSE_SECRET, "sub_PAID12345");
  assert.ok(page.includes(key));
  assert.ok(page.includes(`orbital://activate?key=${encodeURIComponent(key)}`));
  assert.match(await (await call("/success?session_id=cs_test_unfinished")).text(), /isn't finished/);
  assert.match(await (await call("/success?session_id=<script>")).text(), /isn't complete/);

  // Verify: paid → active with the period end; cancelled → inactive; forged/tampered → rejected.
  const good = await (await post("/verify", { key })).json() as any;
  assert.deepEqual(good, { active: true, status: "active", plan: "yearly", email: "buyer@example.com", periodEnd: 1893456000, cancelAtPeriodEnd: false });
  const gone = await (await post("/verify", { key: await makeKey(env.LICENSE_SECRET, "sub_GONE12345") })).json() as any;
  assert.equal(gone.active, false);
  assert.equal(gone.status, "canceled");
  const forged = await makeKey("someone-elses-secret", "sub_PAID12345");
  assert.equal((await post("/verify", { key: forged })).status, 400, "a key signed with another secret is refused");
  assert.equal((await post("/verify", { key: key.slice(0, -1) + (key.endsWith("A") ? "B" : "A") })).status, 400, "tampered signature");
  assert.equal((await post("/verify", { key: "ORB-hello" })).status, 400);
  assert.equal(await readKey(env.LICENSE_SECRET, key), "sub_PAID12345");
  assert.equal((await post("/verify", { key: await makeKey(env.LICENSE_SECRET, "sub_UNKNOWN99") })).status, 404);

  // Manage subscription: Stripe's portal for that customer.
  const portal = await (await post("/portal", { key })).json() as any;
  assert.equal(portal.url, "https://billing.stripe.com/p/session/test_123");
  assert.equal(new URLSearchParams(calls.at(-1)!.body).get("customer"), "cus_1");
  assert.equal((await post("/portal", { key: forged })).status, 400);

  // Not configured: a clear error, nothing sent to Stripe.
  const before = calls.length;
  assert.equal((await worker.fetch(new Request("https://x/verify", { method: "POST", body: "{}" }), {})).status, 503);
  assert.equal(calls.length, before);
});
