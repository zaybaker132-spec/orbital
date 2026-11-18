import type { RequestHandler } from "express";
import { HttpError } from "./http.js";

/** Simple in-memory sliding-window limiter. Suitable for a single-node deployment; swap for Redis when scaling out. */
export function rateLimit(opts: { windowMs: number; max: number; key: "ip" | "user" | "token"; name: string }): RequestHandler {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, v] of hits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, opts.windowMs).unref();
  return (req, _res, next) => {
    const id = opts.key === "user" ? req.user?.id ?? req.ip : opts.key === "token" ? req.apiToken?.id ?? req.ip : req.ip;
    const k = `${opts.name}:${id}`;
    const now = Date.now();
    const arr = (hits.get(k) ?? []).filter((t) => t > now - opts.windowMs);
    if (arr.length >= opts.max) return next(new HttpError(429, "Too many requests. Please slow down.", "rate_limited"));
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}
