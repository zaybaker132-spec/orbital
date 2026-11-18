import { db } from "../db/client.js";

export type ActivityType =
  | "memory.created" | "memory.confirmed" | "memory.corrected" | "memory.deleted"
  | "node.created" | "edge.confirmed" | "edge.suggested"
  | "research.completed" | "research.failed"
  | "document.created" | "document.imported"
  | "project.created" | "task.completed" | "milestone.completed"
  | "opportunity.identified" | "opportunity.status"
  | "gap.opened" | "gap.resolved" | "feedback.given" | "automation.ran";

export async function logActivity(workspaceId: string, type: ActivityType, title: string, ref?: { type: string; id: string }, detail: Record<string, unknown> = {}) {
  await db().query(
    "INSERT INTO activity_events(workspace_id, type, title, ref_type, ref_id, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [workspaceId, type, title.slice(0, 300), ref?.type ?? null, ref?.id ?? null, JSON.stringify(detail)],
  );
}
