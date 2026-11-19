import type { Request } from "express";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { sha256 } from "./crypto.js";
import { HttpError } from "./http.js";

/**
 * Security events (sign-in, failed sign-in, password changes and resets, account deletion), recorded
 * without passwords or raw IP addresses. Failed sign-ins also throttle guessing against one account,
 * whatever IP addresses the attempts come from.
 */
export const emailHash = (email: string) => sha256(`email:${email.trim().toLowerCase()}`);

export async function authEvent(event: string, o: { req?: Request; userId?: string | null; email?: string }) {
  await db().query("INSERT INTO auth_events(user_id, email_hash, event, ip_hash, user_agent) VALUES ($1,$2,$3,$4,$5)", [
    o.userId ?? null, o.email ? emailHash(o.email) : "", event, o.req?.ip ? sha256(`ip:${o.req.ip}`).slice(0, 24) : "", (o.req?.get("user-agent") ?? "").slice(0, 300),
  ]).catch(() => { /* never block sign-in on event logging */ });
}

const FAILED_WINDOW_MIN = 15;
const FAILED_MAX = 8;
/** Refuse further attempts on an account after repeated failures in a short window. */
export async function assertNotLockedOut(email: string) {
  const r = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM auth_events WHERE email_hash=$1 AND event='login_failed' AND created_at > now() - make_interval(mins => $2)`, [emailHash(email), FAILED_WINDOW_MIN]);
  if (r.rows[0].n >= FAILED_MAX) throw new HttpError(429, `Too many sign-in attempts for this account. Try again in ${FAILED_WINDOW_MIN} minutes, or reset your password.`, "account_throttled");
}

/**
 * The base URL for links sent by email. Uses ORBITAL_PUBLIC_URL; the request's own Host header is
 * only trusted for local installs, because an attacker can forge it to point reset links at their site.
 */
export function linkBase(req: Request): string | null {
  if (config.publicUrl) return config.publicUrl;
  const host = req.get("host") ?? "";
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return `${req.protocol}://${host}`;
  return null;
}
