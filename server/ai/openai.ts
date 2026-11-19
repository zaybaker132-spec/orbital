import * as z from "zod/v4";
import { config } from "../config.js";
import type { JsonOptions, LLMProvider, StreamOptions } from "./provider.js";
import { recordUsage } from "../lib/usage.js";

/** Every call has a deadline (ANTHROPIC_TIMEOUT_MS applies to this provider too), plus the caller's own abort signal. */
const deadline = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(config.aiLimits.timeoutMs)]) : AbortSignal.timeout(config.aiLimits.timeoutMs));
const usageOf = (u: any) => ({ input: Number(u?.prompt_tokens ?? 0), output: Number(u?.completion_tokens ?? 0), cacheRead: Number(u?.prompt_tokens_details?.cached_tokens ?? 0) });

/**
 * Generic OpenAI-compatible chat endpoint (OpenAI, Azure-compatible gateways, Ollama, LM Studio, vLLM…).
 * No web search: research falls back to the keyless source connectors.
 */
export class OpenAICompatProvider implements LLMProvider {
  id = "openai" as const;
  model = config.ai.openaiModel;

  private headers() {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (process.env.OPENAI_API_KEY) h.authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
    return h;
  }

  async stream(o: StreamOptions) {
    const res = await fetch(`${config.ai.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      signal: deadline(o.signal),
      body: JSON.stringify({ model: this.model, stream: true, stream_options: { include_usage: true }, max_tokens: o.maxTokens ?? 8000, messages: [{ role: "system", content: o.system }, ...o.messages] }),
    });
    if (!res.ok || !res.body) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", stopReason = "end_turn", usage: any = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) { text += delta; o.onText?.(delta); }
          if (j.choices?.[0]?.finish_reason) stopReason = j.choices[0].finish_reason;
          if (j.usage) usage = j.usage;
        } catch { /* partial line */ }
      }
    }
    await recordUsage("openai", this.model, usageOf(usage));
    return { text, stopReason };
  }

  /** Images only (as data URLs); needs a vision-capable model. */
  async readFile(o: { data: Buffer; mediaType: string; instructions: string }): Promise<string> {
    if (!o.mediaType.startsWith("image/")) throw Object.assign(new Error("This AI provider can only read images."), { noRetry: true });
    const res = await fetch(`${config.ai.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      signal: deadline(),
      body: JSON.stringify({ model: this.model, max_tokens: 8000, messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${o.mediaType};base64,${o.data.toString("base64")}` } },
        { type: "text", text: o.instructions },
      ] }] }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    await recordUsage("openai", this.model, usageOf(j.usage));
    return j.choices?.[0]?.message?.content ?? "";
  }

  async json<T>(o: JsonOptions<T>): Promise<T> {
    const schema = JSON.stringify(z.toJSONSchema(o.schema as any));
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${config.ai.openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        signal: deadline(),
        body: JSON.stringify({
          model: this.model,
          max_tokens: o.maxTokens ?? 8000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${o.system}\n\nRespond ONLY with a JSON object matching this JSON Schema:\n${schema}` },
            { role: "user", content: o.prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j: any = await res.json();
      await recordUsage("openai", this.model, usageOf(j.usage));
      try {
        const parsed = o.schema.safeParse(JSON.parse(j.choices?.[0]?.message?.content ?? ""));
        if (parsed.success) return parsed.data;
      } catch { /* retry */ }
    }
    throw new Error("Model returned output that did not match the expected schema");
  }
}
