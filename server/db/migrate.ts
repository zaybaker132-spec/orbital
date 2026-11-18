import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(database: Database, log = console.log) {
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await database.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const dir = path.join(here, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await database.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
    });
    log(`[db] applied migration ${file}`);
  }
}

/** Split on semicolons at end of line; migrations avoid dollar-quoted bodies containing ';\n'. */
function splitSql(sql: string) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
}
