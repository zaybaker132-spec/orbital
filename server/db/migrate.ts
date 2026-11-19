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

/**
 * Hosted Postgres like Supabase also publishes the `public` schema through a web API for its "anon"
 * and "authenticated" roles. Orbital reaches its database only through its own server, so nothing
 * should be reachable that way: remove those roles' access and turn on row-level security (with no
 * policies, which denies them everything). Orbital's own connection owns the tables and is unaffected.
 * Runs after every migration, so new tables are covered too. A no-op where those roles don't exist.
 */
export async function lockDownPublicApi(database: Database, log = console.log) {
  if (database.kind !== "postgres") return;
  const roles = (await database.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).rows.map((r) => r.rolname);
  if (!roles.length) return;
  const tables = (await database.query<{ tablename: string; rowsecurity: boolean }>("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'")).rows;
  const who = roles.map((r) => `"${r}"`).join(", ");
  let locked = 0;
  for (const t of tables) {
    const name = `public."${t.tablename.replace(/"/g, '""')}"`;
    await database.exec(`REVOKE ALL ON ${name} FROM ${who}`);
    if (!t.rowsecurity) { await database.exec(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`); locked++; }
  }
  await database.exec(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${who}`);
  await database.exec(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${who}`);
  await database.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${who}`);
  if (locked) log(`[db] closed ${locked} table(s) to the hosting provider's public data API (${roles.join(", ")})`);
}

/** Split on semicolons at end of line; migrations avoid dollar-quoted bodies containing ';\n'. */
function splitSql(sql: string) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
}
