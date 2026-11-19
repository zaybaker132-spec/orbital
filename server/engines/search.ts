import { db } from "../db/client.js";

/**
 * Universal search across everything a person can see in a workspace: their own conversations,
 * notes, imported files, web clips, research reports, memories, projects, tasks and opportunities.
 * Full-text (Postgres websearch syntax: "exact phrase", OR, -exclude) plus title matches, with
 * highlighted snippets.
 */

export const SEARCH_TYPES = ["conversation", "doc", "note", "file", "clip", "research", "extracted", "hypothesis", "memory", "project", "task", "opportunity"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  /** Plain text with matches wrapped in ⟦ ⟧. */
  snippet: string;
  meta: string;
  link: string;
  at: string;
  rank: number;
}

/** Highlight markers: characters that never appear in normal writing or Markdown. */
const OPTS = "StartSel=⟦, StopSel=⟧, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter= … , HighlightAll=false";
const FILE_KINDS = ["pdf", "docx", "xlsx", "pptx", "image", "text"];
const NOTE_KINDS = ["note", "saved_response"];

const KIND_LABEL: Record<string, string> = {
  pdf: "PDF", docx: "Word document", xlsx: "Spreadsheet", pptx: "Presentation", image: "Image", text: "Text file",
  note: "Note", doc: "Paper", saved_response: "Saved answer", web_clip: "Web clip", research_report: "Research report",
};

export async function searchAll(workspaceId: string, userId: string, q: string, types: SearchType[], limit = 40): Promise<SearchHit[]> {
  const want = (t: SearchType) => types.length === 0 || types.includes(t);
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const per = Math.min(50, limit);
  const run = (sql: string, params: unknown[]) => db().query<any>(sql, params).then((r) => r.rows);
  const jobs: Promise<SearchHit[]>[] = [];

  const docKinds = [
    ...(want("doc") ? ["doc"] : []),
    ...(want("note") ? NOTE_KINDS : []),
    ...(want("file") ? FILE_KINDS : []),
    ...(want("clip") ? ["web_clip"] : []),
    ...(want("research") ? ["research_report"] : []),
  ];
  if (docKinds.length) {
    jobs.push(run(
      `SELECT d.id, d.title, d.kind, d.file_name, d.source_url, d.updated_at AS at,
              ts_rank(d.tsv, q) + CASE WHEN d.title ILIKE $3 THEN 0.6 ELSE 0 END AS rank,
              ts_headline('english', left(d.body, 30000), q, $5) AS snippet
       FROM documents d, websearch_to_tsquery('english', $2) q
       WHERE d.workspace_id=$1 AND d.kind = ANY($6::text[]) AND (d.tsv @@ q OR d.title ILIKE $3)
       ORDER BY rank DESC, d.updated_at DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS, docKinds]).then((rows) => rows.map((d) => ({
        type: (FILE_KINDS.includes(d.kind) ? "file" : d.kind === "web_clip" ? "clip" : d.kind === "research_report" ? "research" : d.kind === "doc" ? "doc" : "note") as SearchType,
        id: d.id, title: d.title, snippet: d.snippet, link: d.kind === "doc" ? `/papers/${d.id}` : `/knowledge/${d.id}`, at: d.at, rank: Number(d.rank),
        meta: d.kind === "web_clip" && d.source_url ? `Web clip · ${hostOf(d.source_url)}` : d.file_name ? `${KIND_LABEL[d.kind] ?? "File"} · ${d.file_name}` : KIND_LABEL[d.kind] ?? d.kind,
      }))));
  }
  if (want("conversation")) {
    jobs.push(run(
      `SELECT c.id, c.title, c.updated_at AS at, COALESCE(s.rank, 0) + CASE WHEN c.title ILIKE $3 THEN 0.6 ELSE 0 END AS rank, s.snippet, s.role
       FROM conversations c CROSS JOIN websearch_to_tsquery('english', $2) q
       LEFT JOIN LATERAL (
         SELECT ts_rank(m.tsv, q) AS rank, m.role, ts_headline('english', left(m.content, 12000), q, $5) AS snippet
         FROM messages m WHERE m.conversation_id=c.id AND m.tsv @@ q ORDER BY ts_rank(m.tsv, q) DESC LIMIT 1
       ) s ON true
       WHERE c.workspace_id=$1 AND c.created_by=$6 AND (s.rank IS NOT NULL OR c.title ILIKE $3)
       ORDER BY rank DESC, c.updated_at DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS, userId]).then((rows) => rows.map((c) => ({
        type: "conversation" as const, id: c.id, title: c.title, snippet: c.snippet ?? "", link: `/c/${c.id}`, at: c.at, rank: Number(c.rank),
        meta: c.role ? `Conversation · ${c.role === "user" ? "you said" : "Orbital said"}` : "Conversation",
      }))));
  }
  if (want("research")) {
    jobs.push(run(
      `SELECT r.id, r.question, r.status, r.created_at AS at, ts_rank(v, q) + CASE WHEN r.question ILIKE $3 THEN 0.6 ELSE 0 END AS rank,
              ts_headline('english', left(t, 30000), q, $5) AS snippet
       FROM research_sessions r
       CROSS JOIN websearch_to_tsquery('english', $2) q
       CROSS JOIN LATERAL (SELECT r.question || E'\\n' || COALESCE(r.report->>'executive_summary', '') || E'\\n' ||
              COALESCE((SELECT string_agg(f->>'statement', E'\\n') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.report->'findings')='array' THEN r.report->'findings' ELSE '[]'::jsonb END) f), '') AS t) txt
       CROSS JOIN LATERAL (SELECT to_tsvector('english', txt.t) AS v) vv
       WHERE r.workspace_id=$1 AND (v @@ q OR r.question ILIKE $3)
       ORDER BY rank DESC, r.created_at DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS]).then((rows) => rows.map((r) => ({
        type: "research" as const, id: r.id, title: r.question, snippet: r.snippet, link: `/research/${r.id}`, at: r.at, rank: Number(r.rank),
        meta: `Research · ${r.status}`,
      }))));
  }
  if (want("memory")) {
    jobs.push(run(
      `SELECT m.id, m.content, m.category, m.updated_at AS at, ts_rank(m.tsv, q) AS rank, ts_headline('english', m.content, q, $5) AS snippet
       FROM memories m, websearch_to_tsquery('english', $2) q
       WHERE m.workspace_id=$1 AND m.status IN ('active','pending') AND (m.tsv @@ q OR m.content ILIKE $3)
       ORDER BY rank DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS]).then((rows) => rows.map((m) => ({
        type: "memory" as const, id: m.id, title: m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content, snippet: m.content.length > 120 ? m.snippet : "",
        link: `/knowledge?tab=memory`, at: m.at, rank: Number(m.rank) + 0.05, meta: `Memory · ${m.category}`,
      }))));
  }
  if (want("project")) {
    jobs.push(run(
      `SELECT p.id, p.name, p.status, p.updated_at AS at,
              ts_rank(to_tsvector('english', p.name || ' ' || p.description || ' ' || p.goals), q) + CASE WHEN p.name ILIKE $3 THEN 0.8 ELSE 0 END AS rank,
              ts_headline('english', p.description || ' ' || p.goals, q, $5) AS snippet
       FROM projects p, websearch_to_tsquery('english', $2) q
       WHERE p.workspace_id=$1 AND (to_tsvector('english', p.name || ' ' || p.description || ' ' || p.goals) @@ q OR p.name ILIKE $3)
       ORDER BY rank DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS]).then((rows) => rows.map((p) => ({
        type: "project" as const, id: p.id, title: p.name, snippet: p.snippet, link: `/projects/${p.id}`, at: p.at, rank: Number(p.rank), meta: `Project · ${p.status}`,
      }))));
  }
  if (want("task")) {
    jobs.push(run(
      `SELECT t.id, t.title, t.done, t.due_date, t.created_at AS at, p.id AS project_id, p.name AS project,
              ts_rank(to_tsvector('english', t.title), q) + CASE WHEN t.title ILIKE $3 THEN 0.4 ELSE 0 END AS rank
       FROM tasks t JOIN projects p ON p.id=t.project_id, websearch_to_tsquery('english', $2) q
       WHERE t.workspace_id=$1 AND (to_tsvector('english', t.title) @@ q OR t.title ILIKE $3)
       ORDER BY t.done, rank DESC LIMIT $4`,
      [workspaceId, q, like, per]).then((rows) => rows.map((t) => ({
        type: "task" as const, id: t.id, title: t.title, snippet: "", link: `/projects/${t.project_id}`, at: t.at, rank: Number(t.rank) - (t.done ? 0.2 : 0),
        meta: `Task · ${t.project}${t.done ? " · done" : t.due_date ? ` · due ${t.due_date}` : ""}`,
      }))));
  }
  if (want("opportunity")) {
    jobs.push(run(
      `SELECT o.id, o.title, o.status, o.updated_at AS at,
              ts_rank(to_tsvector('english', o.title || ' ' || o.explanation), q) + CASE WHEN o.title ILIKE $3 THEN 0.6 ELSE 0 END AS rank,
              ts_headline('english', o.explanation, q, $5) AS snippet
       FROM opportunities o, websearch_to_tsquery('english', $2) q
       WHERE o.workspace_id=$1 AND (to_tsvector('english', o.title || ' ' || o.explanation) @@ q OR o.title ILIKE $3)
       ORDER BY rank DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS]).then((rows) => rows.map((o) => ({
        type: "opportunity" as const, id: o.id, title: o.title, snippet: o.snippet, link: "/opportunities", at: o.at, rank: Number(o.rank), meta: `Opportunity · ${o.status}`,
      }))));
  }
  if (want("extracted")) {
    const LABEL: Record<string, string> = { concept: "Concept", evidence: "Evidence", event: "Timeline", relation: "Relationship" };
    jobs.push(run(
      `SELECT x.id, x.kind, x.title, x.detail, x.quote, x.date_text, x.document_id, d.title AS doc, ts_rank(x.tsv, q) + CASE WHEN x.title ILIKE $3 THEN 0.4 ELSE 0 END AS rank,
              ts_headline('english', x.title || ' — ' || x.detail || ' ' || x.quote, q, $5) AS snippet
       FROM extracted_items x JOIN documents d ON d.id=x.document_id, websearch_to_tsquery('english', $2) q
       WHERE x.workspace_id=$1 AND (x.tsv @@ q OR x.title ILIKE $3)
       ORDER BY rank DESC, x.mentions DESC LIMIT $4`,
      [workspaceId, q, like, per, OPTS]).then((rows) => rows.map((x) => ({
        type: "extracted" as const, id: x.id, title: x.title, snippet: x.snippet, link: `/knowledge/${x.document_id}?view=extraction&item=${x.id}`, at: new Date().toISOString(), rank: Number(x.rank) - 0.05,
        meta: `${LABEL[x.kind] ?? x.kind}${x.date_text ? ` · ${x.date_text}` : ""} · from ${x.doc}`,
      }))));
  }
  if (want("hypothesis")) {
    jobs.push(run(
      `SELECT h.id, h.statement, h.status, h.updated_at AS at, ts_rank(to_tsvector('english', h.statement || ' ' || h.rationale), q) + CASE WHEN h.statement ILIKE $3 THEN 0.6 ELSE 0 END AS rank
       FROM hypotheses h, websearch_to_tsquery('english', $2) q
       WHERE h.workspace_id=$1 AND (to_tsvector('english', h.statement || ' ' || h.rationale) @@ q OR h.statement ILIKE $3) ORDER BY rank DESC LIMIT $4`,
      [workspaceId, q, like, per]).then((rows) => rows.map((h) => ({
        type: "hypothesis" as const, id: h.id, title: h.statement, snippet: "", link: `/hypotheses/${h.id}`, at: h.at, rank: Number(h.rank), meta: `Hypothesis · ${h.status}`,
      }))));
  }
  const hits = (await Promise.all(jobs)).flat();
  // A snippet with no highlighted term adds nothing (e.g. a title-only match): drop it.
  for (const h of hits) if (h.snippet && !h.snippet.includes("⟦")) h.snippet = "";
  return hits.sort((a, b) => b.rank - a.rank || Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
