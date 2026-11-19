// Quick latency baseline (not part of `npm test`): npx tsx server/test/bench.ts
// Seeds one workspace, then times common reads sequentially and under 20 concurrent requests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-bench-"));
Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", LOG_LEVEL: "warn", RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
const { createApp } = await import("../index.js");
const app = await createApp();
const server = await new Promise<any>((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
const req = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
};
await req("POST", "/api/auth/signup", { email: "bench@orbital.test", password: "long enough password" });
const words = "launch pricing customer interview roadmap hiring research memo onboarding retention analytics design partner".split(" ");
const t0 = Date.now();
for (let i = 0; i < 300; i++) await req("POST", "/api/documents", { title: `Note ${i} about ${words[i % words.length]}`, body: Array.from({ length: 120 }, (_, j) => words[(i * 7 + j) % words.length]).join(" ") });
for (let i = 0; i < 30; i++) await req("POST", "/api/projects", { name: `Project ${i}` });
const seedMs = Date.now() - t0;
const docId = (await req("GET", "/api/documents")).data.rows?.[0]?.id ?? (await req("GET", "/api/documents")).data[0]?.id;
const pct = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const rows: string[] = [];
for (const [name, url] of [["health/ready", "/api/health/ready"], ["auth/me", "/api/auth/me"], ["documents list", "/api/documents"], ["document", `/api/documents/${docId}`], ["search", "/api/documents?q=pricing"], ["projects", "/api/projects"], ["graph", "/api/graph"], ["memories", "/api/memories"]] as const) {
  const seq: number[] = [];
  for (let i = 0; i < 40; i++) { const s = performance.now(); const r = await req("GET", url); if (r.status !== 200) throw new Error(`${url} ${r.status}`); seq.push(performance.now() - s); }
  const conc: number[] = [];
  await Promise.all(Array.from({ length: 20 }, async () => { for (let i = 0; i < 5; i++) { const s = performance.now(); await req("GET", url); conc.push(performance.now() - s); } }));
  rows.push(`| ${name} | ${pct(seq, 0.5).toFixed(1)} | ${pct(seq, 0.95).toFixed(1)} | ${pct(conc, 0.5).toFixed(1)} | ${pct(conc, 0.95).toFixed(1)} |`);
}
console.log(`seeded 300 documents + 30 projects in ${seedMs} ms (${(seedMs / 330).toFixed(1)} ms per write incl. indexing)\n`);
console.log("| endpoint | p50 ms | p95 ms | p50 ms (20 concurrent) | p95 ms (20 concurrent) |\n|---|---|---|---|---|\n" + rows.join("\n"));
console.log(`\nrss ${Math.round(process.memoryUsage().rss / 1048576)} MB, db ${process.env.TEST_DATABASE_URL ? "postgres" : "pglite"}`);
server.close(); const { db } = await import("../db/client.js"); await db().close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
