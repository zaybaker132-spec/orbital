import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { HttpError } from "./http.js";
import { log } from "./log.js";
import { LICENSE_KEY, PRO_FEATURES, TRIAL_DAYS, type PlanState, type ProFeature } from "../../shared/plans.js";

/**
 * Orbital Pro on the desktop app. A 14-day trial of everything starts the first time the app checks
 * (for an existing install: when it updates to a version with Pro, so nobody's trial is used up
 * already). After that, Pro features need an active license from the license service. A verified
 * license keeps working offline until the paid-for period ends, plus a few days' grace.
 */
const DAY = 86_400_000;
const GRACE_DAYS = 3;
const RECHECK_MS = DAY;

interface Row {
  trial_started_at: Date; license_key: string | null; license_plan: string | null; license_email: string | null; license_status: string | null;
  renews_at: Date | null; cancel_at_period_end: boolean; valid_until: Date | null; checked_at: Date | null;
}
async function row(): Promise<Row> {
  await db().query("INSERT INTO app_license(id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  return (await db().query<Row>("SELECT * FROM app_license WHERE id=1")).rows[0];
}

export interface Plan {
  enabled: boolean; state: PlanState; trialEndsAt: string | null; trialDaysLeft: number;
  license: null | { plan: string | null; email: string | null; status: string | null; renewsAt: string | null; cancelAtPeriodEnd: boolean; keyEnding: string; checkedAt: string | null };
}

export async function getPlan(): Promise<Plan> {
  if (!config.billing.enabled) return { enabled: false, state: "unlimited", trialEndsAt: null, trialDaysLeft: 0, license: null };
  const r = await row();
  const now = Date.now();
  const trialEnds = r.trial_started_at.getTime() + TRIAL_DAYS * DAY;
  const pro = !!r.license_key && !!r.valid_until && r.valid_until.getTime() > now;
  // Look again once a day in the background (renewals, cancellations); never blocks the app.
  if (r.license_key && (!r.checked_at || now - r.checked_at.getTime() > RECHECK_MS)) void refreshLicense().catch((e) => log.warn("license check failed", { err: e }));
  return {
    enabled: true,
    state: pro ? "pro" : now < trialEnds ? "trial" : "free",
    trialEndsAt: new Date(trialEnds).toISOString(),
    trialDaysLeft: Math.max(0, Math.ceil((trialEnds - now) / DAY)),
    license: r.license_key ? {
      plan: r.license_plan, email: r.license_email, status: r.license_status, renewsAt: r.renews_at?.toISOString() ?? null,
      cancelAtPeriodEnd: r.cancel_at_period_end, keyEnding: r.license_key.slice(-6), checkedAt: r.checked_at?.toISOString() ?? null,
    } : null,
  };
}

interface Verified { active: boolean; plan?: "monthly" | "yearly"; status?: string; email?: string | null; periodEnd?: number; cancelAtPeriodEnd?: boolean }

/** Ask the license service about a key. Throws a readable error if it can't be reached. */
async function verify(key: string): Promise<Verified> {
  let r: globalThis.Response;
  try {
    r = await fetch(`${config.billing.licenseUrl}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(15_000) });
  } catch { throw new HttpError(502, "Couldn't reach Orbital's license service. Check your internet connection and try again.", "license_unreachable"); }
  if (r.status === 400 || r.status === 404) return { active: false };
  if (!r.ok) throw new HttpError(502, "Orbital's license service isn't answering right now. Try again in a few minutes.", "license_unreachable");
  return (await r.json()) as Verified;
}

async function save(key: string, v: Verified) {
  const periodEnd = v.periodEnd ? v.periodEnd * 1000 : null;
  const validUntil = v.active && periodEnd ? new Date(periodEnd + GRACE_DAYS * DAY) : v.active ? new Date(Date.now() + 7 * DAY) : new Date(0);
  await db().query(
    `UPDATE app_license SET license_key=$1, license_plan=$2, license_email=$3, license_status=$4, renews_at=$5, cancel_at_period_end=$6,
       valid_until=$7, checked_at=now(), updated_at=now() WHERE id=1`,
    [key, v.plan ?? null, v.email ?? null, v.status ?? (v.active ? "active" : "inactive"), periodEnd ? new Date(periodEnd) : null, !!v.cancelAtPeriodEnd, validUntil]);
}

/** Add a license key (from the purchase page). Only an active subscription is accepted. */
export async function activateLicense(key: string) {
  const k = key.trim();
  if (!LICENSE_KEY.test(k)) throw new HttpError(400, "That doesn't look like an Orbital license key. It starts with ORB-.", "invalid_license");
  const v = await verify(k);
  if (!v.active) throw new HttpError(400, "That license key isn't active. If you've just paid, wait a minute and try again.", "inactive_license");
  await row();
  await save(k, v);
  return getPlan();
}

/** Re-check the saved key. If the service can't be reached, Pro carries on until valid_until. */
export async function refreshLicense() {
  const r = await row();
  if (!r.license_key) return;
  const v = await verify(r.license_key);
  // A key that's no longer active ends Pro now (cancelled and expired, refunded, payment failed for good).
  await save(r.license_key, v);
}

export async function removeLicense() {
  await row();
  await db().query("UPDATE app_license SET license_key=NULL, license_plan=NULL, license_email=NULL, license_status=NULL, renews_at=NULL, cancel_at_period_end=false, valid_until=NULL, checked_at=NULL, updated_at=now() WHERE id=1");
}

export async function licenseKey() { return (await row()).license_key; }

export class ProRequired extends HttpError {
  constructor(public feature: ProFeature) {
    super(402, `That's part of Orbital Pro (${PRO_FEATURES[feature].charAt(0).toLowerCase()}${PRO_FEATURES[feature].slice(1)}), and your free trial has ended. Upgrade in Settings → Plan to keep using it. Everything you've already made stays here.`, "pro_required");
  }
}
export async function assertPro(feature: ProFeature) {
  if (!config.billing.enabled) return;
  const p = await getPlan();
  if (p.state === "free") throw new ProRequired(feature);
}
/** Route guard for creating something with a Pro feature (reading what exists is always allowed). */
export const requirePro = (feature: ProFeature) => (_req: Request, _res: Response, next: NextFunction) => {
  assertPro(feature).then(() => next(), next);
};
