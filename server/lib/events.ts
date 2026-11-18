import type { Response } from "express";

/**
 * Per-user live event bus (Server-Sent Events). Drives real application state in the UI —
 * including the Neural Core's animation states — from what the server is actually doing.
 */
export type CoreState = "idle" | "thinking" | "researching" | "learning" | "connecting" | "opportunity";
export type OrbitalEvent =
  | { type: "core"; state: CoreState; detail?: string; weight?: number }
  | { type: "research"; id: string; status: string; step?: { label: string; detail?: string } }
  | { type: "knowledge"; nodesAdded?: number; edgesAdded?: number; memoriesAdded?: number; pending?: number }
  | { type: "opportunities"; status: "started" | "done" | "error"; count?: number; error?: string }
  | { type: "notice"; level: "info" | "warn"; message: string }
  | { type: "actions" }
  /** Personal: delivered only to the windows of `userId`. */
  | { type: "reminder"; userId: string; id: string; title: string; note: string; link: string | null };

interface Client { res: Response; userId: string }
const clients = new Map<string, Set<Client>>();

export function subscribe(workspaceId: string, res: Response, userId: string) {
  let set = clients.get(workspaceId);
  if (!set) clients.set(workspaceId, (set = new Set()));
  const c = { res, userId };
  set.add(c);
  return () => {
    set!.delete(c);
    if (!set!.size) clients.delete(workspaceId);
  };
}

export function emit(workspaceId: string, event: OrbitalEvent) {
  const set = clients.get(workspaceId);
  if (!set) return;
  const only = "userId" in event ? event.userId : null;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of set) if (!only || c.userId === only) c.res.write(payload);
}

/** Bracket a unit of work with core state transitions. */
export async function withCoreState<T>(workspaceId: string, state: CoreState, detail: string, fn: () => Promise<T>): Promise<T> {
  emit(workspaceId, { type: "core", state, detail });
  try {
    return await fn();
  } finally {
    emit(workspaceId, { type: "core", state: "idle" });
  }
}
