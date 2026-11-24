/**
 * Orbital license service: a Cloudflare Worker between the desktop app and Stripe.
 *
 *   GET  /buy?plan=monthly|yearly   → Stripe Checkout for Orbital Pro (redirect)
 *   GET  /success?session_id=…       → "Thanks" page with the license key and an "Activate in Orbital" button
 *   POST /verify   { key }           → { active, plan, status, email, periodEnd, cancelAtPeriodEnd }
 *   POST /portal   { key }           → { url } Stripe's page to update the card, switch plan or cancel
 *
 * A license key is the Stripe subscription id plus an HMAC signature (LICENSE_SECRET), so nothing
 * needs storing: /verify checks the signature, then asks Stripe whether the subscription is paid up.
 * Secrets (set with `wrangler secret put` or in the Cloudflare dashboard, never in code):
 *   STRIPE_SECRET_KEY, LICENSE_SECRET
 * Settings (plain variables): PRICE_MONTHLY, PRICE_YEARLY (Stripe price ids), SITE_URL, STRIPE_AUTOMATIC_TAX ("on" to let Stripe Tax add sales tax)
 */

const STRIPE = "https://api.stripe.com/v1";
const ACTIVE = new Set(["active", "trialing", "past_due"]); // past_due: Stripe is still retrying the card

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

async function sign(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`orbital-license:${text}`))).slice(0, 32);
}
export async function makeKey(secret, subscriptionId) {
  return `ORB-${b64url(new TextEncoder().encode(subscriptionId))}-${await sign(secret, subscriptionId)}`;
}
/** The subscription id inside a key, or null if the key is malformed or the signature is wrong. */
export async function readKey(secret, key) {
  const m = /^ORB-([A-Za-z0-9_-]{8,120})-([A-Za-z0-9_-]{16,64})$/.exec(String(key ?? "").trim());
  if (!m) return null;
  let sub;
  try { sub = fromB64url(m[1]); } catch { return null; }
  if (!/^sub_[A-Za-z0-9]{6,80}$/.test(sub)) return null;
  const expected = await sign(secret, sub);
  // Constant-time comparison.
  if (expected.length !== m[2].length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? sub : null;
}

async function stripe(env, method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch(`${STRIPE}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "GET" ? undefined : body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.message || `Stripe ${r.status}`); e.status = r.status; throw e; }
  return data;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function page(title, inner) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>:root{color-scheme:dark light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#ededf0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:520px;padding:32px 24px;text-align:center}
h1{font-weight:400;font-size:26px;margin:0 0 8px}p{color:#9a9aa3}.key{margin:22px 0 10px;padding:14px;border:1px solid #2a2a30;border-radius:12px;font:14px ui-monospace,Menlo,monospace;word-break:break-all;background:#0b0b0d;color:#fff}
.btn{display:inline-block;margin:6px;padding:11px 20px;border-radius:999px;border:1px solid #fff;background:#fff;color:#000;text-decoration:none;font-weight:500;cursor:pointer;font-size:14px}.ghost{background:transparent;color:#fff}
@media (prefers-color-scheme:light){body{background:#fff;color:#111}.key{background:#f5f5f7;border-color:#ddd;color:#111}.btn{background:#111;color:#fff;border-color:#111}.ghost{background:transparent;color:#111}p{color:#62626b}}</style></head>
<body><main>${inner}</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" } });
}

async function buy(url, env) {
  const plan = url.searchParams.get("plan") === "yearly" ? "yearly" : "monthly";
  const price = plan === "yearly" ? env.PRICE_YEARLY : env.PRICE_MONTHLY;
  if (!price) return json({ error: "This plan isn't set up yet." }, 503);
  const origin = url.origin;
  const params = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL || origin}/#pricing`,
    allow_promotion_codes: "true",
    "subscription_data[metadata][product]": "orbital-pro",
  };
  if (env.STRIPE_AUTOMATIC_TAX === "on") params["automatic_tax[enabled]"] = "true";
  const s = await stripe(env, "POST", "/checkout/sessions", params);
  return Response.redirect(s.url, 303);
}

async function success(url, env) {
  const id = url.searchParams.get("session_id") ?? "";
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) return page("Not found", "<h1>That link isn't complete</h1><p>Check your email receipt, or contact support.</p>");
  const s = await stripe(env, "GET", `/checkout/sessions/${id}`);
  if (s.status !== "complete" || !s.subscription) return page("Payment not finished", "<h1>The payment isn't finished</h1><p>If you were charged, wait a minute and refresh this page.</p>");
  const key = await makeKey(env.LICENSE_SECRET, typeof s.subscription === "string" ? s.subscription : s.subscription.id);
  const k = escape(key);
  return page("Welcome to Orbital Pro", `<h1>Welcome to Orbital Pro</h1>
<p>Thank you! Here's your license key. Keep it somewhere safe: you'll need it if you install Orbital on another computer.</p>
<div class="key" id="k">${k}</div>
<a class="btn" href="orbital://activate?key=${encodeURIComponent(key)}">Activate in Orbital</a>
<button class="btn ghost" onclick="navigator.clipboard.writeText(document.getElementById('k').textContent).then(()=>{this.textContent='Copied'})">Copy key</button>
<p style="margin-top:22px;font-size:13px">If the button doesn't open Orbital: open Orbital → Settings → Plan, paste the key and click Activate.</p>`);
}

async function verify(request, env) {
  const { key } = await request.json().catch(() => ({}));
  const sub = await readKey(env.LICENSE_SECRET, key);
  if (!sub) return json({ active: false, error: "Not a valid license key." }, 400);
  let s;
  try { s = await stripe(env, "GET", `/subscriptions/${sub}`); }
  catch (e) { if (e.status === 404) return json({ active: false, error: "No subscription for this key." }, 404); throw e; }
  const item = s.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  let email = null;
  if (typeof s.customer === "string") { try { email = (await stripe(env, "GET", `/customers/${s.customer}`)).email ?? null; } catch { /* optional */ } }
  return json({
    active: ACTIVE.has(s.status),
    status: s.status,
    plan: interval === "year" ? "yearly" : "monthly",
    email,
    // Newer Stripe API versions keep the period on the subscription item.
    periodEnd: s.current_period_end ?? item?.current_period_end ?? null,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
  });
}

async function portal(request, env, url) {
  const { key } = await request.json().catch(() => ({}));
  const sub = await readKey(env.LICENSE_SECRET, key);
  if (!sub) return json({ error: "Not a valid license key." }, 400);
  const s = await stripe(env, "GET", `/subscriptions/${sub}`);
  const p = await stripe(env, "POST", "/billing_portal/sessions", { customer: s.customer, return_url: env.SITE_URL || url.origin });
  return json({ url: p.url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!env.STRIPE_SECRET_KEY || !env.LICENSE_SECRET) return json({ error: "The license service isn't configured yet." }, 503);
      if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET", "access-control-allow-headers": "content-type" } });
      if (url.pathname === "/buy" && request.method === "GET") return await buy(url, env);
      if (url.pathname === "/success" && request.method === "GET") return await success(url, env);
      if (url.pathname === "/verify" && request.method === "POST") return await verify(request, env);
      if (url.pathname === "/portal" && request.method === "POST") return await portal(request, env, url);
      if (url.pathname === "/" ) return json({ ok: true, service: "orbital-license" });
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong with payments. Try again in a minute." }, 502);
    }
  },
};
