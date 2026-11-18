import dns from "node:dns/promises";
import net from "node:net";
import { config } from "../config.js";
import { privateAddress } from "./automation.js";
import { createDocument, extractPdfText } from "./knowledge.js";

/**
 * Web clipper: save a web page (or the part someone selected) into Orbital as a document.
 * The server fetches the page itself, refusing private and local network addresses, and keeps the
 * readable article text rather than the whole page.
 */

export class ClipError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MAX_BYTES = 5 * 1024 * 1024;
const allowPrivate = () => config.desktop || /^(1|true)$/i.test(process.env.ORBITAL_ALLOW_PRIVATE_WEBHOOKS ?? "");

async function assertPublic(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ClipError(400, "Only web pages (http or https) can be clipped.");
  if (u.username || u.password) throw new ClipError(400, "Links with embedded passwords can't be clipped.");
  if (allowPrivate()) return;
  let addrs: string[];
  try { addrs = net.isIP(u.hostname.replace(/^\[|\]$/g, "")) ? [u.hostname.replace(/^\[|\]$/g, "")] : (await dns.lookup(u.hostname, { all: true })).map((a) => a.address); }
  catch { throw new ClipError(422, `Couldn't find ${u.hostname}. Check the address.`); }
  if (!addrs.length || addrs.some(privateAddress)) throw new ClipError(400, "That address is on a private or local network, which Orbital doesn't fetch.");
}

/** Fetch a public page, checking every redirect hop and capping size and time. */
export async function fetchPublic(raw: string): Promise<{ url: string; contentType: string; body: Buffer }> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ClipError(400, "That isn't a valid web address."); }
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(u);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; OrbitalClipper/1.0; +self-hosted)", accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5" },
      });
    } catch (e: any) {
      throw new ClipError(502, e?.name === "TimeoutError" ? "The page took too long to respond." : "Couldn't reach that page.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ClipError(422, "That page needs a login or blocks automated access. Select the text you want and clip again: Orbital will save your selection.");
    if (!res.ok) throw new ClipError(422, `The page responded with an error (${res.status}).`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new ClipError(413, "That page is too large to clip (over 5 MB).");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { await reader.cancel(); throw new ClipError(413, "That page is too large to clip (over 5 MB)."); }
      chunks.push(value);
    }
    return { url: u.toString(), contentType: (res.headers.get("content-type") ?? "").toLowerCase(), body: Buffer.concat(chunks) };
  }
  throw new ClipError(422, "That link redirects too many times.");
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•" };
export const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta\\s[^>]*(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim() : "";
};

/** Pick the element most likely to hold the article and turn it into Markdown. */
export function extractArticle(html: string, pageUrl: string) {
  const title = meta(html, "og:title") || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || new URL(pageUrl).hostname;
  const site = meta(html, "og:site_name") || new URL(pageUrl).hostname.replace(/^www\./, "");
  const author = meta(html, "author") || meta(html, "article:author");
  const published = meta(html, "article:published_time").slice(0, 10);
  const description = meta(html, "og:description") || meta(html, "description");

  let doc = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|form|button|select|textarea)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
  // Candidates: <article>, <main>, role=main, then the body. Choose the one with the most paragraph text.
  const candidates = [
    ...[...doc.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]),
    ...[...doc.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].map((m) => m[1]),
    ...[...doc.matchAll(/<(div|section)\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]),
  ];
  const paraText = (h: string) => [...h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].reduce((n, m) => n + m[1].replace(/<[^>]+>/g, "").trim().length, 0);
  const body = doc.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? doc;
  let best = candidates.sort((a, b) => paraText(b) - paraText(a))[0];
  if (!best || paraText(best) < 200) best = body.replace(/<header\b[\s\S]*?<\/header>/gi, "");
  doc = best;

  const abs = (href: string) => { try { return new URL(decodeEntities(href), pageUrl).toString(); } catch { return ""; } };
  let md = doc
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\`\`\`\n${decodeEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${"#".repeat(Math.max(2, Number(l)))} ${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, q) => `\n\n> ${q.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n\n`)
    .replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => {
      const text = t.replace(/<[^>]+>/g, "").trim(), url = abs(h);
      return text && /^https?:/.test(url) ? `[${text}](${url})` : text;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|ul|ol|table|tr|figure|figcaption)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  md = decodeEntities(md)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title.slice(0, 300), site, author, published, description, markdown: md.slice(0, 400_000) };
}

export interface ClipInput { url: string; title?: string; selection?: string; note?: string; projectId?: string | null; folderId?: string | null; tags?: string[] }

export async function clipPage(workspaceId: string, input: ClipInput) {
  const selection = input.selection?.trim() ?? "";
  let article: ReturnType<typeof extractArticle> | null = null;
  let finalUrl = input.url;
  let fetchError: ClipError | null = null;
  try {
    const page = await fetchPublic(input.url);
    finalUrl = page.url;
    if (page.contentType.includes("application/pdf") || page.body.subarray(0, 5).toString() === "%PDF-") {
      const { text } = await extractPdfText(page.body);
      article = { title: input.title || decodeURIComponent(new URL(page.url).pathname.split("/").pop() || "PDF"), site: new URL(page.url).hostname, author: "", published: "", description: "", markdown: text };
    } else if (page.contentType.includes("html") || /^\s*</.test(page.body.subarray(0, 200).toString())) {
      article = extractArticle(page.body.toString("utf8"), page.url);
    } else if (page.contentType.startsWith("text/")) {
      article = { title: input.title || page.url, site: new URL(page.url).hostname, author: "", published: "", description: "", markdown: page.body.toString("utf8").slice(0, 400_000) };
    } else {
      throw new ClipError(415, "That link isn't a web page, PDF or text file.");
    }
  } catch (e) {
    if (!(e instanceof ClipError) || !selection) throw e;
    fetchError = e; // A selection can still be saved when the page itself can't be fetched.
  }
  const title = (input.title?.trim() || article?.title || new URL(finalUrl).hostname).slice(0, 300);
  const byline = [article?.site, article?.author, article?.published].filter(Boolean).join(" · ");
  const parts = [
    `> Clipped from [${article?.site || new URL(finalUrl).hostname}](${finalUrl})${byline && article ? ` · ${[article.author, article.published].filter(Boolean).join(" · ")}` : ""}`,
    input.note?.trim() ? `**My note:** ${input.note.trim()}` : "",
    selection ? `## Highlight\n\n${selection.split(/\n+/).map((l) => `> ${l}`).join("\n")}` : "",
    article?.markdown ? `${selection ? "## Full page\n\n" : ""}${article.markdown}` : "",
    fetchError ? `_The full page couldn't be saved: ${fetchError.message}_` : "",
  ].filter(Boolean);
  if (!article?.markdown && !selection) throw new ClipError(422, "Couldn't find readable text on that page. Select the text you want and clip again.");
  const doc = await createDocument(workspaceId, {
    title, body: parts.join("\n\n"), kind: "web_clip", sourceUrl: finalUrl, tags: ["web-clip", ...(input.tags ?? [])],
    projectId: input.projectId ?? null, folderId: input.folderId ?? null,
  });
  return { ...doc, partial: !!fetchError };
}
