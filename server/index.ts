import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { getDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { loadUser, requireCsrfHeader } from "./auth/auth.js";
import { HttpError } from "./lib/http.js";
import { startJobs } from "./lib/jobs.js";
import { aiStatus } from "./ai/provider.js";
import { authRouter, api } from "./routes/core.js";
import { workspace } from "./routes/workspace.js";
import { business } from "./routes/business.js";
import { v1 } from "./routes/v1.js";
import { startAutomations } from "./engines/automation.js";

export async function createApp(opts: { jobs?: boolean } = {}) {
  const database = await getDb();
  await migrate(database);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  // Token-authenticated public API: no cookies, so no CSRF exposure; mounted before the session middleware.
  app.use("/api/v1", v1, (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(new HttpError(404, "Not found", "not_found")));
  app.use("/api", loadUser, requireCsrfHeader);
  app.get("/api/health", (_req, res) => res.json({ ok: true, db: database.kind, ai: aiStatus() }));
  app.use("/api/auth", authRouter);
  app.use("/api", api);
  app.use("/api", workspace);
  app.use("/api", business);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));

  const dist = config.staticDir;
  if (config.production && fs.existsSync(dist)) {
    app.use((_req, res, next) => {
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      next();
    });
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That upload is too large.", code: "too_large" });
    console.error("[api] unhandled", err);
    res.status(500).json({ error: "Something went wrong on the server.", code: "server_error" });
  });

  if (opts.jobs !== false) {
    await startJobs();
    startAutomations();
  }
  return app;
}
