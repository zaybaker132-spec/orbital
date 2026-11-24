import { Router } from "express";
import * as z from "zod/v4";
import { config } from "../config.js";
import { ah, HttpError, parse } from "../lib/http.js";
import { requireUser } from "../auth/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { activateLicense, getPlan, licenseKey, removeLicense } from "../lib/plan.js";
import { PRICES, PRO_FEATURES, TRIAL_DAYS } from "../../shared/plans.js";

/** Orbital Pro: where you stand (trial, Pro, free), adding a license key, managing the subscription. */
export const plan = Router();
plan.use("/plan", requireUser);

plan.get("/plan", ah(async (_req, res) => {
  const p = await getPlan();
  const url = config.billing.licenseUrl;
  res.json({
    ...p, trialDays: TRIAL_DAYS, features: PRO_FEATURES, prices: PRICES,
    // The purchase pages: Stripe Checkout, opened in the person's browser.
    buyUrl: p.enabled ? { monthly: `${url}/buy?plan=monthly`, yearly: `${url}/buy?plan=yearly` } : null,
  });
}));

plan.post("/plan/activate", rateLimit({ windowMs: 60 * 60_000, max: 20, key: "user", name: "license" }), ah(async (req, res) => {
  if (!config.billing.enabled) throw new HttpError(400, "Plans aren't used on this server.", "billing_off");
  const { key } = parse(z.object({ key: z.string().trim().min(1).max(200) }), req.body);
  res.json(await activateLicense(key));
}));

/** Stripe's page to change plan, update the card, see invoices or cancel. */
plan.post("/plan/manage", rateLimit({ windowMs: 60 * 60_000, max: 20, key: "user", name: "license" }), ah(async (_req, res) => {
  const key = await licenseKey();
  if (!key) throw new HttpError(400, "There's no subscription on this computer yet.", "no_license");
  let r: Response;
  try { r = await fetch(`${config.billing.licenseUrl}/portal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(15_000) }); }
  catch { throw new HttpError(502, "Couldn't reach Orbital's license service. Check your internet connection and try again.", "license_unreachable"); }
  const body = await r.json().catch(() => ({})) as any;
  if (!r.ok || typeof body.url !== "string" || !body.url.startsWith("https://")) throw new HttpError(502, body.error || "Couldn't open subscription management. Try again in a few minutes.", "license_unreachable");
  res.json({ url: body.url });
}));

plan.delete("/plan/license", ah(async (_req, res) => {
  await removeLicense();
  res.json(await getPlan());
}));
