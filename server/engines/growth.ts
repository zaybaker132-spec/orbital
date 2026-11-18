import { db } from "../db/client.js";
import { clusters } from "./graph.js";

/** THE ORBITAL GROWTH SYSTEM — every number here is a live count from the user's own data. */

export async function growthStats(workspaceId: string) {
  const one = async (sql: string) => Number((await db().query<{ n: number }>(sql, [workspaceId])).rows[0]?.n ?? 0);
  const [
    nodes, confirmedEdges, suggestedEdges, memories, pendingMemories, research, concepts30,
    verifiedFindings, userConfirmed, retrievalUses, retrievalHelpful, gapsResolved, gapsOpen, oppsActed, corrected,
  ] = await Promise.all([
    one("SELECT count(*)::int n FROM knowledge_nodes WHERE workspace_id=$1"),
    one("SELECT count(*)::int n FROM knowledge_edges WHERE workspace_id=$1 AND status='confirmed'"),
    one("SELECT count(*)::int n FROM knowledge_edges WHERE workspace_id=$1 AND status='suggested'"),
    one("SELECT count(*)::int n FROM memories WHERE workspace_id=$1 AND status='active'"),
    one("SELECT count(*)::int n FROM memories WHERE workspace_id=$1 AND status='pending'"),
    one("SELECT count(*)::int n FROM research_sessions WHERE workspace_id=$1 AND status='completed'"),
    one("SELECT count(*)::int n FROM knowledge_nodes WHERE workspace_id=$1 AND kind IN ('concept','finding','note','document') AND created_at > now() - interval '30 days'"),
    one(`SELECT count(*)::int n FROM research_sessions r, jsonb_array_elements(COALESCE(r.report->'findings','[]'::jsonb)) f
         WHERE r.workspace_id=$1 AND f->>'level'='verified' AND jsonb_array_length(f->'source_refs') > 0`),
    one("SELECT count(*)::int n FROM knowledge_edges WHERE workspace_id=$1 AND status='confirmed' AND origin IN ('ai','similarity')"),
    one("SELECT COALESCE(sum(use_count),0)::int n FROM memories WHERE workspace_id=$1"),
    one(`SELECT count(*)::int n FROM feedback f JOIN messages m ON m.id=f.target_id
         WHERE f.workspace_id=$1 AND f.target_type='message' AND f.rating > 0 AND jsonb_array_length(COALESCE(m.metadata->'context'->'memories','[]'::jsonb)) > 0`),
    one("SELECT count(*)::int n FROM knowledge_gaps WHERE workspace_id=$1 AND status='resolved'"),
    one("SELECT count(*)::int n FROM knowledge_gaps WHERE workspace_id=$1 AND status='open'"),
    one("SELECT count(*)::int n FROM opportunities WHERE workspace_id=$1 AND status IN ('investigating','validated','executing','succeeded')"),
    one("SELECT count(*)::int n FROM memories WHERE workspace_id=$1 AND user_corrected"),
  ]);
  const cl = await clusters(workspaceId);
  const kinds = Object.fromEntries(
    (await db().query<{ kind: string; n: number }>("SELECT kind, count(*)::int AS n FROM knowledge_nodes WHERE workspace_id=$1 GROUP BY kind", [workspaceId])).rows.map((r) => [r.kind, r.n]),
  );
  return {
    kinds,
    volume: { nodes, confirmedEdges, suggestedEdges, memories, pendingMemories, research, newConcepts30d: concepts30, clusters: cl.length },
    quality: {
      verifiedFindings,
      userConfirmedInsights: userConfirmed,
      memoryRetrievals: retrievalUses,
      helpfulRetrievals: retrievalHelpful,
      resolvedGaps: gapsResolved,
      openGaps: gapsOpen,
      opportunitiesActedOn: oppsActed,
      correctedMemories: corrected,
    },
    clusters: cl.slice(0, 12).map(({ size, label }) => ({ size, label })),
  };
}

export async function growingSubjects(workspaceId: string) {
  const r = await db().query<{ subject: string; recent: number; earlier: number }>(
    `SELECT COALESCE(NULLIF(category,''), kind) AS subject,
            count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS recent,
            count(*) FILTER (WHERE created_at <= now() - interval '30 days')::int AS earlier
     FROM knowledge_nodes WHERE workspace_id=$1 GROUP BY 1 HAVING count(*) FILTER (WHERE created_at > now() - interval '30 days') > 0
     ORDER BY recent DESC LIMIT 8`,
    [workspaceId],
  );
  return r.rows;
}

export async function timeline(workspaceId: string, weeks = 12) {
  const r = await db().query<{ week: string; type: string; n: number }>(
    `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, split_part(type, '.', 1) AS type, count(*)::int AS n
     FROM activity_events WHERE workspace_id=$1 AND created_at > now() - ($2::int * interval '1 week')
     GROUP BY 1, 2 ORDER BY 1`,
    [workspaceId, weeks],
  );
  const recent = await db().query(
    "SELECT id, type, title, ref_type, ref_id, created_at FROM activity_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 40",
    [workspaceId],
  );
  return { weekly: r.rows, recent: recent.rows };
}

/** Periodic self-maintenance: duplicates, stale items, contradictions, unused knowledge, open questions. */
export async function maintenance(workspaceId: string) {
  const [duplicates, outdated, contradictions, unused, gaps, pending] = await Promise.all([
    db().query(
      `SELECT a.id AS a_id, a.content AS a_content, b.id AS b_id, b.content AS b_content, round((1 - (a.embedding <=> b.embedding))::numeric, 3) AS similarity
       FROM memories a JOIN memories b ON a.workspace_id=b.workspace_id AND a.id < b.id AND a.embedding_model = b.embedding_model
       WHERE a.workspace_id=$1 AND a.status='active' AND b.status='active' AND (a.embedding <=> b.embedding) < 0.12
       ORDER BY a.embedding <=> b.embedding LIMIT 20`,
      [workspaceId],
    ),
    db().query(
      `SELECT id, content, category, updated_at FROM memories WHERE workspace_id=$1 AND status='active'
         AND category IN ('project','decision','goal','context') AND updated_at < now() - interval '120 days'
         AND (last_used_at IS NULL OR last_used_at < now() - interval '60 days')
       ORDER BY updated_at LIMIT 20`,
      [workspaceId],
    ),
    db().query(
      `SELECT e.id, e.status, e.rationale, a.id AS a_id, a.title AS a_title, b.id AS b_id, b.title AS b_title
       FROM knowledge_edges e JOIN knowledge_nodes a ON a.id=e.source_id JOIN knowledge_nodes b ON b.id=e.target_id
       WHERE e.workspace_id=$1 AND e.relation='contradicts' AND e.status <> 'rejected' LIMIT 20`,
      [workspaceId],
    ),
    db().query(
      `SELECT n.id, n.kind, n.title, n.created_at FROM knowledge_nodes n
       WHERE n.workspace_id=$1 AND n.access_count=0 AND n.created_at < now() - interval '60 days'
         AND NOT EXISTS (SELECT 1 FROM knowledge_edges e WHERE e.status='confirmed' AND (e.source_id=n.id OR e.target_id=n.id))
       ORDER BY n.created_at LIMIT 20`,
      [workspaceId],
    ),
    db().query("SELECT id, question, origin, origin_id, created_at FROM knowledge_gaps WHERE workspace_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 30", [workspaceId]),
    db().query("SELECT count(*)::int n FROM memories WHERE workspace_id=$1 AND status='pending'", [workspaceId]),
  ]);
  return {
    duplicates: duplicates.rows,
    outdated: outdated.rows,
    contradictions: contradictions.rows,
    unused: unused.rows,
    gaps: gaps.rows,
    pendingMemories: pending.rows[0].n,
  };
}
