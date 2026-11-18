import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface QueryResult<T> { rows: T[] }
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Database extends Queryable {
  kind: "pglite" | "postgres";
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let instance: Database | null = null;

/** Normalise parameters: arrays of numbers destined for vector columns are passed as pgvector literals by callers. */
function normalize(params: unknown[] = []) {
  return params.map((p) => (p === undefined ? null : p));
}

async function createPglite(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dir = path.join(config.dataDir, "pg");
  // DATE (oid 1082) stays a plain YYYY-MM-DD string: calendar dates have no time zone.
  const db = await PGlite.create({ dataDir: dir, extensions: { vector }, parsers: { 1082: (v: string) => v } });
  // PGlite is single-connection: serialise transactions so concurrent requests can't interleave inside one.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    kind: "pglite",
    query: (sql, params) => serial(() => db.query(sql, normalize(params)) as any),
    exec: (sql) => serial(async () => { await db.exec(sql); }),
    tx: (fn) => serial(() => db.transaction((t) => fn({ query: (s, p) => t.query(s, normalize(p)) as any }))),
    close: () => db.close(),
  };
}

async function createPostgres(): Promise<Database> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, normalize(params)) as any,
    exec: async (sql) => { await pool.query(sql); },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (s, p) => client.query(s, normalize(p)) as any });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function getDb(): Promise<Database> {
  if (!instance) instance = config.databaseUrl ? await createPostgres() : await createPglite();
  return instance;
}

/** Convenience accessor once initialised at boot. */
export function db(): Database {
  if (!instance) throw new Error("Database not initialised");
  return instance;
}

export const toVector = (v: number[] | null | undefined) => (v ? `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]` : null);
