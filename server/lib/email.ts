import { config } from "../config.js";
import { db } from "../db/client.js";
import { sha256 } from "./crypto.js";
import { log } from "./log.js";

/**
 * Transactional email through Resend (https://resend.com). Configure RESEND_API_KEY and
 * ORBITAL_EMAIL_FROM (an address on a domain verified in Resend).
 *
 * The result always says what really happened: `sent` only when the provider accepted the message.
 * Without configuration nothing is sent and callers tell the person so; nothing pretends.
 * Every attempt is logged in `email_log` with the recipient hashed.
 */
export type EmailResult = { status: "sent"; id: string } | { status: "skipped"; reason: "not_configured" | "unsubscribed" } | { status: "failed"; error: string };

export const emailConfigured = () => !!(config.email.resendApiKey && config.email.from);

export async function sendEmail(kind: string, to: string, msg: { subject: string; text: string; html: string; unsubscribeUrl?: string }): Promise<EmailResult> {
  const toHash = sha256(to.trim().toLowerCase());
  const record = (status: string, extra: { providerId?: string; error?: string } = {}) =>
    db().query("INSERT INTO email_log(kind, to_hash, status, provider_id, error) VALUES ($1,$2,$3,$4,$5)", [kind, toHash, status, extra.providerId ?? null, extra.error?.slice(0, 500) ?? null]).catch(() => {});
  if (!emailConfigured()) {
    await record("skipped", { error: "not_configured" });
    return { status: "skipped", reason: "not_configured" };
  }
  try {
    const res = await fetch(`${config.email.apiUrl}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.email.resendApiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        from: config.email.from, to: [to], subject: msg.subject, text: msg.text, html: msg.html,
        ...(msg.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${msg.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) {
      const error = `provider ${res.status}: ${typeof body?.message === "string" ? body.message : "rejected"}`;
      await record("failed", { error });
      log.warn("email not accepted by provider", { kind, status: res.status });
      return { status: "failed", error };
    }
    await record("sent", { providerId: body.id });
    return { status: "sent", id: body.id };
  } catch (e: any) {
    const error = e?.name === "TimeoutError" ? "provider timed out" : "provider unreachable";
    await record("failed", { error });
    log.warn("email provider unreachable", { kind, error });
    return { status: "failed", error };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain, accessible email layout: heading, paragraphs, one button, footer. */
export function layout(o: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }) {
  const text = [o.heading, "", ...o.paragraphs.flatMap((p) => [p, ""]), ...(o.button ? [`${o.button.label}: ${o.button.url}`, ""] : []), ...(o.footer ? [o.footer] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#111">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:32px">
<div style="letter-spacing:.3em;font-size:12px;color:#555">ORBITAL</div>
<h1 style="font-weight:400;font-size:22px;margin:18px 0 12px">${esc(o.heading)}</h1>
${o.paragraphs.map((p) => `<p style="line-height:1.55;font-size:15px;margin:0 0 12px">${esc(p)}</p>`).join("")}
${o.button ? `<p style="margin:22px 0"><a href="${esc(o.button.url)}" style="background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:14px">${esc(o.button.label)}</a></p><p style="font-size:12px;color:#777;word-break:break-all">${esc(o.button.url)}</p>` : ""}
${o.footer ? `<p style="font-size:12px;color:#888;margin-top:24px">${esc(o.footer)}</p>` : ""}
</div></body></html>`;
  return { text, html };
}
