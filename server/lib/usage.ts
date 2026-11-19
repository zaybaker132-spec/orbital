import { db } from "../db/client.js";
import { config } from "../config.js";
import { currentContext } from "./context.js";
import { log } from "./log.js";

/**
 * AI usage and cost. Every model call records the tokens the provider reported, against the workspace
 * and person it ran for (from the request or job context), with an estimated cost at list price.
 * An optional monthly token cap per workspace (ORBITAL_AI_MONTHLY_TOKENS) stops runaway spend.
 */

/** List prices in US dollars per million tokens. Cache writes are billed at 1.25x input (5-minute cache). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};
/** Operators can override or add a price: AI_PRICE_<MODEL>="input,output,cacheRead" (e.g. AI_PRICE_GPT_4O="2.5,10,1.25"). */
function priceFor(model: string) {
  const env = process.env[`AI_PRICE_${model.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`];
  if (env) {
    const [input, output, cacheRead] = env.split(",").map(Number);
    if ([input, output].every(Number.isFinite)) return { input, output, cacheRead: Number.isFinite(cacheRead) ? cacheRead : input };
  }
  return PRICES[model] ?? null;
}

export interface Usage { input: number; output: number; cacheRead?: number; cacheWrite?: number }

export function estimateMicroUsd(model: string, u: Usage) {
  const p = priceFor(model);
  if (!p) return 0;
  const usd = (u.input * p.input + u.output * p.output + (u.cacheRead ?? 0) * p.cacheRead + (u.cacheWrite ?? 0) * p.input * 1.25) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

/** Never throws: usage accounting must not break the feature it measures. */
export async function recordUsage(provider: string, model: string, u: Usage, ok = true) {
  const ctx = currentContext();
  try {
    await db().query(
      `INSERT INTO ai_usage(workspace_id, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, ok)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ctx?.workspaceId ?? null, ctx?.userId ?? null, (ctx?.feature ?? "").slice(0, 120), provider, model, u.input, u.output, u.cacheRead ?? 0, u.cacheWrite ?? 0, estimateMicroUsd(model, u), ok],
    );
  } catch (e) {
    log.warn("could not record AI usage", { err: e });
  }
}

export class AiBudgetError extends Error {
  noRetry = true;
  status = 429;
  constructor() { super("This workspace has used its AI allowance for this month. It resets on the 1st; a server admin can raise ORBITAL_AI_MONTHLY_TOKENS."); }
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/** Throws AiBudgetError when the current workspace is over its monthly token cap. */
export async function checkBudget() {
  const cap = config.aiLimits.monthlyTokensPerWorkspace;
  const ws = currentContext()?.workspaceId;
  if (!cap || !ws) return;
  const r = await db().query<{ n: string }>("SELECT COALESCE(sum(input_tokens + output_tokens + cache_write_tokens), 0)::bigint AS n FROM ai_usage WHERE workspace_id=$1 AND created_at >= $2", [ws, monthStart()]);
  if (Number(r.rows[0].n) >= cap) throw new AiBudgetError();
}

/** This month's usage for one workspace (or all, for server admins), by feature and model. */
export async function usageSummary(workspaceId: string | null) {
  const where = workspaceId ? "workspace_id=$2 AND" : "";
  const params: unknown[] = [monthStart(), ...(workspaceId ? [workspaceId] : [])];
  const q = (sql: string) => db().query<any>(sql.replace("$WS", where), params);
  const totals = (await q(`SELECT count(*)::int AS requests, COALESCE(sum(input_tokens),0)::bigint AS input, COALESCE(sum(output_tokens),0)::bigint AS output,
      COALESCE(sum(cache_read_tokens),0)::bigint AS cache_read, COALESCE(sum(cache_write_tokens),0)::bigint AS cache_write, COALESCE(sum(cost_micro_usd),0)::bigint AS cost,
      count(*) FILTER (WHERE NOT ok)::int AS failed FROM ai_usage WHERE $WS created_at >= $1`)).rows[0];
  const byFeature = (await q(`SELECT feature, count(*)::int AS requests, COALESCE(sum(input_tokens + output_tokens),0)::bigint AS tokens, COALESCE(sum(cost_micro_usd),0)::bigint AS cost
      FROM ai_usage WHERE $WS created_at >= $1 GROUP BY feature ORDER BY cost DESC, tokens DESC LIMIT 20`)).rows;
  const byWorkspace = workspaceId ? [] : (await db().query<any>(`SELECT u.workspace_id, w.name, count(*)::int AS requests, COALESCE(sum(u.input_tokens + u.output_tokens),0)::bigint AS tokens, COALESCE(sum(u.cost_micro_usd),0)::bigint AS cost
      FROM ai_usage u LEFT JOIN workspaces w ON w.id=u.workspace_id WHERE u.created_at >= $1 GROUP BY u.workspace_id, w.name ORDER BY cost DESC LIMIT 50`, [monthStart()])).rows;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    since: monthStart().toISOString(),
    cap: config.aiLimits.monthlyTokensPerWorkspace || null,
    requests: totals.requests, failed: totals.failed,
    tokens: { input: num(totals.input), output: num(totals.output), cacheRead: num(totals.cache_read), cacheWrite: num(totals.cache_write) },
    costUsd: num(totals.cost) / 1_000_000,
    byFeature: byFeature.map((r: any) => ({ feature: r.feature || "other", requests: r.requests, tokens: num(r.tokens), costUsd: num(r.cost) / 1_000_000 })),
    byWorkspace: byWorkspace.map((r: any) => ({ workspaceId: r.workspace_id, name: r.name ?? "(deleted)", requests: r.requests, tokens: num(r.tokens), costUsd: num(r.cost) / 1_000_000 })),
  };
}
