import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.js";
import type { JsonOptions, LLMProvider, StreamOptions, WebCitation, WebSearchResult } from "./provider.js";
import { recordUsage } from "../lib/usage.js";

/** Token usage exactly as the API reports it (cache reads and writes separately). */
type ApiUsage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined;
const usageOf = (u: ApiUsage) => ({ input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheWrite: u?.cache_creation_input_tokens ?? 0 });

/**
 * Claude via the official SDK. Uses adaptive thinking (always on for this model family) with
 * effort as the depth control, and server-side refusal fallbacks (beta) unless disabled.
 */
export class AnthropicProvider implements LLMProvider {
  id = "anthropic" as const;
  model = config.ai.anthropicModel;
  // Timeouts and retries (429, 5xx, connection errors) are handled by the SDK; both are configurable.
  private client = new Anthropic({ timeout: config.aiLimits.timeoutMs, maxRetries: config.aiLimits.maxRetries });
  private record(model: string, u: ApiUsage) { return recordUsage("anthropic", model, usageOf(u)); }

  private fallback() {
    return config.ai.anthropicFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  }

  async stream(o: StreamOptions) {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: o.maxTokens ?? 32000,
        system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
        messages: o.messages,
        output_config: { effort: o.effort ?? "medium" },
        ...this.fallback(),
      },
      { signal: o.signal },
    );
    if (o.onText) stream.on("text", (t) => o.onText!(t));
    const final = await stream.finalMessage();
    await this.record(final.model ?? this.model, final.usage);
    let text = final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (final.stop_reason === "refusal") text += "\n\n_The model declined to continue this response._";
    return { text, stopReason: final.stop_reason ?? "end_turn" };
  }

  /** Structured output (JSON schema enforced server-side). Streamed so large outputs never hit request timeouts. */
  async json<T>(o: JsonOptions<T>): Promise<T> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: o.maxTokens ?? 16000,
      system: o.system,
      messages: [{ role: "user", content: o.prompt }],
      output_config: { effort: o.effort ?? "low", format: betaZodOutputFormat(o.schema as any) },
      ...this.fallback(),
    });
    const res = await stream.finalMessage();
    await this.record(res.model ?? this.model, res.usage);
    if (res.stop_reason === "refusal") throw Object.assign(new Error("Model declined this request"), { noRetry: true });
    if (res.stop_reason === "max_tokens") throw new Error("Model output was truncated before the structured result was complete");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("Model returned output that was not valid JSON"); }
    const parsed = o.schema.safeParse(raw);
    if (!parsed.success) throw new Error("Model returned output that did not match the expected schema");
    return parsed.data;
  }

  async readFile(o: { data: Buffer; mediaType: string; instructions: string }): Promise<string> {
    const b64 = o.data.toString("base64");
    const block: Anthropic.Beta.BetaContentBlockParam = o.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: o.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: b64 } };
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 16000,
      messages: [{ role: "user", content: [block, { type: "text", text: o.instructions }] }],
      output_config: { effort: "low" },
      ...this.fallback(),
    });
    const res = await stream.finalMessage();
    await this.record(res.model ?? this.model, res.usage);
    if (res.stop_reason === "refusal") throw Object.assign(new Error("Model declined to read this file"), { noRetry: true });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }

  async webSearch(o: { query: string; instructions: string; maxUses?: number }): Promise<WebSearchResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `${o.instructions}\n\nResearch question: ${o.query}` }];
    const citations: WebCitation[] = [];
    const results: WebSearchResult["results"] = [];
    let text = "";
    for (let turn = 0; turn < 4; turn++) {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: o.maxUses ?? 4 }],
        output_config: { effort: "low" },
        ...this.fallback(),
      });
      await this.record(res.model ?? this.model, res.usage);
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) results.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
        } else if (block.type === "text") {
          text += block.text;
          for (const c of block.citations ?? []) {
            if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? c.url, citedText: c.cited_text });
          }
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content as any });
    }
    return { text, citations, results };
  }
}
