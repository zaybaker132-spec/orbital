import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { getDb } from "./db/client.js";
import { lockDownPublicApi, migrate } from "./db/migrate.js";
import { loadUser, requireCsrfHeader } from "./auth/auth.js";
import { ah, HttpError } from "./lib/http.js";
import { newRequestId, runInContext } from "./lib/context.js";
import { log } from "./lib/log.js";
import { startJobs } from "./lib/jobs.js";
import { aiStatus } from "./ai/provider.js";
import { authRouter, api } from "./routes/core.js";
import { workspace } from "./routes/workspace.js";
import { business } from "./routes/business.js";
import { v1 } from "./routes/v1.js";
import { waitlistAdmin, waitlistPublic } from "./routes/waitlist.js";
import { meetings } from "./routes/meetings.js";
import { startAutomations } from "./engines/automation.js";
import { startReminders } from "./engines/reminders.js";
import { productivity } from "./routes/productivity.js";
import { researchIntel } from "./routes/researchIntel.js";
import { startFreshnessChecks } from "./engines/freshness.js";
import { startMaintenance } from "./engines/maintenance.js";
import "./engines/extraction.js";
import { isAppRoute } from "../shared/routes.js";
import { languageFromRequest } from "./lib/language.js";
import { docs } from "./routes/docs.js";
import { ops } from "./routes/ops.js";
import { startHousekeeping } from "./lib/housekeeping.js";
import { weather } from "./routes/weather.js";
import { trail } from "./routes/trail.js";
import { media } from "./routes/media.js";

export async function createApp(opts: { jobs?: boolean } = {}) {
  const database = await getDb();
  await migrate(database);
  await lockDownPublicApi(database);

  const app = express();
  app.disable("x-powered-by");
  // Behind a hosting proxy (Render, Fly, a load balancer), set ORBITAL_TRUST_PROXY=1 so client IPs (rate
  // limits) and https detection come from the proxy's headers. Numbers mean "this many hops".
  app.set("trust proxy", /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.use((req, res, next) => {
    // Every request gets an id (returned to the client) that all of its log lines carry.
    const requestId = /^[\w-]{8,64}$/.test(req.get("x-request-id") ?? "") ? req.get("x-request-id")! : newRequestId();
    res.setHeader("x-request-id", requestId);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (!req.path.startsWith("/api/") || req.path === "/api/health") return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Path only: query strings can hold search terms. Route ids are opaque uuids.
      const line = { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) };
      if (res.statusCode >= 500) log.error("request failed", line);
      else if (ms > 3000 && !req.path.endsWith("/events")) log.warn("slow request", line);
      else log.info("request", line);
    });
    runInContext({ requestId, feature: `api:${req.method} ${req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}` }, next);
  });
  app.use((req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    // Camera and microphone are for Meetings and voice; location only for "Use my location" (weather). Orbital's own pages only.
    res.setHeader("permissions-policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=(self), payment=(), usb=()");
    if (config.forceHttps) {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
      if (!req.secure && req.path !== "/api/health" && req.path !== "/api/health/ready") {
        if (req.method === "GET" || req.method === "HEAD") return res.redirect(308, `https://${req.get("host")}${req.originalUrl}`);
        return res.status(403).json({ error: "Use https.", code: "https_required" });
      }
    }
    // API responses hold private data: never cache them in shared caches or the browser's disk cache.
    if (req.path.startsWith("/api/") && !req.path.endsWith("/file")) res.setHeader("cache-control", "no-store");
    // API responses are data, never pages: nothing in them may run or be framed (routes that render a page set their own).
    if (req.path.startsWith("/api/")) res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  // Token-authenticated public API: no cookies, so no CSRF exposure; mounted before the session middleware.
  app.use("/api/v1", v1, (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(new HttpError(404, "Not found", "not_found")));
  app.use("/api", languageFromRequest, loadUser, requireCsrfHeader);
  // Liveness (the process answers) and readiness (the database answers): for load balancers and uptime checks.
  app.get("/api/health", (_req, res) => res.json({ ok: true, db: database.kind, ai: aiStatus() }));
  app.get("/api/health/ready", ah(async (_req, res) => {
    const t0 = Date.now();
    try {
      await database.query("SELECT 1");
      res.json({ ok: true, db: { kind: database.kind, ms: Date.now() - t0 } });
    } catch {
      res.status(503).json({ ok: false, db: { kind: database.kind, error: "unreachable" } });
    }
  }));
  app.use("/api/auth", authRouter);
  app.use("/api/public", waitlistPublic); // no account needed
  app.use("/api", api);
  app.use("/api", workspace);
  app.use("/api", business);
  app.use("/api", waitlistAdmin);
  app.use("/api", meetings);
  app.use("/api", productivity);
  app.use("/api", researchIntel);
  app.use("/api", docs);
  app.use("/api", ops);
  app.use("/api", weather);
  app.use("/api", trail);
  app.use("/api", media);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));

  const dist = config.staticDir;
  if (config.production && fs.existsSync(dist)) {
    app.use((_req, res, next) => {
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      next();
    });
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    // The app handles every page itself; unknown addresses still get it (it shows "not found"), with a real 404 status.
    app.get("*", (req, res) => res.status(isAppRoute(req.path) ? 200 : 404).sendFile(path.join(dist, "index.html")));
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That upload is too large.", code: "too_large" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "The request body isn't valid JSON.", code: "invalid_json" });
    if (err?.code === "LIMIT_UNEXPECTED_FILE" || err?.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: "Send one file in the \"file\" field.", code: "invalid_upload" });
    // Details go to the log (with the request id); the response never carries internals.
    log.error("unhandled error", { err });
    res.status(500).json({ error: "Something went wrong on the server.", code: "server_error", requestId: res.getHeader("x-request-id") });
  });

  // Background work (jobs, schedules, housekeeping). With several web instances, run it on one:
  // set ORBITAL_RUN_JOBS=false on the others.
  if (opts.jobs !== false && config.runJobs) {
    await startJobs();
    startHousekeeping();
    startAutomations();
    startReminders();
    startFreshnessChecks();
    startMaintenance();
  }
  return app;
}
