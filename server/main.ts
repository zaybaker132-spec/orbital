import { config } from "./config.js";
import { createApp } from "./index.js";
import { aiStatus } from "./ai/provider.js";
import { stopJobs } from "./lib/jobs.js";
import { db } from "./db/client.js";
import { log } from "./lib/log.js";

const app = await createApp();
const host = config.desktop ? "127.0.0.1" : "0.0.0.0"; // the desktop server is reachable only from this machine
const server = app.listen(config.port, host, () => {
  const ai = aiStatus();
  console.log(`\n  ORBITAL api  http://localhost:${config.port}${config.desktop ? "  (desktop)" : ""}`);
  console.log(`  database     ${config.databaseUrl ? "PostgreSQL (DATABASE_URL)" : `embedded PGlite at ${config.dataDir}`}`);
  console.log(`  ai           ${ai.provider === "none" ? "not configured — set ANTHROPIC_API_KEY" : `${ai.provider} · ${ai.model}`}`);
  console.log(`  embeddings   ${ai.embeddings}\n`);
  process.send?.({ type: "ready", port: config.port });
});

/**
 * Graceful shutdown (deploys, restarts): stop accepting connections, let running background jobs finish
 * (up to 25 s; unfinished ones run again on the next start), close the database, exit.
 */
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info("shutting down", { signal });
  const force = setTimeout(() => { log.warn("shutdown timed out; exiting"); process.exit(1); }, 30_000);
  force.unref();
  server.close();
  server.closeIdleConnections?.();
  const left = await stopJobs(25_000);
  if (left) log.warn("jobs still running at shutdown will run again on next start", { count: left });
  try { await db().close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => log.error("unhandled promise rejection", { err }));
