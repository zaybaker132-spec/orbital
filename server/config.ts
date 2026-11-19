import fs from "node:fs";
import path from "node:path";

// Load .env if present (Node >= 21). Never committed; see .env.example.
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));

function resolveProvider(): "anthropic" | "openai" | "none" {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if (explicit === "anthropic" || explicit === "openai" || explicit === "none") return explicit;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return "openai";
  return "none";
}

const pkgVersion = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).version as string; } catch { return ""; } })();

export const config = {
  version: process.env.ORBITAL_VERSION || pkgVersion || "0.2.0",
  port: Number(process.env.PORT || 8787),
  production: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL || "",
  dataDir: path.resolve(process.env.ORBITAL_DATA_DIR || ".orbital-data"),
  allowSignup: bool(process.env.ORBITAL_ALLOW_SIGNUP, true),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  /** Set by the desktop shell: single-machine install, loopback only. */
  desktop: bool(process.env.ORBITAL_DESKTOP, false),
  /** Where the built web app lives (the desktop app ships it inside its bundle). */
  staticDir: path.resolve(process.env.ORBITAL_STATIC_DIR || "dist"),
  /** Public base URL, used for invite links. Defaults to the request origin. */
  publicUrl: (process.env.ORBITAL_PUBLIC_URL || "").replace(/\/$/, ""),
  /** Where people download the desktop app (shown in Settings). */
  downloadUrl: process.env.ORBITAL_DOWNLOAD_URL || "",
  automationTickMs: Number(process.env.AUTOMATION_TICK_MS || 60_000),
  /** Accounts that can read the waitlist (comma-separated emails). */
  meetings: {
    /** Peer-to-peer mesh: every participant sends to every other, so rooms stay small. */
    maxParticipants: Number(process.env.MEETING_MAX_PARTICIPANTS || 8),
    stunUrls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302").split(",").map((s) => s.trim()).filter(Boolean),
    /** A TURN relay lets people on strict networks connect. Optional; see docs/MEETINGS.md. */
    turnUrls: (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    turnUsername: process.env.TURN_USERNAME || "",
    turnCredential: process.env.TURN_CREDENTIAL || "",
  },
  adminEmails: (process.env.ORBITAL_ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  ai: {
    provider: resolveProvider(),
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    // Server-side refusal fallback (Anthropic beta). Set ANTHROPIC_FALLBACKS=off to disable.
    anthropicFallbacks: bool(process.env.ANTHROPIC_FALLBACKS, true),
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  },
  /**
   * Server-side speech-to-text for voice conversations, used when the browser has no built-in
   * speech recognition (e.g. the desktop app, Firefox). Any OpenAI-compatible
   * /audio/transcriptions endpoint: OpenAI Whisper, Groq, or a local whisper.cpp / faster-whisper server.
   */
  transcription: {
    baseUrl: (process.env.TRANSCRIPTION_BASE_URL || (process.env.OPENAI_API_KEY ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1" : "")).replace(/\/$/, ""),
    model: process.env.TRANSCRIPTION_MODEL || "whisper-1",
  },
  embeddings: {
    // "local" = deterministic hashed-feature vectors computed on this server (no network, lexical-semantic).
    // "openai" = any OpenAI-compatible /embeddings endpoint that supports `dimensions`.
    provider: (process.env.EMBEDDINGS_PROVIDER || "local").toLowerCase() as "local" | "openai",
    model: process.env.EMBEDDINGS_MODEL || "text-embedding-3-small",
    baseUrl: (process.env.EMBEDDINGS_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  },
  /**
   * Hosting. `trustProxy`: how many proxies sit in front of Orbital (Render, Fly, a load balancer = 1),
   * so client IPs (rate limits) and https detection are right. `forceHttps`: redirect http to https and
   * send HSTS; on by default in production when the public URL is https.
   */
  trustProxy: process.env.ORBITAL_TRUST_PROXY ?? "loopback",
  /** Run background jobs and schedules in this process (turn off on extra web instances). */
  runJobs: bool(process.env.ORBITAL_RUN_JOBS, true),
  forceHttps: bool(process.env.ORBITAL_FORCE_HTTPS, process.env.NODE_ENV === "production" && /^https:/.test(process.env.ORBITAL_PUBLIC_URL || "")),
  /** Structured JSON logs (one line per event) in production; readable lines in development. */
  logFormat: (process.env.LOG_FORMAT || (process.env.NODE_ENV === "production" ? "json" : "pretty")) as "json" | "pretty",
  /** Optional Slack-compatible webhook for operational alerts (server errors, failing background jobs). */
  alertWebhook: process.env.ORBITAL_ALERT_WEBHOOK || "",
  /** Transactional email (password reset, waitlist). Resend; without a key, nothing is sent and the app says so. */
  email: {
    resendApiKey: process.env.RESEND_API_KEY || "",
    apiUrl: (process.env.RESEND_API_URL || "https://api.resend.com").replace(/\/$/, ""),
    from: process.env.ORBITAL_EMAIL_FROM || "",
  },
  /** AI spend control. Monthly token cap per workspace (input + output; 0 = no cap) and request limits. */
  aiLimits: {
    monthlyTokensPerWorkspace: Number(process.env.ORBITAL_AI_MONTHLY_TOKENS || 0),
    timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS || 10 * 60_000),
    maxRetries: Number(process.env.ANTHROPIC_MAX_RETRIES || 2),
  },
  research: {
    webSearch: bool(process.env.RESEARCH_WEB_SEARCH, true),
    wikipedia: bool(process.env.RESEARCH_WIKIPEDIA, true),
    openalex: bool(process.env.RESEARCH_OPENALEX, true),
    maxSourcesPerQuestion: Number(process.env.RESEARCH_MAX_SOURCES || 4),
  },
} as const;

export const EMBEDDING_DIM = 256;
