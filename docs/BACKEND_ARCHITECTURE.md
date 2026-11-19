# Backend architecture

Orbital is a single Node.js service (Express + TypeScript) that serves the React app and a JSON API from
the same origin, backed by PostgreSQL with pgvector. The same code runs three ways:

| Mode | Database | Who uses it |
|---|---|---|
| Hosted (Render or any Node host) | PostgreSQL 15+ with pgvector (Supabase, Neon, RDS…) via `DATABASE_URL` | The public site |
| Self-hosted / local dev | Embedded PGlite (Postgres compiled to WASM) in `ORBITAL_DATA_DIR` | `npm run dev`, small teams |
| Desktop app (Electron, Mac/Windows) | Embedded PGlite in the user's app-data folder | One person, offline-first |

## Map

```
browser / desktop shell
   │  same-origin fetch + cookie session + "x-orbital-request: 1" (CSRF)        API tokens (Bearer) ─┐
   ▼                                                                                                   ▼
server/index.ts  ── request id + context ── security headers / https ── body limits ── /api/v1 (token API)
   │                                                                                     
   ├─ loadUser (session cookie → user)  ── requireCsrfHeader ── languageFromRequest
   ├─ resolveWorkspace (x-orbital-workspace → membership + role; viewers read-only)
   │
   ├─ routes/core.ts          auth, password reset, sessions, conversations + chat (SSE), memories, graph
   ├─ routes/workspace.ts     folders, documents, uploads, clipper, research, projects/tasks/milestones,
   │                          opportunities, growth, export, account deletion
   ├─ routes/docs.ts          Papers: Yjs live sync, versions, comments, AI writing help
   ├─ routes/business.ts      team workspaces, members, invites, API tokens, connectors, automations, audit
   ├─ routes/productivity.ts  reminders, nudges, focus, voice transcription
   ├─ routes/researchIntel.ts lineage, source assessment, hypotheses, extraction, maintenance
   ├─ routes/meetings.ts      WebRTC signalling over SSE
   ├─ routes/waitlist.ts      public waitlist (consent, confirm, unsubscribe) + admin
   └─ routes/ops.ts           AI usage, server status, failed jobs, housekeeping
           │
           ▼
   engines/*  (retrieval, graph, research, extraction, maintenance, automations, reminders…)
   ai/provider.ts → anthropic.ts | openai.ts   (server-side only; budget check + usage metering)
   lib/jobs.ts      durable job queue in the `jobs` table (claim with FOR UPDATE SKIP LOCKED, backoff)
   lib/email.ts     Resend (logged to email_log; never claims a send that didn't happen)
   lib/log.ts       structured logs (JSON in production), secret scrubbing, error alerts
   lib/housekeeping retention of operational records
           │
           ▼
   db/client.ts  PGlite | pg Pool (SSL for hosted)   db/migrate.ts  ordered SQL migrations + lockDownPublicApi
```

## Request lifecycle

1. **Request id and context.** Every request gets an `x-request-id` (a caller's valid id is kept, so
   traces join up) and runs inside an `AsyncLocalStorage` context `{requestId, userId, workspaceId, feature}`.
   Logs, AI usage records and job runs read it, so one id ties a user action to its AI calls and errors.
2. **Headers.** `nosniff`, `x-frame-options: DENY`, `referrer-policy`, COOP, a permissions policy,
   `cache-control: no-store` and `content-security-policy: default-src 'none'` on every API response;
   a strict CSP on the app's pages. With `ORBITAL_FORCE_HTTPS`, http is redirected (GET) or refused (writes)
   and HSTS is sent.
3. **Session.** `loadUser` reads the `orbital_session` cookie (HttpOnly, SameSite=Lax, Secure in production),
   looks up the sha256 of the token in `sessions` and attaches the user.
4. **CSRF.** Every state-changing `/api` request needs `x-orbital-request: 1`. Browsers can't add that header
   cross-site without a CORS preflight, which the server never approves. Only the RFC 8058 one-click
   unsubscribe POST is exempt (it changes nothing but the subscriber's own flag, keyed by an unguessable token).
5. **Workspace.** `x-orbital-workspace` selects a workspace; membership is checked on every request and
   the role (`owner > admin > member > viewer`) is attached. Viewers can only read (plus live cursors in Papers).
6. **Handler.** Input is validated with zod; every query is parameterized and scoped by `workspace_id`
   (and by user where data is personal). Referenced ids (folder, project, milestone…) are checked to belong
   to the same workspace before they are stored.
7. **Errors.** `HttpError` becomes `{error, code}` with its status; invalid JSON and bad uploads are 400;
   anything else is logged with its request id and returned as a generic 500 with that id (no stack traces).

## Background work

- **Jobs** (`lib/jobs.ts`): research, extraction, embeddings, automations… are rows in `jobs`. A worker claims
  one at a time with `FOR UPDATE SKIP LOCKED`, so several instances never run the same job. Failures retry
  after 30 s and 2 min, then the job is marked `failed` (visible to server admins, retryable). A running
  job touches its row every 30 s; a sweep requeues `running` jobs whose heartbeat stopped over 2 minutes ago
  (a crashed or killed process), so instances never take over each other's live jobs. On shutdown the worker
  stops claiming and waits up to 25 s.
- **Schedulers**: automations, reminders, research freshness, knowledge maintenance, housekeeping. They run
  only where `ORBITAL_RUN_JOBS` is true (default), so a multi-instance deployment can keep one runner.
- **Live updates**: an in-process event bus pushes changes over SSE (`/api/events`) and Papers sync.
  This is per-instance; see PRODUCTION_READINESS.md for the multi-instance note.

## AI

All AI calls go through `ai/provider.ts` on the server; keys never reach the browser. Each call:
checks the workspace's monthly token allowance (`ORBITAL_AI_MONTHLY_TOKENS`) before calling, uses a
timeout and bounded retries (`ANTHROPIC_TIMEOUT_MS`, `ANTHROPIC_MAX_RETRIES`; the OpenAI-compatible provider
gets the same deadline), and records tokens and an estimated cost in `ai_usage` from the provider's own usage
report, tagged with workspace, user and feature. Rate limits per user cap chat, research, extraction etc.

## Email

`lib/email.ts` sends through Resend when `RESEND_API_KEY` and `ORBITAL_EMAIL_FROM` are set. Every attempt is
written to `email_log` (recipient hashed) as `sent`, `failed` or `skipped`. Callers get that status and
report it truthfully: password reset says email isn't available, the waitlist says whether the confirmation
went out, and admitting someone tells the admin whether they were notified.

## Data protection boundaries

- Tenant isolation is enforced in the application layer (every query filters by `workspace_id`) and covered
  by an IDOR test matrix. In Postgres, the `anon`/`authenticated` roles (Supabase's public REST API) have no
  privileges and row-level security is enabled with no policies on every table, so the database cannot be
  read around the app even if the Supabase anon key leaks.
- Secrets: connector credentials are encrypted at rest (AES-GCM, `ORBITAL_SECRET_KEY`); passwords are scrypt;
  session, API, reset and waitlist tokens are stored as sha256 hashes (waitlist tokens excepted, see SECURITY_AUDIT.md).
