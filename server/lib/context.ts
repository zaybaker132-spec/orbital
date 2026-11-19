import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/**
 * Who and what the current work is for: set per HTTP request (request id, then the signed-in user and
 * workspace once resolved) and per background job. Logs and AI usage records read it, so every line
 * and every token can be traced to a request or job without passing ids through every function.
 */
export interface WorkContext {
  requestId: string;
  userId?: string;
  workspaceId?: string;
  /** "api:POST /api/docs/:id/assist", "job:research.run", "schedule:automations"… */
  feature?: string;
}

const store = new AsyncLocalStorage<WorkContext>();
export const newRequestId = () => crypto.randomBytes(8).toString("hex");
export const currentContext = (): WorkContext | undefined => store.getStore();
export const runInContext = <T>(ctx: WorkContext, fn: () => T): T => store.run(ctx, fn);
/** Add details to the current context as they become known (e.g. after the session is checked). */
export function annotateContext(patch: Partial<WorkContext>) {
  const c = store.getStore();
  if (c) Object.assign(c, patch);
}
