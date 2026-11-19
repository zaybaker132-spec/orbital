import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startMockAnthropic, type MockCall } from "./mockAnthropic.js";

// Research intelligence: source assessment, lineage, living reports, the contradiction lab,
// hypothesis testing and knowledge extraction, through the real SDK against the local mock.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-intel-test-"));
let mock: { url: string; calls: MockCall[]; close: () => void };
let server: Server;
let base = "", cookie = "";

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text), text }; } catch { return { status: res.status, data: null as any, text }; }
}
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}
const finished = (id: string) => until(async () => { const x = await req("GET", `/api/research/${id}`); return ["completed", "failed"].includes(x.data.status) && x.data; });

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
  assert.equal((await req("POST", "/api/auth/signup", { email: "intel@example.com", password: "long enough password" })).status, 201);
  await req("POST", "/api/memories", { content: "Small businesses near me are adopting AI scheduling tools for appointments", category: "context" });
});

after(async () => {
  server?.close();
  mock?.close();
  const { stopReminders } = await import("../engines/reminders.js");
  const { stopFreshnessChecks } = await import("../engines/freshness.js");
  const { stopMaintenance } = await import("../engines/maintenance.js");
  stopReminders(); stopFreshnessChecks(); stopMaintenance();
  const { db } = await import("../db/client.js");
  await until(async () => (await db().query<any>("SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued','running')")).rows[0].n === 0);
  await new Promise((r) => setTimeout(r, 800)); // let fire-and-forget graph suggestions settle
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Pure functions ─────────────────────────────────────────────────────────
test("source intelligence: authority, recency, methodology, conflicts and corroboration signals", async () => {
  const { authorityOf, recencyOf, methodFromText, conflictsFromText, corroborationOf, combine } = await import("../engines/sourceIntel.js");
  const a = (url: string, extra: Partial<{ provider: string; source_type: string; published: string }> = {}) => authorityOf({ url, provider: "web", source_type: "web", published: "", ...extra });
  assert.equal(a("https://www.bls.gov/data").kind, "government");
  assert.equal(a("https://who.int/report").kind, "government");
  assert.equal(a("https://doi.org/10.1/x", { provider: "openalex", source_type: "scholarly", published: "2021 · cited by 340" }).score, 92);
  assert.equal(a("https://cs.stanford.edu/p").kind, "university");
  assert.equal(a("https://en.wikipedia.org/wiki/X", { provider: "wikipedia" }).kind, "encyclopedia");
  assert.equal(a("https://www.reddit.com/r/x").kind, "user_generated");
  assert.equal(a("https://www.prnewswire.com/news").kind, "press_release");
  const now = new Date("2026-06-01T00:00:00Z");
  assert.equal(recencyOf("2026", now).score, 95);
  assert.equal(recencyOf("2019 · cited by 12", now).year, 2019);
  assert.equal(recencyOf("", now).note, "Publication date not stated");
  assert.equal(methodFromText("A meta-analysis of 42 studies", "scholarly"), "meta_analysis");
  assert.equal(methodFromText("We surveyed 1,200 respondents", "web"), "survey");
  assert.equal(methodFromText("Some article", "encyclopedia"), "encyclopedia");
  assert.equal(conflictsFromText("This study was funded by Acme Corp, which sells the product.", "web").level, "possible");
  assert.equal(conflictsFromText("Plain report.", "press_release").level, "clear");
  const urls = new Map([[1, "https://a.org/x"], [2, "https://b.org/y"], [3, "https://a.org/z"]]);
  const report = { findings: [{ statement: "x", source_refs: [1, 2], level: "verified" as const }, { statement: "y", source_refs: [3], level: "verified" as const }], conflicting_evidence: [{ point: "c", source_refs: [3], note: "" }] };
  assert.equal(corroborationOf(1, report, urls).corroborated, true);
  assert.equal(corroborationOf(3, report, urls).contested, true);
  assert.equal(corroborationOf(4, report, urls).score, 40);
  const g = combine({ authority: { score: 90, note: "", kind: "government" }, recency: { score: 95, note: "", year: 2026 }, methodology: { score: 88, note: "", method: "official_statistics" }, independence: { score: 80, note: "", level: "none_evident" }, corroboration: { score: 90, note: "", findings: 2, corroborated: true, contested: false } });
  assert.equal(g.grade, "high");
});

test("living reports: shelf life by sensitivity, measured from the newest evidence", async () => {
  const { computeFreshness } = await import("../engines/freshness.js");
  const report: any = {
    mode: "synthesized",
    findings: [
      { statement: "Prices fell", source_refs: [1], level: "verified", time_sensitivity: "fast" },
      { statement: "The method is old", source_refs: [2], level: "verified", time_sensitivity: "stable" },
      { statement: "Adoption grew", source_refs: [1, 3], level: "verified", time_sensitivity: "moderate" },
      { statement: "Refreshed recently", source_refs: [1], level: "verified", time_sensitivity: "fast", refreshed_at: "2026-05-20T00:00:00Z" },
    ],
    statistics: [{ value: "5%", context: "x", source_ref: 2, quote: "", verified: true, time_sensitivity: "slow" }],
  };
  const sources = [{ ref_number: 1, published: "March 2026", retrieved_at: "2026-04-01" }, { ref_number: 2, published: "2015", retrieved_at: "2026-04-01" }, { ref_number: 3, published: "revised 2026-05-10", retrieved_at: "2026-05-10" }];
  const f = computeFreshness(report, sources, "2026-04-01T00:00:00Z", new Date("2026-06-01T00:00:00Z"))!;
  const byIdx = (s: string, i: number) => f.items.find((x) => x.section === s && x.index === i);
  assert.equal(byIdx("finding", 0)?.state, "stale", "fast fact from March is stale by June");
  assert.equal(byIdx("finding", 1), undefined, "stable facts never expire");
  assert.equal(byIdx("finding", 2), undefined, "the newest source (May) keeps a moderate fact fresh");
  assert.equal(byIdx("finding", 3), undefined, "a refresh resets the clock");
  assert.equal(byIdx("statistic", 0)?.state, "stale", "a 2015 source is past a slow fact's three-year shelf life");
  assert.equal(f.status, "stale");
  assert.equal(computeFreshness({ ...report, mode: "sources_only" }, sources, "2026-04-01"), null);
});

test("lineage: the best matching passage is the sentence that shares the claim's words", async () => {
  const { bestPassage } = await import("../engines/lineage.js");
  const p = bestPassage("42% of small businesses used AI for scheduling", "Many firms exist. In 2025, 42% of small businesses used AI tools for scheduling and customer communication. Weather was mild.");
  assert.match(p.passage, /^In 2025, 42% of small businesses/);
  assert.ok(p.overlap >= 4);
});

// ── End to end ─────────────────────────────────────────────────────────────
let researchId = "";

test("research report: verified lineage fields, conclusions, source assessments, freshness", async () => {
  const r = await req("POST", "/api/research", { question: "How are small businesses adopting AI scheduling tools?" });
  researchId = r.data.id;
  const d = await finished(researchId);
  assert.equal(d.status, "completed", d.error);
  const rep = d.report;
  assert.equal(rep.kind, "standard");
  assert.equal(rep.knowledge_items[0].ref, "K1");
  assert.deepEqual(rep.findings[0].knowledge_refs, ["K1"], "K99 doesn't exist and is dropped");
  assert.equal(rep.findings[0].time_sensitivity, "fast");
  assert.deepEqual(rep.findings[2].builds_on, [0], "a finding can only build on earlier ones");
  assert.deepEqual(rep.conclusions[0].finding_refs, [0, 2], "conclusions can only point at real findings");
  const src = d.sources[0];
  assert.equal(src.assessment.ai, true);
  assert.equal(src.assessment.factors.methodology.method, "survey");
  assert.equal(src.assessment.factors.corroboration.findings, 1);
  assert.ok(["high", "moderate", "low"].includes(src.assessment.grade));
  assert.equal(d.freshness.status, "stale", "a fast-moving fact sourced in March 2025 is past its shelf life");
  assert.ok(d.freshness.items.some((i: any) => i.section === "finding" && i.index === 0));

  const nudges = (await req("GET", "/api/nudges")).data;
  assert.ok(nudges.some((n: any) => n.kind === "stale_research" && n.itemId === researchId), "stale reports show up in Reminders");
});

test("lineage: conclusion → findings → reasoning → exact passage → source → search", async () => {
  const l = (await req("GET", `/api/research/${researchId}/lineage`)).data;
  assert.equal(l.conclusions[0].statement, "AI scheduling is mainstream among small businesses.");
  const f0 = l.findings[0];
  assert.equal(f0.reasoning, "The survey in source 1 states the figure directly.");
  assert.equal(f0.evidence[0].source, 1);
  assert.equal(f0.evidence[0].matched, true);
  assert.match(f0.evidence[0].passage, /42% of small businesses used AI tools for scheduling/);
  assert.equal(l.sources[0].subquestion.length > 0, true, "every source records the search that found it");
  assert.ok(l.plan.length >= 1);
  assert.equal(l.knowledge[0].ref, "K1");
  assert.equal((await req("GET", "/api/research/00000000-0000-4000-8000-000000000000/lineage")).status, 404);
});

test("living reports: refreshing a stale section keeps what it used to say", async () => {
  const before = (await req("GET", `/api/research/${researchId}`)).data.report.findings[0].statement;
  assert.equal((await req("POST", `/api/research/${researchId}/refresh`, { items: [] })).status, 400);
  assert.equal((await req("POST", `/api/research/${researchId}/refresh`, { items: [{ section: "finding", index: 0 }] })).status, 202);
  const d = await until(async () => { const x = await req("GET", `/api/research/${researchId}`); return x.data.status === "completed" && x.data.refreshed_at && x.data; });
  const f = d.report.findings[0];
  assert.equal(f.statement, "48% of small businesses used AI for scheduling in 2026.");
  assert.equal(f.history[0].statement, before);
  assert.equal(f.history[0].status, "updated");
  assert.ok(f.refreshed_at);
  assert.ok(!d.freshness.items.some((i: any) => i.section === "finding" && i.index === 0), "the refreshed finding is fresh again");
});

test("contradiction lab: positions, why sources disagree, what would resolve it", async () => {
  const r = await req("POST", "/api/research", { question: "Does remote work raise productivity?", kind: "contradiction" });
  const d = await finished(r.data.id);
  assert.equal(d.status, "completed", d.error);
  assert.ok(d.steps.some((s: any) => /Mapping the competing positions/.test(s.label)));
  assert.ok(d.steps.some((s: any) => /Searching \(Remote work lowers productivity\)/.test(s.label)), "each side is searched separately");
  const lab = d.report.lab;
  assert.equal(lab.positions.length, 2);
  assert.deepEqual(lab.positions[1].source_refs, [], "citations to sources that weren't retrieved are removed");
  assert.deepEqual(lab.disagreements[0].causes, ["methodology", "timeframe"]);
  assert.match(lab.disagreements[0].resolution, /multi-year/);
  assert.equal(lab.weight_of_evidence.confidence, "medium");
  assert.ok(d.sources.every((s: any) => s.position), "sources record which position they were gathered for");
});

test("hypotheses: test for and against, verdict with history, next tests", async () => {
  const h = await req("POST", "/api/hypotheses", { statement: "Most small businesses will adopt AI scheduling within two years", rationale: "Customers keep asking for it." });
  assert.equal(h.status, 201);
  assert.equal(h.data.status, "untested");
  const t = await req("POST", `/api/hypotheses/${h.data.id}/test`);
  assert.equal(t.status, 202);
  assert.equal((await req("POST", `/api/hypotheses/${h.data.id}/test`)).status, 409, "one test at a time");
  const done = await until(async () => { const x = await req("GET", `/api/hypotheses/${h.data.id}`); return x.data.status !== "testing" && x.data; });
  assert.equal(done.status, "supported");
  assert.equal(done.confidence.toFixed(2), "0.72");
  assert.equal(done.verdict.evidence_for.length, 1, "evidence citing an unretrieved source is dropped");
  assert.deepEqual(done.verdict.knowledge_evidence[0].knowledge_refs, ["K1"]);
  assert.equal(done.verdict.next_tests[0].question, "Is AI scheduling adoption growing among salons specifically?");
  assert.equal(done.tests.length, 1);
  assert.equal(done.tests[0].verdict, "supported");
  const r = (await req("GET", `/api/research/${done.last_research_id}`)).data;
  assert.equal(r.kind, "hypothesis");
  assert.ok(r.sources.some((s: any) => s.position === "for"));

  const next = await req("POST", `/api/hypotheses/${h.data.id}/next-test`, { index: 0 });
  assert.equal(next.status, 201);
  await finished(next.data.researchId);
  const after = (await req("GET", `/api/hypotheses/${h.data.id}`)).data;
  assert.equal(after.tests.length, 2, "follow-up research is part of the hypothesis's history");
  assert.equal(after.status, "supported", "a follow-up doesn't overwrite the verdict; a re-test does");
  assert.equal((await req("POST", `/api/hypotheses/${h.data.id}/next-test`, { index: 9 })).status, 400);
  assert.ok((await req("GET", "/api/search/all?q=adopt AI scheduling&types=hypothesis")).data.length >= 1);
});

test("knowledge extraction: verified concepts, evidence, timeline and relationships, into the graph and search", async () => {
  const body = [
    "Booking software is software salons use to take appointments online.",
    "In 2019 the Riverside salon group adopted booking software across all branches.",
    "Booking software reduces no-shows because clients get automatic reminders.",
    "After the change, no-shows fell by 30% within six months.",
    "Staff said the evening rush became calmer and clients rebooked more often during the following year.",
  ].join("\n\n");
  const doc = await req("POST", "/api/documents", { title: "Riverside case study", body });
  assert.equal((await req("POST", `/api/documents/${doc.data.id}/extract`)).status, 202);
  const ex = await until(async () => { const x = await req("GET", `/api/documents/${doc.data.id}/extraction`); return x.data?.status === "completed" && x.data; });
  const kind = (k: string) => ex.items.filter((i: any) => i.kind === k);
  assert.equal(ex.mode, "ai");
  assert.ok(kind("concept").some((c: any) => c.title === "Booking software"));
  assert.equal(kind("evidence").length, 1, "the invented claim's quote isn't in the text, so it's dropped");
  assert.equal(kind("evidence")[0].subtype, "statistic");
  assert.equal(kind("event")[0].sort_date, "2019");
  assert.equal(kind("relation")[0].title, "Booking software reduces No-shows");
  assert.equal(ex.stats.dropped_unverified, 1);
  assert.equal(ex.stats.graph_links, 1);
  const graph = (await req("GET", "/api/graph")).data;
  const concept = graph.nodes.find((n: any) => n.title === "Booking software");
  assert.ok(concept, "concepts join the knowledge graph");
  assert.ok(graph.edges.some((e: any) => e.status === "suggested" && /reduces/.test(e.rationale ?? "")), "relationships become suggested connections");
  const hits = (await req("GET", "/api/search/all?q=no-shows&types=extracted")).data;
  assert.ok(hits.length >= 1 && hits[0].link.includes(`/knowledge/${doc.data.id}?view=extraction`));
  const filtered = (await req("GET", `/api/documents/${doc.data.id}/extraction?q=2019`)).data.items;
  assert.ok(filtered.length >= 1 && filtered.every((i: any) => /2019/.test(`${i.title} ${i.quote} ${i.date_text}`)));
  assert.equal((await req("POST", "/api/documents", { title: "short", body: "too short" })).status, 201);
});

test("knowledge maintenance with AI: conflicting memories are resolved by choice, archived not deleted, and undoable", async () => {
  const a = await req("POST", "/api/memories", { content: "Works from the London office three days a week", category: "context" });
  const b = await req("POST", "/api/memories", { content: "No longer works from the London office; fully remote since spring", category: "context" });
  const { db } = await import("../db/client.js");
  await until(async () => (await db().query<any>("SELECT count(*)::int AS n FROM memories WHERE embedding IS NULL")).rows[0].n === 0);
  const s1 = await req("POST", "/api/maintenance/scan");
  assert.equal(s1.data.ai, true);
  const m = (await req("GET", "/api/maintenance")).data;
  const conflict = m.suggestions.find((x: any) => x.kind === "conflicting_memories");
  assert.ok(conflict, JSON.stringify(m.suggestions.map((x: any) => x.kind)));
  assert.equal(conflict.ai, true);
  assert.match(conflict.reason, /London office/);
  const newer = conflict.items[0].id === b.data.id ? "a" : "b";
  assert.equal(conflict.proposal.keep, newer, "the statement of a change is proposed as current");
  // Nothing has changed yet: both memories are still active.
  const mems = (await req("GET", "/api/memories")).data;
  assert.ok(mems.some((x: any) => x.id === a.data.id) && mems.some((x: any) => x.id === b.data.id));

  const r = await req("POST", `/api/maintenance/${conflict.id}/apply`, { action: "resolve", keep: newer });
  assert.equal(r.status, 200, r.text);
  assert.equal((await req("POST", `/api/maintenance/${conflict.id}/apply`, { action: "resolve", keep: newer })).status, 409);
  const archived = (await req("GET", "/api/memories?status=archived")).data;
  assert.ok(archived.some((x: any) => x.id === a.data.id), "the other memory is archived, not deleted");

  assert.equal((await req("POST", `/api/maintenance/${conflict.id}/undo`)).status, 200);
  const back = (await req("GET", "/api/memories")).data;
  assert.ok(back.some((x: any) => x.id === a.data.id), "undo restores it");
  // Compatible pairs the AI checked are remembered, so they aren't sent again.
  const calls = mock.calls.length;
  await req("POST", "/api/maintenance/scan");
  assert.equal(mock.calls.slice(calls).filter((c) => JSON.stringify(c.body).includes("personal knowledge base")).length, 0, "already-reviewed pairs aren't re-sent to the AI");
});
