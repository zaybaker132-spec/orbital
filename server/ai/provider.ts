import type * as z from "zod/v4";
import { config } from "../config.js";

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
  if (config.ai.provider === "anthropic") cached = new (await import("./anthropic.js")).AnthropicProvider();
  else if (config.ai.provider === "openai") cached = new (await import("./openai.js")).OpenAICompatProvider();
  else cached = null;
  return cached;
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
