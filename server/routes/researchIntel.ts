import { Router } from "express";
import { requirePro } from "../lib/plan.js";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { ah, HttpError, idParam, notFound, parse, ws, actor } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getLLM } from "../ai/provider.js";
import { startResearch, type ResearchReport } from "../engines/research.js";
import { assessSources } from "../engines/sourceIntel.js";
import { computeFreshness, startRefresh } from "../engines/freshness.js";
import { researchLineage } from "../engines/lineage.js";
import { startExtraction } from "../engines/extraction.js";
import { deleteNodeByRef } from "../engines/graph.js";
import { ownProject } from "./core.js";
import { apply, ApplySchema, health, MaintenanceError, scan, undoSuggestion } from "../engines/maintenance.js";

/** Source intelligence, the contradiction lab, lineage, hypotheses, living reports and knowledge extraction. */
export const researchIntel = Router();

const own = async (workspaceId: string, id: string) => {
  const r = (await db().query<any>("SELECT * FROM research_sessions WHERE id=$1 AND workspace_id=$2", [id, workspaceId])).rows[0];
  if (!r) throw notFound("Research");
  return r;
};

// ── Lineage ────────────────────────────────────────────────────────────────
researchIntel.get("/research/:id/lineage", ah(async (req, res) => {
  const l = await researchLineage(ws(req), idParam(req));
  if (!l) throw notFound("Research");
  res.json(l);
}));

// ── Source intelligence (re-assess, e.g. reports made before it existed) ────
researchIntel.post("/research/:id/assess", rateLimit({ windowMs: 60_000, max: 10, key: "user", name: "assess" }), ah(async (req, res) => {
  const r = await own(ws(req), idParam(req));
  if (r.status !== "completed") throw new HttpError(409, "The research isn't finished yet.");
  const report: ResearchReport = r.report ?? { findings: [], conflicting_evidence: [] };
  res.json(await assessSources(ws(req), r.id, report, await getLLM()));
}));

// ── Living reports ─────────────────────────────────────────────────────────
researchIntel.post("/research/:id/freshness", ah(async (req, res) => {
  const r = await own(ws(req), idParam(req));
  if (!r.report) throw new HttpError(409, "The research isn't finished yet.");
  const sources = (await db().query<any>("SELECT ref_number, published, retrieved_at FROM research_sources WHERE research_id=$1", [r.id])).rows;
  const f = computeFreshness(r.report, sources, r.completed_at);
  await db().query("UPDATE research_sessions SET freshness=$2, freshness_checked_at=now() WHERE id=$1", [r.id, JSON.stringify(f)]);
  res.json(f);
}));

researchIntel.post("/research/:id/refresh", rateLimit({ windowMs: 60 * 60_000, max: 20, key: "user", name: "refresh" }), requirePro("research"), ah(async (req, res) => {
  const b = parse(z.object({ items: z.array(z.object({ section: z.enum(["finding", "statistic"]), index: z.number().int().min(0) })).min(1).max(8) }), req.body);
  const r = await own(ws(req), idParam(req));
  if (r.status !== "completed" || r.report?.mode !== "synthesized") throw new HttpError(409, "Only finished, synthesized reports can be refreshed.");
  if (!(await getLLM())) throw new HttpError(503, "Refreshing a report needs an AI provider.", "ai_unavailable");
  await startRefresh(ws(req), r.id, b.items);
  res.status(202).json({ ok: true });
}));

// ── Contradiction lab from the knowledge graph ─────────────────────────────
researchIntel.post("/edges/:id/investigate", rateLimit({ windowMs: 60 * 60_000, max: 30, key: "user", name: "research" }), ah(async (req, res) => {
  const e = (await db().query<any>(
    `SELECT a.title AS a, b.title AS b FROM knowledge_edges e JOIN knowledge_nodes a ON a.id=e.source_id JOIN knowledge_nodes b ON b.id=e.target_id
     WHERE e.id=$1 AND e.workspace_id=$2`, [idParam(req), ws(req)])).rows[0];
  if (!e) throw notFound("Connection");
  const question = `Why do these disagree? "${e.a.slice(0, 300)}" versus "${e.b.slice(0, 300)}"`;
  res.status(201).json({ id: await startResearch(ws(req), question, { kind: "contradiction" }) });
}));

// ── Hypotheses ─────────────────────────────────────────────────────────────
researchIntel.get("/hypotheses", ah(async (req, res) => {
  res.json((await db().query(
    `SELECT h.id, h.statement, h.rationale, h.status, h.confidence, h.project_id, h.tested_at, h.created_at, h.updated_at, p.name AS project_name,
            (SELECT count(*)::int FROM research_sessions r WHERE r.hypothesis_id=h.id) AS tests
     FROM hypotheses h LEFT JOIN projects p ON p.id=h.project_id WHERE h.workspace_id=$1 ORDER BY h.updated_at DESC`, [ws(req)])).rows);
}));

const HypothesisInput = z.object({ statement: z.string().trim().min(8).max(1000), rationale: z.string().max(4000).default(""), projectId: z.uuid().nullish() });

researchIntel.post("/hypotheses", requirePro("research"), ah(async (req, res) => {
  const b = parse(HypothesisInput, req.body);
  if (b.projectId) await ownProject(ws(req), b.projectId);
  res.status(201).json((await db().query("INSERT INTO hypotheses(workspace_id, created_by, statement, rationale, project_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [ws(req), actor(req), b.statement, b.rationale, b.projectId ?? null])).rows[0]);
}));

researchIntel.get("/hypotheses/:id", ah(async (req, res) => {
  const h = (await db().query<any>("SELECT h.*, p.name AS project_name FROM hypotheses h LEFT JOIN projects p ON p.id=h.project_id WHERE h.id=$1 AND h.workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!h) throw notFound("Hypothesis");
  const tests = (await db().query<any>(
    `SELECT id, question, kind, status, created_at, completed_at, report->'hypothesis'->>'verdict' AS verdict, (report->'hypothesis'->>'confidence')::float AS confidence,
            (SELECT count(*)::int FROM research_sources s WHERE s.research_id=r.id) AS sources
     FROM research_sessions r WHERE r.hypothesis_id=$1 AND r.workspace_id=$2 ORDER BY created_at DESC`, [h.id, ws(req)])).rows;
  const sources = h.last_research_id ? (await db().query<any>(
    "SELECT ref_number, title, url, provider, published, position, assessment->>'grade' AS grade, (assessment->>'score')::int AS score FROM research_sources WHERE research_id=$1 ORDER BY ref_number", [h.last_research_id])).rows : [];
  res.json({ ...h, tests, sources });
}));

researchIntel.patch("/hypotheses/:id", ah(async (req, res) => {
  const b = parse(HypothesisInput.partial(), req.body);
  if (b.projectId) await ownProject(ws(req), b.projectId);
  const r = await db().query<any>(
    `UPDATE hypotheses SET statement=COALESCE($3,statement), rationale=COALESCE($4,rationale), project_id=CASE WHEN $5 THEN $6::uuid ELSE project_id END, updated_at=now()
     WHERE id=$1 AND workspace_id=$2 RETURNING *`,
    [idParam(req), ws(req), b.statement ?? null, b.rationale ?? null, b.projectId !== undefined, b.projectId ?? null]);
  if (!r.rows[0]) throw notFound("Hypothesis");
  res.json(r.rows[0]);
}));

researchIntel.delete("/hypotheses/:id", ah(async (req, res) => {
  await db().query("DELETE FROM hypotheses WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  await deleteNodeByRef(ws(req), "hypothesis", idParam(req));
  res.json({ ok: true });
}));

/** Run a test: evidence for and against, the person's own knowledge, a verdict and next tests. */
researchIntel.post("/hypotheses/:id/test", rateLimit({ windowMs: 60 * 60_000, max: 30, key: "user", name: "research" }), requirePro("research"), ah(async (req, res) => {
  const h = (await db().query<any>("SELECT * FROM hypotheses WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!h) throw notFound("Hypothesis");
  if (h.status === "testing") throw new HttpError(409, "A test is already running.");
  const researchId = await startResearch(ws(req), h.statement, { kind: "hypothesis", hypothesisId: h.id, projectId: h.project_id });
  await db().query("UPDATE hypotheses SET status='testing', updated_at=now() WHERE id=$1", [h.id]);
  res.status(202).json({ researchId });
}));

/** Research one of the suggested next tests; it stays linked to the hypothesis and feeds the next re-test. */
researchIntel.post("/hypotheses/:id/next-test", rateLimit({ windowMs: 60 * 60_000, max: 30, key: "user", name: "research" }), ah(async (req, res) => {
  const b = parse(z.object({ index: z.number().int().min(0).max(10) }), req.body);
  const h = (await db().query<any>("SELECT * FROM hypotheses WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!h) throw notFound("Hypothesis");
  const t = h.verdict?.next_tests?.[b.index];
  if (!t) throw new HttpError(400, "That suggested test doesn't exist.");
  res.status(201).json({ researchId: await startResearch(ws(req), t.question, { hypothesisId: h.id, projectId: h.project_id }) });
}));

// ── Knowledge extraction ───────────────────────────────────────────────────
researchIntel.post("/documents/:id/extract", rateLimit({ windowMs: 60 * 60_000, max: 20, key: "user", name: "extract" }), ah(async (req, res) => {
  const d = (await db().query<any>("SELECT id, length(body) AS n FROM documents WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!d) throw notFound("Document");
  if (d.n < 200) throw new HttpError(400, "This document is too short to extract from.");
  res.status(202).json({ id: await startExtraction(ws(req), d.id) });
}));

researchIntel.get("/documents/:id/extraction", ah(async (req, res) => {
  const ex = (await db().query<any>("SELECT * FROM extractions WHERE document_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 1", [idParam(req), ws(req)])).rows[0];
  if (!ex) return res.json(null);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  const items = (await db().query<any>(
    `SELECT id, kind, title, detail, quote, subtype, date_text, sort_date, part, mentions, verified, node_id, data FROM extracted_items
     WHERE document_id=$1 AND workspace_id=$2 AND ($3 = '' OR tsv @@ websearch_to_tsquery('english', $3) OR title ILIKE '%' || $3 || '%')
     ORDER BY CASE kind WHEN 'event' THEN sort_date ELSE '' END, mentions DESC, part LIMIT 2000`, [idParam(req), ws(req), q])).rows;
  res.json({ ...ex, items });
}));

// ── Knowledge maintenance ──────────────────────────────────────────────────
researchIntel.get("/maintenance", ah(async (req, res) => {
  const [h, open, recent] = await Promise.all([
    health(ws(req)),
    db().query("SELECT id, kind, title, reason, items, proposal, severity, ai, status, snoozed_until, created_at FROM maintenance_suggestions WHERE workspace_id=$1 AND status IN ('open','snoozed') ORDER BY status, severity DESC, created_at DESC LIMIT 300", [ws(req)]),
    db().query("SELECT id, kind, title, status, resolution, resolved_at, (undo IS NOT NULL AND jsonb_array_length(undo) > 0) AS undoable FROM maintenance_suggestions WHERE workspace_id=$1 AND status IN ('applied','dismissed') AND resolved_at > now() - interval '30 days' ORDER BY resolved_at DESC LIMIT 50", [ws(req)]),
  ]);
  res.json({ health: h, suggestions: open.rows, recent: recent.rows });
}));

researchIntel.post("/maintenance/scan", rateLimit({ windowMs: 60_000, max: 6, key: "user", name: "maintenance" }), requirePro("maintenance"), ah(async (req, res) => {
  res.json(await scan(ws(req)));
}));

const mErr = (e: unknown) => { if (e instanceof MaintenanceError) throw new HttpError(e.status, e.message); throw e; };

researchIntel.post("/maintenance/:id/apply", ah(async (req, res) => {
  const b = parse(ApplySchema, req.body);
  res.json(await apply(ws(req), actor(req), idParam(req), b).catch(mErr));
}));

researchIntel.post("/maintenance/:id/undo", ah(async (req, res) => {
  res.json(await undoSuggestion(ws(req), idParam(req)).catch(mErr));
}));

/** Dismiss (remembered: the same issue won't be raised again) or snooze for a number of days. */
researchIntel.post("/maintenance/:id/dismiss", ah(async (req, res) => {
  const b = parse(z.object({ snoozeDays: z.number().int().min(1).max(365).nullish() }), req.body ?? {});
  const r = await db().query(
    `UPDATE maintenance_suggestions SET status = CASE WHEN $3::int IS NULL THEN 'dismissed' ELSE 'snoozed' END,
       snoozed_until = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END,
       resolved_at = CASE WHEN $3::int IS NULL THEN now() ELSE NULL END, resolved_by=$4, resolution = CASE WHEN $3::int IS NULL THEN 'Dismissed' ELSE '' END
     WHERE id=$1 AND workspace_id=$2 AND status IN ('open','snoozed') RETURNING id`,
    [idParam(req), ws(req), b.snoozeDays ?? null, actor(req)]);
  if (!r.rows[0]) throw notFound("Suggestion");
  res.json({ ok: true });
}));
