import type { NextFunction, Request, RequestHandler, Response } from "express";
import type * as z from "zod/v4";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "not_found");

/** Wrap async handlers so rejected promises reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, msg, "invalid_input");
  }
  return r.data;
}

/** The active workspace (tenant) for this request. All data queries scope to it. */
export const ws = (req: Request): string => {
  if (!req.workspace) throw new HttpError(401, "No workspace", "unauthenticated");
  return req.workspace.id;
};
/** The signed-in person (attribution, private conversations, preferences). */
export const actor = (req: Request): string => {
  if (!req.user) throw new HttpError(401, "Not authenticated", "unauthenticated");
  return req.user.id;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const idParam = (req: Request, name = "id"): string => {
  const v = req.params[name];
  if (!v || !UUID_RE.test(v)) throw new HttpError(400, `Invalid ${name}`, "invalid_input");
  return v;
};
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
