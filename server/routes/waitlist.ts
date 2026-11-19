import { Router, type Request } from "express";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { ah, HttpError, parse } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { sha256 } from "../lib/crypto.js";
import { AI_TOOLS, COMPUTERS, DEVICES, HEARD_FROM, MAX_RANKED, NOTES_APPS, PERSONAS, REMEMBER, SCALE } from "../../shared/waitlist.js";

/** Public waitlist: no account needed. Mounted before the signed-in API. */
export const waitlistPublic = Router();

const handle = (max: number) => z.string().trim().max(max + 1).transform((s) => s.replace(/^@/, "")).pipe(z.string().regex(/^[A-Za-z0-9_.]*$/, "Use letters, numbers, dots or underscores").max(max));
const many = <T extends readonly [string, ...string[]]>(opts: T, label: string) =>
  z.array(z.enum(opts)).min(1, `Pick at least one: ${label}`).max(opts.length).refine((a) => new Set(a).size === a.length, "Duplicate choice");
/** Ranked picks ("main one first, then up to two more"); "None" stands alone. */
const ranked = <T extends readonly [string, ...string[]]>(opts: T, label: string) =>
  many(opts, label).refine((a) => a.length <= MAX_RANKED, `Pick at most ${MAX_RANKED}`).refine((a) => !a.includes("None") || a.length === 1, "“None” can't be combined with other choices");

const Entry = z.object({
  email: z.email("Enter a valid email address").max(200).transform((e) => e.toLowerCase().trim()),
  persona: z.enum(PERSONAS, "Tell us what you are"),
  remember: z.array(z.enum(REMEMBER)).max(REMEMBER.length).default([]),
  rememberOther: z.string().trim().max(200).default(""),
  scale: z.enum(SCALE, "Pick who it's for"),
  aiTools: many(AI_TOOLS, "AI tools"),
  notesApps: many(NOTES_APPS, "where you keep notes"),
  computers: ranked(COMPUTERS, "computers"),
  devices: ranked(DEVICES, "phones or tablets"),
  heardFrom: z.enum(HEARD_FROM, "Tell us how you heard about Orbital"),
  discord: handle(37).default(""),
  instagram: handle(30).default(""),
  tiktok: handle(30).default(""),
  compound: z.string().trim().max(500).default(""),
  /** Spam trap: hidden from people, filled by bots. */
  website: z.string().max(200).default(""),
}).refine((e) => e.remember.length > 0 || e.rememberOther.length > 0, { message: "Pick at least one thing for Orbital to compound, or tell us", path: ["remember"] });

waitlistPublic.post("/waitlist", rateLimit({ windowMs: 60 * 60_000, max: 8, key: "ip", name: "waitlist" }), ah(async (req, res) => {
  const e = parse(Entry, req.body);
  if (e.website) return res.status(201).json({ ok: true, position: null }); // quietly drop bots
  const r = await db().query<{ created_at: string }>(
    `INSERT INTO waitlist(email, persona, remember, remember_other, scale, ai_tools, notes_apps, computers, devices, heard_from, discord, instagram, tiktok, compound, ip_hash, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (email) DO UPDATE SET persona=EXCLUDED.persona, remember=EXCLUDED.remember, remember_other=EXCLUDED.remember_other, scale=EXCLUDED.scale,
       ai_tools=EXCLUDED.ai_tools, notes_apps=EXCLUDED.notes_apps, computers=EXCLUDED.computers, devices=EXCLUDED.devices, heard_from=EXCLUDED.heard_from,
       discord=EXCLUDED.discord, instagram=EXCLUDED.instagram, tiktok=EXCLUDED.tiktok, compound=EXCLUDED.compound, updated_at=now()
     RETURNING created_at`,
    [e.email, e.persona, e.remember, e.rememberOther, e.scale, e.aiTools, e.notesApps, e.computers, e.devices, e.heardFrom,
     e.discord, e.instagram, e.tiktok, e.compound, sha256(`waitlist:${req.ip}`).slice(0, 24), (req.get("user-agent") ?? "").slice(0, 300)],
  );
  const pos = await db().query<{ n: number }>("SELECT count(*)::int AS n FROM waitlist WHERE created_at <= $1", [r.rows[0].created_at]);
  res.status(201).json({ ok: true, position: pos.rows[0].n });
}));

/** Signed-in server admins only (ORBITAL_ADMIN_EMAILS). */
export const waitlistAdmin = Router();
const requireServerAdmin = (req: Request) => {
  if (!req.user || !config.adminEmails.includes(req.user.email.toLowerCase())) throw new HttpError(403, "Only server admins can see the waitlist.", "forbidden");
};
export const isServerAdmin = (email?: string) => !!email && config.adminEmails.includes(email.toLowerCase());

const COLS = "id, admitted_at, email, persona, remember, remember_other, scale, ai_tools, notes_apps, computers, devices, heard_from, discord, instagram, tiktok, compound, created_at";

waitlistAdmin.get("/admin/waitlist", ah(async (req, res) => {
  requireServerAdmin(req);
  const rows = (await db().query(`SELECT ${COLS} FROM waitlist ORDER BY created_at DESC LIMIT 2000`)).rows;
  const tally = async (sql: string) => (await db().query<{ k: string; n: number }>(sql)).rows;
  res.json({
    total: Number((await db().query<{ n: number }>("SELECT count(*)::int n FROM waitlist")).rows[0].n),
    last7: Number((await db().query<{ n: number }>("SELECT count(*)::int n FROM waitlist WHERE created_at > now() - interval '7 days'")).rows[0].n),
    personas: await tally("SELECT persona AS k, count(*)::int AS n FROM waitlist GROUP BY 1 ORDER BY 2 DESC"),
    computers: await tally("SELECT computers[1] AS k, count(*)::int AS n FROM waitlist GROUP BY 1 ORDER BY 2 DESC"),
    sources: await tally("SELECT heard_from AS k, count(*)::int AS n FROM waitlist GROUP BY 1 ORDER BY 2 DESC"),
    rows,
    signupOpen: config.allowSignup,
  });
}));

/** Let someone in (or take it back): they can then create an account with the email they joined with. */
waitlistAdmin.post("/admin/waitlist/:id/admit", ah(async (req, res) => {
  requireServerAdmin(req);
  const on = req.body?.admit !== false;
  const r = await db().query("UPDATE waitlist SET admitted_at = $2, updated_at = now() WHERE id = $1 RETURNING email, admitted_at", [String(req.params.id), on ? new Date() : null]);
  if (!r.rows.length) throw new HttpError(404, "Not on the waitlist", "not_found");
  res.json(r.rows[0]);
}));

/** Who may create an account: anyone when sign-up is open; otherwise server admins and people let in from the waitlist. */
export async function maySignUp(email: string) {
  if (config.allowSignup || isServerAdmin(email)) return true;
  return (await db().query("SELECT 1 FROM waitlist WHERE lower(email) = lower($1) AND admitted_at IS NOT NULL", [email])).rows.length > 0;
}

const csvCell = (v: unknown) => {
  let s = Array.isArray(v) ? v.join("; ") : v instanceof Date ? v.toISOString() : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheet apps from evaluating cells as formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

waitlistAdmin.get("/admin/waitlist.csv", ah(async (req, res) => {
  requireServerAdmin(req);
  const rows = (await db().query(`SELECT ${COLS} FROM waitlist ORDER BY created_at`)).rows;
  const header = COLS.split(", ");
  const body = [header.join(","), ...rows.map((r: any) => header.map((h) => csvCell(r[h])).join(","))].join("\n");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="orbital-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
}));
