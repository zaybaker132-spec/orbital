import { Router, type Request } from "express";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { ah, HttpError, isUuid, parse } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { linkBase } from "../lib/authEvents.js";
import { layout, sendEmail } from "../lib/email.js";
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
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address")),
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
  /** Explicit permission to email them about Orbital (recorded with the wording they agreed to). */
  consent: z.literal(true, "Agree to hear from us about Orbital to join the waitlist"),
}).refine((e) => e.remember.length > 0 || e.rememberOther.length > 0, { message: "Pick at least one thing for Orbital to compound, or tell us", path: ["remember"] });

export const CONSENT_TEXT = "Email me about my Orbital access and product updates. I can unsubscribe any time.";

waitlistPublic.post("/waitlist", rateLimit({ windowMs: 60 * 60_000, max: 8, key: "ip", name: "waitlist" }), ah(async (req, res) => {
  const e = parse(Entry, req.body);
  if (e.website) return res.status(201).json({ ok: true, position: null, confirmation: "skipped" }); // quietly drop bots
  // Re-joining with the same email updates the answers, unless that address was already confirmed by its
  // owner: then nobody else can rewrite them by typing the address.
  const r = await db().query<{ created_at: string; token: string; confirmed_at: string | null }>(
    `INSERT INTO waitlist(email, persona, remember, remember_other, scale, ai_tools, notes_apps, computers, devices, heard_from, discord, instagram, tiktok, compound, ip_hash, user_agent, consent_at, consent_text, token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now(), $17, $18)
     ON CONFLICT (email) DO UPDATE SET persona=EXCLUDED.persona, remember=EXCLUDED.remember, remember_other=EXCLUDED.remember_other, scale=EXCLUDED.scale,
       ai_tools=EXCLUDED.ai_tools, notes_apps=EXCLUDED.notes_apps, computers=EXCLUDED.computers, devices=EXCLUDED.devices, heard_from=EXCLUDED.heard_from,
       discord=EXCLUDED.discord, instagram=EXCLUDED.instagram, tiktok=EXCLUDED.tiktok, compound=EXCLUDED.compound, updated_at=now(),
       consent_at=now(), consent_text=EXCLUDED.consent_text, unsubscribed_at=NULL, token=COALESCE(waitlist.token, EXCLUDED.token)
     WHERE waitlist.confirmed_at IS NULL
     RETURNING created_at, token, confirmed_at`,
    [e.email, e.persona, e.remember, e.rememberOther, e.scale, e.aiTools, e.notesApps, e.computers, e.devices, e.heardFrom,
     e.discord, e.instagram, e.tiktok, e.compound, sha256(`waitlist:${req.ip}`).slice(0, 24), (req.get("user-agent") ?? "").slice(0, 300), CONSENT_TEXT, randomToken(24)],
  );
  const row = r.rows[0] ?? (await db().query<any>("SELECT created_at, token, confirmed_at FROM waitlist WHERE email=$1", [e.email])).rows[0];
  // Compared inside the database: a timestamp sent back from JavaScript loses its microseconds (Postgres).
  const pos = await db().query<{ n: number }>("SELECT count(*)::int AS n FROM waitlist WHERE created_at <= (SELECT created_at FROM waitlist WHERE email=$1)", [e.email]);
  // Ask the person to confirm the address (also proves the sign-up was theirs). Already confirmed: nothing to send.
  let confirmation: "sent" | "already_confirmed" | "not_configured" | "failed" = "already_confirmed";
  if (!row.confirmed_at) {
    const base = linkBase(req);
    if (!base) confirmation = "not_configured";
    else {
      const sent = await sendEmail("waitlist_confirm", e.email, {
        subject: "Confirm your spot on the Orbital waitlist",
        unsubscribeUrl: `${base}/api/public/waitlist/unsubscribe?token=${row.token}`,
        ...layout({
          heading: "Confirm your spot",
          paragraphs: ["Thanks for joining the Orbital waitlist. Confirm this is your address so we can let you know when your access is ready."],
          button: { label: "Confirm my email", url: `${base}/api/public/waitlist/confirm?token=${row.token}` },
          footer: `You're getting this because this address joined the waitlist. Not you, or changed your mind? Unsubscribe: ${base}/api/public/waitlist/unsubscribe?token=${row.token}`,
        }),
      });
      confirmation = sent.status === "sent" ? "sent" : sent.status === "skipped" ? "not_configured" : "failed";
    }
  }
  res.status(201).json({ ok: true, position: pos.rows[0].n, confirmation });
}));

const tokenParam = (v: unknown) => (typeof v === "string" && /^[\w-]{20,64}$/.test(v) ? v : null);
const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font-family:-apple-system,Segoe UI,Inter,sans-serif"><div style="max-width:420px;padding:24px;text-align:center"><div style="letter-spacing:.3em;font-size:12px;color:#888">ORBITAL</div><h1 style="font-weight:300;font-size:24px">${title}</h1><p style="color:#aaa;line-height:1.5">${body}</p><p><a href="/waitlist" style="color:#fff">Back to Orbital</a></p></div></body>`;

/** The confirm link in the email. */
waitlistPublic.get("/waitlist/confirm", rateLimit({ windowMs: 60 * 60_000, max: 60, key: "ip", name: "waitlist-link" }), ah(async (req, res) => {
  const token = tokenParam(req.query.token);
  const r = token ? await db().query("UPDATE waitlist SET confirmed_at = COALESCE(confirmed_at, now()), updated_at=now() WHERE token=$1 RETURNING id", [token]) : { rows: [] };
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
  if (!r.rows.length) return res.status(404).type("html").send(page("Link not recognised", "This confirmation link isn't valid any more. Join the waitlist again to get a new one."));
  res.type("html").send(page("You're confirmed", "Your spot on the Orbital waitlist is confirmed. We'll email you when your access is ready."));
}));

/** Unsubscribe: the link in every email (GET), and mail apps' one-click unsubscribe (POST, RFC 8058). */
const unsubscribe = ah(async (req, res) => {
  const token = tokenParam(req.query.token);
  const r = token ? await db().query("UPDATE waitlist SET unsubscribed_at = COALESCE(unsubscribed_at, now()), updated_at=now() WHERE token=$1 RETURNING id", [token]) : { rows: [] };
  if (req.method === "POST") return res.status(r.rows.length ? 200 : 404).json({ ok: r.rows.length > 0 });
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
  if (!r.rows.length) return res.status(404).type("html").send(page("Link not recognised", "This unsubscribe link isn't valid."));
  res.type("html").send(page("You're unsubscribed", "We won't email you about the Orbital waitlist again."));
});
waitlistPublic.get("/waitlist/unsubscribe", rateLimit({ windowMs: 60 * 60_000, max: 60, key: "ip", name: "waitlist-link" }), unsubscribe);
waitlistPublic.post("/waitlist/unsubscribe", rateLimit({ windowMs: 60 * 60_000, max: 60, key: "ip", name: "waitlist-link" }), unsubscribe);

/** Signed-in server admins only (ORBITAL_ADMIN_EMAILS). */
export const waitlistAdmin = Router();
const requireServerAdmin = (req: Request) => {
  if (!req.user || !config.adminEmails.includes(req.user.email.toLowerCase())) throw new HttpError(403, "Only server admins can see the waitlist.", "forbidden");
};
export const isServerAdmin = (email?: string) => !!email && config.adminEmails.includes(email.toLowerCase());

const COLS = "id, admitted_at, consent_at, confirmed_at, unsubscribed_at, email, persona, remember, remember_other, scale, ai_tools, notes_apps, computers, devices, heard_from, discord, instagram, tiktok, compound, created_at";

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
  if (!isUuid(req.params.id)) throw new HttpError(400, "Invalid id", "invalid_input");
  const r = await db().query<any>("UPDATE waitlist SET admitted_at = $2, updated_at = now() WHERE id = $1 RETURNING email, admitted_at, unsubscribed_at, token", [req.params.id, on ? new Date() : null]);
  if (!r.rows.length) throw new HttpError(404, "Not on the waitlist", "not_found");
  const w = r.rows[0];
  // Tell them they're in, unless they unsubscribed. The admin sees whether the email really went out.
  let email: "sent" | "unsubscribed" | "not_configured" | "failed" | null = null;
  if (on) {
    const base = linkBase(req);
    if (w.unsubscribed_at) email = "unsubscribed";
    else if (!base) email = "not_configured";
    else {
      const sent = await sendEmail("waitlist_admitted", w.email, {
        subject: "You're in: your Orbital access is ready",
        unsubscribeUrl: w.token ? `${base}/api/public/waitlist/unsubscribe?token=${w.token}` : undefined,
        ...layout({
          heading: "Your Orbital is ready",
          paragraphs: ["Good news: you're off the waitlist. Create your account with this email address to start."],
          button: { label: "Create my account", url: `${base}/login` },
          footer: "You're getting this because you joined the Orbital waitlist.",
        }),
      });
      email = sent.status === "sent" ? "sent" : sent.status === "skipped" ? "not_configured" : "failed";
    }
  }
  res.json({ email: w.email, admitted_at: w.admitted_at, notification: email });
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
