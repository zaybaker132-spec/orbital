import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startMockAnthropic, type MockCall } from "./mockAnthropic.js";

// AI pipeline through the real Anthropic SDK against a local deterministic mock (no network, no key).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-ai-test-"));
let mock: { url: string; calls: MockCall[]; close: () => void };
let server: Server;
let base = "";
let cookie = "";

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text), text }; } catch { return { status: res.status, data: null, text }; }
}
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}

before(async () => {
  mock = await startMockAnthropic();
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: mock.url,
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", RESEARCH_WEB_SEARCH: "true", DATABASE_URL: process.env.TEST_DATABASE_URL || "",
  });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  assert.equal((await req("POST", "/api/auth/signup", { email: "ai@example.com", password: "long enough password" })).status, 201);
});

after(async () => {
  server?.close();
  mock?.close();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("chat streams through the SDK, cites retrieved memories, extracts verified memories", async () => {
  await req("POST", "/api/memories", { content: "Wants to launch a scheduling product for salons", category: "goal" });
  const c = await req("POST", "/api/conversations", {});
  const r = await req("POST", `/api/conversations/${c.data.id}/messages`, { content: "I want to reach 10 paying salon customers by spring. What should I focus on?", mode: "deep_thinking" });
  assert.match(r.text, /event: context/);
  assert.match(r.text, /Based on your goal \[M1\]/);
  const chatCall = mock.calls.find((x) => x.body.stream && !x.body.output_config?.format);
  assert.ok(chatCall, "a streaming request was made");
  assert.equal(chatCall!.body.model, "claude-opus-5-5");
  assert.equal(chatCall!.body.output_config.effort, "high", "deep thinking runs at high effort");
  assert.equal(chatCall!.body.fallbacks, "default", "server-side refusal fallback enabled");
  assert.match(String(chatCall!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  const sys = JSON.stringify(chatCall!.body.system);
  assert.match(sys, /Deep Thinking/);
  assert.match(JSON.stringify(chatCall!.body.messages), /<context>[\s\S]*scheduling product for salons/, "retrieved memory injected as context");

  const conv = await until(async () => { const x = await req("GET", `/api/conversations/${c.data.id}`); return x.data.title !== "New conversation" && x.data; });
  assert.equal(conv.title, "Mock conversation title");
  const mem = await until(async () => { const x = await req("GET", "/api/memories"); return x.data.find((m: any) => m.origin === "extracted") ; });
  assert.equal(mem.status, "active", "evidence matched the user's words, so the memory was saved");
  assert.match(mem.source_excerpt, /10 paying salon customers/);
  const gaps = await until(async () => { const x = await req("GET", "/api/growth/maintenance"); return x.data.gaps.length && x.data.gaps; });
  assert.match(gaps[0].question, /salons pay/);
});

test("answers follow the person's language; English prompts are unchanged", async () => {
  const c = await req("POST", "/api/conversations", {});
  const before = mock.calls.length;
  const res = await fetch(`${base}/api/conversations/${c.data.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-orbital-request": "1", "x-orbital-language": "es", cookie },
    body: JSON.stringify({ content: "¿En qué debería centrarme esta semana?" }),
  });
  await res.text();
  const call = mock.calls.slice(before).find((x) => x.body.stream && !x.body.output_config?.format);
  assert.ok(call, "a streaming request was made");
  assert.match(JSON.stringify(call!.body.system), /Output language: write every human-readable sentence of your answer in Spanish/);
  // Background work started from this request (the conversation title) keeps the language too.
  await until(async () => mock.calls.slice(before).some((x) => /Spanish/.test(JSON.stringify(x.body.system)) && /title/i.test(JSON.stringify(x.body.system))));
  // English requests carry no language instruction.
  const english = mock.calls.slice(0, before).filter((x) => /Output language/.test(JSON.stringify(x.body.system)));
  assert.equal(english.length, 0);
});

test("research: plan → web sources with citations → synthesis → verification drops fabrications", async () => {
  const r = await req("POST", "/api/research", { question: "How are small businesses adopting AI scheduling tools?" });
  const done = await until(async () => { const x = await req("GET", `/api/research/${r.data.id}`); return ["completed", "failed"].includes(x.data.status) && x.data; }, 15000);
  assert.equal(done.status, "completed", done.error);
  assert.equal(done.sources.length, 1);
  assert.equal(done.sources[0].provider, "web");
  assert.match(done.sources[0].excerpt, /42% of small businesses/);
  const rep = done.report;
  assert.equal(rep.mode, "synthesized");
  assert.equal(rep.findings[0].level, "verified");
  assert.deepEqual(rep.findings[1].source_refs, [], "citation to non-existent source removed");
  assert.equal(rep.findings[1].level, "inference", "unsupported 'verified' claim downgraded");
  assert.equal(rep.statistics.length, 1, "invented statistic dropped");
  assert.equal(rep.statistics[0].value, "42%");
  assert.equal(rep.statistics[0].verified, true);
  assert.deepEqual(rep.dropped, { findings: 1, statistics: 1 });
  const graph = await req("GET", "/api/graph");
  assert.ok(graph.data.nodes.some((n: any) => n.kind === "finding"), "verified finding joined the graph");
  assert.ok(graph.data.nodes.some((n: any) => n.kind === "research"));
});

test("opportunities: grounded discovery, validation research, execution plan", async () => {
  await req("POST", "/api/memories", { content: "Skilled in TypeScript and React", category: "skill" });
  await req("POST", "/api/memories", { content: "Interested in AI automation for local businesses", category: "interest" });
  assert.equal((await req("POST", "/api/opportunities/discover", {})).status, 202);
  const opps = await until(async () => { const x = await req("GET", "/api/opportunities"); return x.data.length && x.data; });
  const o = opps[0];
  assert.equal(o.title, "AI booking assistant for salons");
  assert.ok(o.memory_ids.length >= 1, "grounded in a real memory id");
  assert.equal(o.market_evidence[0].url, "https://example.org/small-business-ai-2025", "evidence links a real retrieved source");
  const v = await req("POST", `/api/opportunities/${o.id}/validate`);
  assert.equal(v.status, 202);
  await until(async () => { const x = await req("GET", "/api/opportunities"); return x.data[0].status === "validated" && x.data[0]; }, 15000);
  const plan = await req("POST", `/api/opportunities/${o.id}/plan`);
  const p = await req("GET", `/api/projects/${plan.data.projectId}`);
  assert.equal(p.data.milestones.length, 1);
  assert.equal(p.data.tasks.length, 2);
  const brief = await req("GET", `/api/projects/${plan.data.projectId}/brief`);
  assert.equal(brief.data.aiGenerated, true);
});

test("the API key never reaches the browser", async () => {
  const me = await req("GET", "/api/auth/me");
  assert.doesNotMatch(me.text, /test-key-not-real/);
  const exp = await req("GET", "/api/export");
  assert.doesNotMatch(exp.text, /test-key-not-real/);
});
