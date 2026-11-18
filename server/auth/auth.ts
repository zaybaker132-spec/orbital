import crypto from "node:crypto";
import { promisify } from "node:util";
import type { RequestHandler, Response } from "express";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const COOKIE = "orbital_session";

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(res: Response, userId: string, userAgent?: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400_000);
  await db().query("INSERT INTO sessions(id, user_id, expires_at, user_agent) VALUES ($1,$2,$3,$4)", [sha256(token), userId, expires, userAgent?.slice(0, 300) ?? null]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, expires, path: "/" });
}

export async function destroySession(token: string | undefined, res: Response) {
  if (token) await db().query("DELETE FROM sessions WHERE id=$1", [sha256(token)]);
  res.clearCookie(COOKIE, { path: "/" });
}

/** Attaches req.user when a valid session cookie is present. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const r = await db().query<{ id: string; email: string; display_name: string }>(
        `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.expires_at > now()`,
        [sha256(token)],
      );
      const u = r.rows[0];
      if (u) req.user = { id: u.id, email: u.email, displayName: u.display_name };
    }
    next();
  } catch (e) {
    next(e);
  }
};

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "Not authenticated", "unauthenticated"));
  next();
};

/**
 * CSRF defence: state-changing requests must carry a custom header. Browsers cannot attach
 * custom headers cross-origin without a CORS preflight, which this server never approves.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-orbital-request") !== "1") return next(new HttpError(403, "Missing request header", "csrf"));
  next();
};
