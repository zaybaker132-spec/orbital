import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Secrets at rest (connector URLs and tokens) are encrypted with AES-256-GCM.
 * Key: ORBITAL_SECRET_KEY (32+ chars, any format), else a random key generated once into
 * the data directory with owner-only permissions. Back that file up with the database.
 */
let key: Buffer | null = null;
function getKey() {
  if (key) return key;
  const env = process.env.ORBITAL_SECRET_KEY;
  if (env) {
    if (env.length < 32) throw new Error("ORBITAL_SECRET_KEY must be at least 32 characters");
    key = crypto.createHash("sha256").update(env).digest();
    return key;
  }
  const file = path.join(config.dataDir, "secret.key");
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  return key;
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decrypt(blob: string) {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
