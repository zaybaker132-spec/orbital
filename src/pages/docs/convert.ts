import type { JSONContent } from "@tiptap/core";

/**
 * Doc content → Markdown (what search and Orbital's answers read, and the Markdown download)
 * and → plain text. Also the reverse for Orbital's writing help: simple Markdown → editor HTML.
 */

function marks(text: string, ms: JSONContent["marks"]) {
  let out = text;
  if (!ms?.length || !text.trim()) return out;
  const has = (t: string) => ms.some((m) => m.type === t);
  if (has("code")) out = "`" + out + "`";
  if (has("bold")) out = `**${out}**`;
  if (has("italic")) out = `*${out}*`;
  if (has("strike")) out = `~~${out}~~`;
  const link = ms.find((m) => m.type === "link");
  if (link?.attrs?.href) out = `[${out}](${link.attrs.href})`;
  return out;
}

function inline(nodes: JSONContent[] = []): string {
  return nodes.map((n) => {
    if (n.type === "text") return marks(n.text ?? "", n.marks);
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "image") return n.attrs?.src?.startsWith("data:") ? `![${n.attrs?.alt ?? "image"}]()` : `![${n.attrs?.alt ?? ""}](${n.attrs?.src})`;
    return inline(n.content);
  }).join("");
}

function block(n: JSONContent, depth = 0): string {
  const pad = "  ".repeat(depth);
  switch (n.type) {
    case "heading": return `${"#".repeat(n.attrs?.level ?? 1)} ${inline(n.content)}`;
    case "paragraph": return inline(n.content);
    case "blockquote": return (n.content ?? []).map((c) => block(c)).join("\n\n").split("\n").map((l) => `> ${l}`).join("\n");
    case "codeBlock": return "```" + (n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    case "horizontalRule": return "---";
    case "pageBreak": return "---";
    case "image": return inline([n]);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (n.content ?? []).map((item, i) => {
        const bullet = n.type === "orderedList" ? `${(n.attrs?.start ?? 1) + i}.` : n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}]` : "-";
        const [first, ...rest] = item.content ?? [];
        const head = `${pad}${bullet} ${first ? block(first, depth + 1) : ""}`;
        const tail = rest.map((c) => (["bulletList", "orderedList", "taskList"].includes(c.type ?? "") ? block(c, depth + 1) : `${pad}  ${block(c, depth + 1)}`));
        return [head, ...tail].join("\n");
      }).join("\n");
    case "table": {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => block(p)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
    }
    default: return (n.content ?? []).map((c) => block(c, depth)).join("\n\n");
  }
}

export const toMarkdown = (doc: JSONContent) => (doc.content ?? []).map((n) => block(n)).filter((s, i, a) => s !== "" || (a[i - 1] ?? "") !== "").join("\n\n").replace(/\n{3,}/g, "\n\n").trim();

export const toPlainText = (doc: JSONContent) =>
  toMarkdown(doc).replace(/^#+\s/gm, "").replace(/\*\*|~~|`/g, "").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^> /gm, "").replace(/^- \[[ x]\] /gm, "☐ ");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inlineMd = (s: string) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** Orbital's writing help answers in simple Markdown; turn it into content the editor inserts. */
export function markdownToHtml(md: string) {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li><p>${inlineMd(m[1])}</p></li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li><p>${inlineMd(m[1])}</p></li>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote><p>${inlineMd(m[1])}</p></blockquote>`); continue; }
    close();
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  close();
  return out.join("");
}

/** Keep only harmless formatting from stored HTML, for thumbnails in the docs list. */
const ALLOWED = new Set(["P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "STRONG", "EM", "U", "S", "BLOCKQUOTE", "TABLE", "TBODY", "TR", "TD", "TH", "HR", "BR", "MARK", "SPAN", "CODE", "PRE"]);
export function safeHtml(html: string) {
  const src = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild!;
  const out = document.createElement("div");
  const copy = (from: Node, to: Node) => {
    for (const n of [...from.childNodes]) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.textContent ?? "")); continue; }
      if (n.nodeType !== 1) continue;
      const el = n as HTMLElement;
      if (["SCRIPT", "STYLE", "IMG", "IFRAME", "OBJECT", "SVG"].includes(el.tagName)) continue;
      if (!ALLOWED.has(el.tagName)) { copy(el, to); continue; }
      const clean = document.createElement(el.tagName);
      const align = el.style?.textAlign;
      if (align && ["left", "center", "right", "justify"].includes(align)) clean.style.textAlign = align;
      copy(el, clean);
      to.appendChild(clean);
    }
  };
  copy(src, out);
  return out.innerHTML;
}
