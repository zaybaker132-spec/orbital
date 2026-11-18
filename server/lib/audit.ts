import { db } from "../db/client.js";

/** Append-only record of consequential changes in a workspace: who, what, when. */
export async function audit(workspaceId: string, actor: { id?: string | null; label?: string }, action: string, target?: { type: string; id?: string | null }, detail: Record<string, unknown> = {}) {
  await db().query(
    "INSERT INTO audit_log(workspace_id, actor_id, actor_label, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [workspaceId, actor.id ?? null, actor.label ?? "", action, target?.type ?? null, target?.id ?? null, JSON.stringify(detail)],
  );
}
