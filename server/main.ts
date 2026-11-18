import { config } from "./config.js";
import { createApp } from "./index.js";
import { aiStatus } from "./ai/provider.js";

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

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
