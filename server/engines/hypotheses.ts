import { db } from "../db/client.js";
import { logActivity } from "../lib/activity.js";
import { upsertNode } from "./graph.js";
import type { ResearchReport } from "./research.js";

/**
 * Hypothesis testing. A hypothesis is a statement someone believes might be true. A test runs a
 * hypothesis-mode research session (evidence searched for and against, plus the person's own
 * knowledge), and the result becomes the hypothesis's current verdict. Every test is kept, so the
 * verdict's history shows how the evidence moved.
 */

export async function recordHypothesisResult(workspaceId: string, hypothesisId: string, researchId: string, report: ResearchReport) {
  const h = report.hypothesis;
  if (!h) {
    // No AI synthesis (or a follow-up research run): sources are kept, the verdict doesn't change.
    await db().query("UPDATE hypotheses SET status = CASE WHEN status='testing' THEN COALESCE(verdict->>'verdict', 'untested') ELSE status END, updated_at=now() WHERE id=$1 AND workspace_id=$2", [hypothesisId, workspaceId]);
    return;
  }
  const verdict = { ...h, research_id: researchId, tested_at: new Date().toISOString() };
  const r = await db().query<any>(
    `UPDATE hypotheses SET status=$3, confidence=$4, verdict=$5, last_research_id=$6, tested_at=now(), updated_at=now()
     WHERE id=$1 AND workspace_id=$2 RETURNING statement`,
    [hypothesisId, workspaceId, h.verdict, h.confidence, JSON.stringify(verdict), researchId]);
  if (!r.rows[0]) return;
  await upsertNode(workspaceId, { kind: "concept", title: `Hypothesis: ${r.rows[0].statement}`.slice(0, 200), summary: `${h.verdict} (confidence ${Math.round(h.confidence * 100)}%). ${h.reasoning}`, category: "hypothesis", refType: "hypothesis", refId: hypothesisId }, { suggest: false });
  await logActivity(workspaceId, "research.completed", `Hypothesis ${h.verdict}: ${r.rows[0].statement.slice(0, 160)}`, { type: "research", id: researchId });
}
