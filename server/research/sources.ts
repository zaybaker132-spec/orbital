import { config } from "../config.js";
import type { LLMProvider } from "../ai/provider.js";

/**
 * External source connectors. Every source carries the URL it came from and an excerpt of
 * text actually retrieved from that URL — the synthesis step may only cite these excerpts.
 */
export interface Source {
  provider: "wikipedia" | "openalex" | "web";
  sourceType: "encyclopedia" | "scholarly" | "web";
  url: string;
  title: string;
  authors?: string;
  published?: string;
  excerpt: string;
}

// Wikimedia asks API clients to identify themselves. Default is generic; operators can set
// RESEARCH_USER_AGENT to include their own contact URL.
const UA = process.env.RESEARCH_USER_AGENT || "Orbital/1.0 (self-hosted personal knowledge assistant)";
const TIMEOUT = 15000;

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json() as Promise<any>;
}

export async function searchWikipedia(query: string, limit = 2): Promise<Source[]> {
  const s = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`);
  const ids: number[] = (s.query?.search ?? []).map((r: any) => r.pageid);
  if (!ids.length) return [];
  const e = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&format=json&pageids=${ids.join("|")}`);
  return parseWikipediaExtracts(e, ids);
}

export function parseWikipediaExtracts(e: any, order: number[]): Source[] {
  const pages = e.query?.pages ?? {};
  return order
    .map((id) => pages[id])
    .filter((p: any) => p && p.extract && p.extract.length > 80)
    .map((p: any) => ({
      provider: "wikipedia" as const,
      sourceType: "encyclopedia" as const,
      url: p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
      title: `${p.title} — Wikipedia`,
      published: p.touched ? `revised ${String(p.touched).slice(0, 10)}` : "",
      excerpt: String(p.extract).slice(0, 2400),
    }));
}

export async function searchOpenAlex(query: string, limit = 3): Promise<Source[]> {
  const j = await getJson(
    `https://api.openalex.org/works?per-page=${limit}&filter=has_abstract:true&sort=relevance_score:desc&select=id,doi,title,publication_year,authorships,abstract_inverted_index,primary_location,cited_by_count&search=${encodeURIComponent(query)}`,
  );
  return parseOpenAlex(j);
}

export function parseOpenAlex(j: any): Source[] {
  return (j.results ?? [])
    .map((w: any) => {
      const abstract = invertAbstract(w.abstract_inverted_index);
      if (!abstract || !w.title) return null;
      const authors = (w.authorships ?? []).slice(0, 4).map((a: any) => a.author?.display_name).filter(Boolean).join(", ");
      return {
        provider: "openalex" as const,
        sourceType: "scholarly" as const,
        url: w.doi ?? w.primary_location?.landing_page_url ?? w.id,
        title: w.title,
        authors: authors + ((w.authorships?.length ?? 0) > 4 ? " et al." : ""),
        published: w.publication_year ? `${w.publication_year}${w.cited_by_count ? ` · cited by ${w.cited_by_count}` : ""}` : "",
        excerpt: abstract.slice(0, 2400),
      };
    })
    .filter(Boolean) as Source[];
}

export function invertAbstract(idx: Record<string, number[]> | null | undefined) {
  if (!idx) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.filter((w) => w !== undefined).join(" ");
}

/** Live web search through the AI provider; only passages the model cited from fetched pages become sources. */
export async function searchWeb(llm: LLMProvider, query: string): Promise<Source[]> {
  if (!llm.webSearch) return [];
  const r = await llm.webSearch({
    query,
    maxUses: 3,
    instructions:
      "Search the web for credible, recent, primary or authoritative sources on the research question. Prefer official statistics, reputable research, and established publications. " +
      "Report the key facts you find, citing them. Do not speculate.",
  });
  const byUrl = new Map<string, Source>();
  for (const c of r.citations) {
    const cur = byUrl.get(c.url);
    if (cur) {
      if (!cur.excerpt.includes(c.citedText)) cur.excerpt = `${cur.excerpt}\n…\n${c.citedText}`.slice(0, 2400);
    } else {
      const pageAge = r.results.find((x) => x.url === c.url)?.pageAge;
      byUrl.set(c.url, { provider: "web", sourceType: "web", url: c.url, title: c.title || new URL(c.url).hostname, published: pageAge ?? "", excerpt: c.citedText.slice(0, 2400) });
    }
  }
  return [...byUrl.values()];
}

export async function gatherSources(llm: LLMProvider | null, query: string, log: (msg: string) => void): Promise<Source[]> {
  const tasks: [string, Promise<Source[]>][] = [];
  if (config.research.wikipedia) tasks.push(["Wikipedia", searchWikipedia(query)]);
  if (config.research.openalex) tasks.push(["OpenAlex", searchOpenAlex(query)]);
  if (llm?.webSearch && config.research.webSearch) tasks.push(["Web search", searchWeb(llm, query)]);
  const settled = await Promise.allSettled(tasks.map((t) => t[1]));
  const out: Source[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      log(`${tasks[i][0]}: ${s.value.length} source${s.value.length === 1 ? "" : "s"}`);
      out.push(...s.value.slice(0, config.research.maxSourcesPerQuestion));
    } else {
      log(`${tasks[i][0]} unavailable: ${String(s.reason?.message ?? s.reason).slice(0, 140)}`);
    }
  });
  return out;
}
