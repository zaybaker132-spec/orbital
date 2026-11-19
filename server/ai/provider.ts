import type * as z from "zod/v4";
import { config } from "../config.js";
import { languageInstruction } from "../lib/language.js";
import { checkBudget } from "../lib/usage.js";

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type Effort = "low" | "medium" | "high" | "xhigh";

export interface StreamOptions {
  system: string;
  messages: ChatMsg[];
  effort?: Effort;
  maxTokens?: number;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface JsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
}

/** A passage the model quoted from a live web page, with the page it came from. */
export interface WebCitation { url: string; title: string; citedText: string }
export interface WebSearchResult { text: string; citations: WebCitation[]; results: { url: string; title: string; pageAge: string | null }[] }

export interface LLMProvider {
  id: "anthropic" | "openai";
  model: string;
  stream(opts: StreamOptions): Promise<{ text: string; stopReason: string }>;
  json<T>(opts: JsonOptions<T>): Promise<T>;
  /** Live web search with verifiable citations. Only some providers support it. */
  webSearch?(opts: { query: string; instructions: string; maxUses?: number }): Promise<WebSearchResult>;
  /** Read an image (or, for Claude, a PDF) and return Markdown. Only some providers support it. */
  readFile?(opts: { data: Buffer; mediaType: string; instructions: string }): Promise<string>;
}

export class AIUnavailableError extends Error {
  noRetry = true;
  constructor() {
    super("No AI provider is configured. Set ANTHROPIC_API_KEY (or an OpenAI-compatible endpoint) on the server — see README.");
  }
}

let cached: LLMProvider | null | undefined;

export async function getLLM(): Promise<LLMProvider | null> {
  if (cached !== undefined) return cached;
  let base: LLMProvider | null = null;
  if (config.ai.provider === "anthropic") base = new (await import("./anthropic.js")).AnthropicProvider();
  else if (config.ai.provider === "openai") base = new (await import("./openai.js")).OpenAICompatProvider();
  cached = base && inLanguage(base);
  return cached;
}

/**
 * Every answer, report and summary is written in the language of the person it's for (see lib/language).
 * The instruction goes at the end of the system prompt, so English prompts are unchanged.
 * File reading is left alone: a document is transcribed in its own language.
 */
function inLanguage(p: LLMProvider): LLMProvider {
  // Every call first checks the workspace's monthly AI allowance (ORBITAL_AI_MONTHLY_TOKENS), if one is set.
  return {
    id: p.id,
    get model() { return p.model; },
    stream: async (o) => { await checkBudget(); return p.stream({ ...o, system: o.system + languageInstruction() }); },
    json: async (o) => { await checkBudget(); return p.json({ ...o, system: o.system + languageInstruction() }); },
    webSearch: p.webSearch && (async (o) => { await checkBudget(); return p.webSearch!({ ...o, instructions: o.instructions + languageInstruction() }); }),
    readFile: p.readFile && (async (o) => { await checkBudget(); return p.readFile!(o); }),
  };
}

export async function requireLLM(): Promise<LLMProvider> {
  const llm = await getLLM();
  if (!llm) throw new AIUnavailableError();
  return llm;
}

export function aiStatus() {
  return {
    provider: config.ai.provider,
    model: config.ai.provider === "anthropic" ? config.ai.anthropicModel : config.ai.provider === "openai" ? config.ai.openaiModel : null,
    webSearch: config.ai.provider === "anthropic" && config.research.webSearch,
    embeddings: config.embeddings.provider === "openai" ? `${config.embeddings.model} (remote)` : "local hashed features (lexical)",
  };
}

/**
 * Turn provider failures into a sentence a person can act on (never raw JSON).
 * Works for Anthropic SDK errors (status + parsed error body) and plain Errors.
 */
export function describeAiError(e: any): string {
  const status: number | undefined = e?.status;
  const body = e?.error?.error ?? e?.error;
  const type: string = body?.type ?? "";
  const detail: string = typeof body?.message === "string" ? body.message : "";
  const text = `${detail} ${e?.message ?? ""}`;
  if (e?.name === "AiBudgetError" || e instanceof Error && /AI allowance for this month/.test(e.message)) return e.message;
  if (/credit balance is too low|billing/i.test(text)) return "Your Anthropic account has no API credit. Add credit at console.anthropic.com under Plans & Billing, then try again.";
  if (status === 401 || type === "authentication_error") return "The AI provider rejected the API key. Check the key in Settings (desktop app) or the server's ANTHROPIC_API_KEY.";
  if (status === 403 || type === "permission_error") return "This API key isn't allowed to use that model or feature.";
  if (status === 429 || type === "rate_limit_error") return "The AI provider is rate-limiting requests. Try again in a minute.";
  if (status === 529 || type === "overloaded_error" || (status !== undefined && status >= 500)) return "The AI provider is temporarily unavailable. Try again shortly.";
  if (e?.name === "APIConnectionError" || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(text)) return "Couldn't reach the AI provider. Check the internet connection and try again.";
  if (detail) return detail.slice(0, 300);
  return e?.message ? String(e.message).replace(/^\d{3}\s+\{.*$/s, "The AI provider returned an error.").slice(0, 300) : "Something went wrong.";
}
