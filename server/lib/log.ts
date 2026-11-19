import { config } from "../config.js";
import { currentContext } from "./context.js";

/**
 * Structured logging. In production each event is one JSON line (timestamp, level, message, request id,
 * user and workspace ids, plus fields), ready for any log platform. Never log secrets, passwords,
 * tokens, request bodies, email addresses or document contents: pass ids and counts, not content.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : process.env.NODE_ENV === "test" ? "warn" : "info";

/** Keys whose values are never written, wherever they appear. */
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session/i;
/** Secrets that can turn up inside text (error messages, URLs): API keys, bearer tokens, passwords in connection strings. */
const SECRET_VALUE = /\b(sk-ant-[\w-]{8,}|sk-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_]{16,}|sb_(secret|publishable)_[\w-]+|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)|(Bearer\s+)[^\s"']+|(:\/\/[^:\/\s@]+:)[^@\s]+@/g;
export const redact = (s: string) => s.replace(SECRET_VALUE, (_m, key, _p, bearer, cred) => key ? "[redacted]" : bearer ? `${bearer}[redacted]` : `${cred}[redacted]@`);
function scrub(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redact(v.length > 2000 ? `${v.slice(0, 2000)}…` : v);
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (v instanceof Error) return { name: v.name, message: redact(v.message), stack: config.logFormat === "json" ? v.stack?.split("\n").slice(0, 8).map(redact).join("\n") : undefined };
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(x, depth + 1);
  return out;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[minLevel]) return;
  const ctx = currentContext();
  const rec = { t: new Date().toISOString(), level, msg: redact(msg), ...(ctx ? { req: ctx.requestId, user: ctx.userId, ws: ctx.workspaceId, feature: ctx.feature } : {}), ...(scrub(fields) as object) };
  if (config.logFormat === "json") {
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(JSON.stringify(rec) + "\n");
  } else {
    const extra = Object.entries(rec).filter(([k, v]) => !["t", "level", "msg"].includes(k) && v !== undefined).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
    const line = `[${level}] ${msg}${extra ? `  ${extra}` : ""}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  }
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => { write("error", msg, f); void alert(msg, f); },
};

/**
 * Operational alerts to a Slack-compatible webhook, at most one per kind of problem every 10 minutes
 * so an outage doesn't flood the channel. Message and ids only; no user content.
 */
const lastAlert = new Map<string, number>();
async function alert(msg: string, f?: Record<string, unknown>) {
  if (!config.alertWebhook || process.env.NODE_ENV === "test") return;
  const now = Date.now();
  if (now - (lastAlert.get(msg) ?? 0) < 10 * 60_000) return;
  lastAlert.set(msg, now);
  const ctx = currentContext();
  const detail = f?.err instanceof Error ? f.err.message : typeof f?.error === "string" ? f.error : "";
  try {
    await fetch(config.alertWebhook, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ text: `Orbital alert: ${msg}${detail ? ` (${detail.slice(0, 300)})` : ""}${ctx ? ` [request ${ctx.requestId}${ctx.feature ? `, ${ctx.feature}` : ""}]` : ""}` }),
    });
  } catch { /* alerts must never break the app */ }
}
