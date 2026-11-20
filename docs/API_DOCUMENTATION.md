# API documentation

All endpoints are JSON over HTTPS on the same origin as the app. This file lists every route; request and
response shapes for the important ones are noted, and the zod schemas in `server/routes/*.ts` are the
source of truth for the rest.

## Conventions

- **Auth:** session cookie `orbital_session` (set by signup/login/reset). Routes under `/api` need a signed-in
  user unless listed as public (`/api/health*`, `/api/auth/signup|login|password/forgot|password/reset|me`, `/api/public/*`).
- **CSRF:** every non-GET request must send `x-orbital-request: 1`.
- **Workspace:** send `x-orbital-workspace: <id>`; default is the personal workspace. Membership and role are
  checked on every request. `[admin]`/`[owner]` below = minimum role. Viewers can only read.
- **Server admins:** `/api/admin/*` needs an account listed in `ORBITAL_ADMIN_EMAILS` (401 signed out, 403 otherwise).
- **Errors:** `{error: string, code?: string}` with the HTTP status. Codes include `invalid_input` (400),
  `unauthenticated` (401), `csrf` and `forbidden` (403), `not_found` and `workspace_not_found` (404), `rate_limited` / `account_throttled` (429),
  `email_unavailable` (503), `server_error` (500, with `requestId` only).
- **Request ids:** every response has `x-request-id`; send your own (8–64 of `[A-Za-z0-9_-]`) to correlate.
- **Language:** `accept-language` or the user's setting chooses the language of messages and AI output.
- **Deletes** are idempotent: deleting something that isn't yours (or doesn't exist) changes nothing and returns 200.
- **Rate limits** (per user unless noted): sign-in 20/15 min/IP, password reset 6/h/IP, waitlist 8/h/IP, chat 20/min,
  research 30/h, upload 20/min, clip 30/min, Papers AI 30/min, transcription 40/min, token API 120/min/token.

## Health

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | Liveness. Always plain http-allowed for platform probes. |
| GET | /api/health/ready | Readiness: pings the database. 503 if unreachable. Use as the load-balancer health check. |

## Auth, account, chat, memory, graph

Prefix: `/api/auth/*` for the first block (signup…sessions/revoke-others, me), `/api/*` for the rest.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /signup |  | `{email, password}` (10–200 chars). 201 + session cookie. 403 when sign-up is invite-only and the email wasn't let in. |
| POST | /login |  | `{email, password}`. 401 `bad_credentials`; 429 `account_throttled` after 8 failures in 15 min; 429 per-IP limit. |
| POST | /logout |  |  |
| PATCH | /me |  |  |
| POST | /password |  | `{current, next}`. Signs out other sessions, voids reset links. |
| POST | /password/forgot |  | `{email}`. 200 with the same message whether or not the account exists; 503 `email_unavailable` if email or ORBITAL_PUBLIC_URL isn't configured; 502 `email_failed` if the send failed. 6/hour/IP. |
| POST | /password/reset |  | `{token, password}`. One use, 1 h. Signs out every device, then signs in. 400 `invalid_token`. |
| GET | /sessions |  |  |
| POST | /sessions/revoke-others |  |  |
| GET | /me |  | The user, workspaces, language, `serverAdmin`; `passwordReset` availability when signed out. |
| GET | /events |  | Server-Sent Events for live updates in the current workspace. |
| GET | /conversations |  |  |
| POST | /conversations |  |  |
| GET | /conversations/:id |  |  |
| PATCH | /conversations/:id |  |  |
| DELETE | /conversations/:id |  |  |
| POST | /conversations/:id/messages |  | Streams the answer as Server-Sent Events. 20/min/user. Refused with the allowance message when the workspace's monthly AI tokens are used. |
| GET | /memories |  |  |
| POST | /memories |  |  |
| PATCH | /memories/:id |  |  |
| DELETE | /memories/:id |  |  |
| POST | /memories/merge |  |  |
| GET | /graph |  |  |
| GET | /nodes/:id |  |  |
| POST | /nodes |  |  |
| PATCH | /nodes/:id |  |  |
| DELETE | /nodes/:id |  |  |
| POST | /nodes/:id/suggest |  |  |
| POST | /edges |  |  |
| PATCH | /edges/:id |  |  |
| DELETE | /edges/:id |  |  |
| POST | /feedback |  |  |

## Documents, research, projects, opportunities, account

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /folders |  |  |
| POST | /folders |  |  |
| PATCH | /folders/:id |  |  |
| DELETE | /folders/:id |  |  |
| GET | /collections |  |  |
| POST | /collections |  |  |
| DELETE | /collections/:id |  |  |
| PUT | /collections/:id/documents/:docId |  |  |
| DELETE | /collections/:id/documents/:docId |  |  |
| GET | /documents |  |  |
| GET | /tags |  |  |
| POST | /documents |  |  |
| GET | /documents/:id |  |  |
| PATCH | /documents/:id |  |  |
| DELETE | /documents/:id |  |  |
| GET | /documents/:id/related |  |  |
| POST | /documents/upload |  | multipart `file` (≤ MAX_UPLOAD_MB), optional `projectId`, `folderId`. Text is extracted from PDF, Word, Excel, images (OCR). |
| GET | /documents/:id/file |  | The original upload, served with its detected type, `nosniff`, `default-src 'none'`. |
| POST | /clip |  |  |
| POST | /documents/from-message |  |  |
| GET | /research |  |  |
| POST | /research |  |  |
| GET | /research/:id |  |  |
| POST | /research/:id/retry |  |  |
| DELETE | /research/:id |  |  |
| POST | /research/:id/save-note |  |  |
| GET | /projects |  |  |
| POST | /projects |  |  |
| GET | /projects/:id |  |  |
| PATCH | /projects/:id |  |  |
| DELETE | /projects/:id |  |  |
| POST | /projects/:id/links |  |  |
| DELETE | /projects/:id/links/:type/:itemId |  |  |
| GET | /projects/:id/brief |  |  |
| POST | /projects/:id/tasks |  |  |
| PATCH | /tasks/:id |  |  |
| DELETE | /tasks/:id |  |  |
| POST | /projects/:id/milestones |  |  |
| PATCH | /milestones/:id |  |  |
| DELETE | /milestones/:id |  |  |
| GET | /opportunities |  |  |
| POST | /opportunities/discover |  |  |
| POST | /opportunities |  |  |
| PATCH | /opportunities/:id |  |  |
| POST | /opportunities/:id/validate |  |  |
| POST | /opportunities/:id/refresh-evidence |  |  |
| POST | /opportunities/:id/plan |  |  |
| DELETE | /opportunities/:id |  |  |
| GET | /dashboard/tasks |  | Open tasks across the workspace's active and paused projects, soonest due first (max 12), with `overdue` and `project_name`. `?today=YYYY-MM-DD`. |
| GET | /growth |  |  |
| GET | /growth/maintenance |  |  |
| PATCH | /gaps/:id |  |  |
| POST | /gaps/:id/research |  |  |
| GET | /search/all |  |  |
| GET | /search |  |  |
| PUT | /preferences |  | Partial update of your preferences. `environment` (dashboards, layout, theme) is replaced whole and strictly validated: see docs/ENVIRONMENT.md. |  |
| GET | /export |  | Everything in the workspace as a JSON download. |
| POST | /account/delete |  | `{confirm: "DELETE", password}`. Deletes the user, their personal workspace and sessions. 401 on a wrong password. |

## Papers (live documents)

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /docs |  |  |
| POST | /docs |  |  |
| GET | /docs/:id |  |  |
| POST | /docs/:id/seed |  |  |
| POST | /docs/:id/sync |  | Yjs update exchange (base64). Viewers may read only. |
| POST | /docs/:id/awareness |  |  |
| PUT | /docs/:id/snapshot |  |  |
| PATCH | /docs/:id |  |  |
| POST | /docs/:id/star |  |  |
| POST | /docs/:id/copy |  |  |
| DELETE | /docs/:id |  |  |
| GET | /docs/:id/versions |  |  |
| GET | /docs/:id/versions/:vid |  |  |
| POST | /docs/:id/versions |  |  |
| PATCH | /docs/:id/versions/:vid |  |  |
| GET | /docs/:id/comments |  |  |
| POST | /docs/:id/comments |  |  |
| PATCH | /docs/:id/threads/:tid |  |  |
| DELETE | /docs/:id/comments/:cid |  |  |
| POST | /docs/:id/assist |  |  |

## Team workspaces, members, invites, tokens, connectors, automations

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /workspaces |  |  |
| POST | /workspaces |  |  |
| GET | /workspace |  |  |
| PATCH | /workspace | admin |  |
| DELETE | /workspace | owner | `{confirm: <workspace name>}`. Owners; team workspaces only. |
| GET | /workspace/members |  |  |
| PATCH | /workspace/members/:userId | admin |  |
| DELETE | /workspace/members/:userId |  |  |
| GET | /workspace/invites | admin |  |
| POST | /workspace/invites | admin |  |
| DELETE | /workspace/invites/:id | admin |  |
| POST | /invites/accept |  |  |
| GET | /workspace/tokens | admin |  |
| POST | /workspace/tokens | admin |  |
| DELETE | /workspace/tokens/:id | admin |  |
| GET | /connectors |  |  |
| POST | /connectors | admin |  |
| PATCH | /connectors/:id | admin |  |
| DELETE | /connectors/:id | admin |  |
| POST | /connectors/:id/test | admin |  |
| GET | /automations |  |  |
| POST | /automations | admin |  |
| PATCH | /automations/:id | admin |  |
| DELETE | /automations/:id | admin |  |
| POST | /automations/:id/run | admin |  |
| GET | /actions |  |  |
| POST | /actions/:id/approve | admin |  |
| POST | /actions/:id/reject | admin |  |
| GET | /audit | admin |  |

## Reminders, nudges, focus, voice

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /reminders |  |  |
| POST | /reminders |  |  |
| PATCH | /reminders/:id |  |  |
| DELETE | /reminders/:id |  |  |
| GET | /nudges |  |  |
| POST | /nudges/dismiss |  |  |
| GET | /focus |  |  |
| POST | /focus |  |  |
| PATCH | /focus/:id |  |  |
| POST | /focus/:id/end |  |  |
| GET | /voice/config |  |  |
| POST | /voice/transcribe |  |  |
| POST | /conversations/:id/remember |  |  |
| GET | /activity/calendar |  |  |

## Research intelligence, hypotheses, extraction, maintenance

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /research/:id/lineage |  |  |
| POST | /research/:id/assess |  |  |
| POST | /research/:id/freshness |  |  |
| POST | /research/:id/refresh |  |  |
| POST | /edges/:id/investigate |  |  |
| GET | /hypotheses |  |  |
| POST | /hypotheses |  |  |
| GET | /hypotheses/:id |  |  |
| PATCH | /hypotheses/:id |  |  |
| DELETE | /hypotheses/:id |  |  |
| POST | /hypotheses/:id/test |  |  |
| POST | /hypotheses/:id/next-test |  |  |
| POST | /documents/:id/extract |  |  |
| GET | /documents/:id/extraction |  |  |
| GET | /maintenance |  |  |
| POST | /maintenance/scan |  |  |
| POST | /maintenance/:id/apply |  |  |
| POST | /maintenance/:id/undo |  |  |
| POST | /maintenance/:id/dismiss |  |  |

## Meetings (WebRTC signalling)

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /meetings/config |  |  |
| POST | /meetings |  |  |
| GET | /meetings |  |  |
| GET | /meetings/:code |  |  |
| GET | /meetings/:code/stream |  |  |
| POST | /meetings/:code/signal |  |  |
| POST | /meetings/:code/state |  |  |
| POST | /meetings/:code/chat |  |  |
| POST | /meetings/:code/lock |  |  |
| POST | /meetings/:code/remove |  |  |
| POST | /meetings/:code/end |  |  |

## Waitlist

Prefix: `/api/public/waitlist*` (no account) and `/api/admin/waitlist*` (server admins)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /waitlist | public | `{email, persona, remember[], scale, aiTools[], notesApps[], computers[], devices[], heardFrom, consent: true, …}`. 201 `{position, confirmation: sent|already_confirmed|not_configured|failed}`. 8/hour/IP. A filled `website` field (honeypot) is silently dropped. |
| GET | /waitlist/confirm | public | `?token=` from the email. HTML page. |
| GET | /waitlist/unsubscribe | public |  |
| POST | /waitlist/unsubscribe | public | RFC 8058 one-click (no cookie or CSRF header needed). GET shows a page. |
| GET | /admin/waitlist | server admin |  |
| POST | /admin/waitlist/:id/admit | server admin | Lets the person sign up; emails them. `{notification: sent|failed|not_configured|unsubscribed}`. |
| GET | /admin/waitlist.csv | server admin | CSV export; formula-looking cells are neutralised. |

## Operations

Prefix: `/api`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /workspace/ai-usage | admin | This month: requests, failed, tokens `{input, output, cacheRead, cacheWrite}`, `costUsd` (estimate at list price), `cap`, `byFeature[]`. |
| GET | /admin/ai-usage | server admin | Same, across the server, plus `byWorkspace[]`. Server admins. |
| GET | /admin/status | server admin | Database ping, job counts, email/AI configuration, security settings, process memory. No secrets. |
| GET | /admin/jobs/failed | server admin | Last 100 failed jobs (type, attempts, error), without payloads. |
| POST | /admin/jobs/:id/retry | server admin | Requeues a failed job. 404 if it isn't failed. |
| POST | /admin/housekeeping | server admin | Runs retention now. `{removed: {table: count}}`. |

## Weather

| Method | Path | Notes |
|---|---|---|
| GET | /api/weather/places | `?q=` (2–100 chars) `&lang=en|es|fr|pt|de` → `[{name, region, country, lat, lon}]` (max 6). Cached 24 h. 30/min. |
| GET | /api/weather | `?lat&lon&unit=c|f` → `{temperature, code (WMO), isDay, unit, high, low, timezone}`. Coordinates rounded to 0.01°; cached 10 min. 502 `weather_unavailable` when Open-Meteo is down. |

## Token API (`/api/v1`)

For scripts and integrations. Authenticate with `Authorization: Bearer <token>` (create tokens in Settings →
Workspace → API tokens; only a hash is stored). No cookies, so no CSRF header. 120 requests/min per token.

| Method | Path | Scope | Notes |
|---|---|---|---|
| POST | /api/v1/documents | ingest | `{title, body, tags?}` adds a document to the token's workspace |
| POST | /api/v1/memories | ingest | `{content, category?}` |
| GET | /api/v1/search | query | `?q=` hybrid search over documents and memories |
| POST | /api/v1/ask | query | `{question}` grounded answer with citations (uses the workspace's AI allowance) |
