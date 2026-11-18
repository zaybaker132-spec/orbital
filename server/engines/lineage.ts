import { db } from "../db/client.js";
import type { ResearchReport } from "./research.js";

/**
 * Research lineage: how every conclusion was reached.
 *   question → (plan) sub-question / position → search → source → passage → finding (with reasoning,
 *   and the earlier findings it builds on) → conclusion
 * plus the person's own knowledge each finding connected to, and earlier research the question came from.
 * The passage is the sentence in the retrieved source text that best matches the finding, found by
 * word overlap — shown so anyone can check the link between claim and evidence themselves.
 */

const STOP = new Set("the a an and or of to in on for with by from at as is are was were be been that this these those it its their there which who what when where than then into over under about more most less such can may might will would should could not no but also between among per".split(" "));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}% ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** The sentence of `text` that shares the most meaningful words with `claim`. */
export function bestPassage(claim: string, text: string): { passage: string; overlap: number } {
  const target = words(claim);
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+(?=[A-Z0-9“"(])/).filter((x) => x.length > 20);
  let best = { passage: sentences[0]?.slice(0, 320) ?? text.slice(0, 320), overlap: 0 };
  for (const sen of sentences) {
    let n = 0;
    for (const w of words(sen)) if (target.has(w)) n++;
    if (n > best.overlap) best = { passage: sen.slice(0, 420), overlap: n };
  }
  return best;
}

export async function researchLineage(workspaceId: string, researchId: string) {
  const r = (await db().query<any>("SELECT id, question, kind, plan, report, created_at, completed_at, refreshed_at, hypothesis_id FROM research_sessions WHERE id=$1 AND workspace_id=$2", [researchId, workspaceId])).rows[0];
  if (!r) return null;
  const report: ResearchReport | null = r.report;
  const sources = (await db().query<any>(
    "SELECT ref_number, provider, url, title, published, source_type, excerpt, subquestion, position, assessment, retrieved_at FROM research_sources WHERE research_id=$1 AND workspace_id=$2 ORDER BY ref_number",
    [researchId, workspaceId])).rows;
  const byRef = new Map(sources.map((s) => [s.ref_number, s]));
  const findings = (report?.findings ?? []).map((f, i) => ({
    index: i,
    statement: f.statement,
    level: f.level,
    reasoning: f.reasoning ?? "",
    builds_on: f.builds_on ?? [],
    knowledge_refs: f.knowledge_refs ?? [],
    refreshed_at: f.refreshed_at ?? null,
    history: f.history ?? [],
    evidence: f.source_refs.filter((n) => byRef.has(n)).map((n) => {
      const p = bestPassage(f.statement, byRef.get(n).excerpt);
      return { source: n, passage: p.passage, matched: p.overlap >= 2 };
    }),
  }));
  // Older reports have no explicit conclusions: the executive summary stands on all verified findings.
  const conclusions = report?.conclusions?.length
    ? report.conclusions
    : report?.executive_summary
      ? [{ statement: report.executive_summary.split(/(?<=\.)\s/)[0], finding_refs: findings.filter((f) => f.level === "verified").map((f) => f.index) }]
      : [];
  const parent = r.hypothesis_id
    ? (await db().query<any>("SELECT id, statement FROM hypotheses WHERE id=$1 AND workspace_id=$2", [r.hypothesis_id, workspaceId])).rows[0] ?? null
    : null;
  return {
    id: r.id,
    question: r.question,
    kind: r.kind,
    interpretation: report?.interpretation ?? r.plan?.interpretation ?? "",
    created_at: r.created_at,
    completed_at: r.completed_at,
    refreshed_at: r.refreshed_at,
    hypothesis: parent,
    plan: (r.plan?.subquestions ?? []).map((q: any) => ({ question: q.question, query: q.search_query, position: q.position ?? "" })),
    conclusions,
    findings,
    sources: sources.map((s) => ({
      n: s.ref_number, title: s.title, url: s.url, provider: s.provider, type: s.source_type, published: s.published,
      subquestion: s.subquestion, position: s.position, grade: s.assessment?.grade ?? null, score: s.assessment?.score ?? null, retrieved_at: s.retrieved_at,
    })),
    knowledge: report?.knowledge_items ?? [],
  };
}
