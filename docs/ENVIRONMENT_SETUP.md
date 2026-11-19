# Environment setup

Every setting is an environment variable; `.env.example` lists them all with comments. Secrets go in the
host's secret settings (Render → Environment), never in the repository, the frontend, or logs.

## Local development

```bash
npm ci
cp .env.example .env     # optional: add ANTHROPIC_API_KEY for AI features
npm run dev              # API on :8787, web on :5173, embedded database in .orbital-data/
```

Tests: `npm test` (embedded database, no network, AI and email are local stand-ins).
Against real Postgres: `TEST_DATABASE_URL=postgres://… npx tsx --test server/test/production.test.ts`
(use an empty database per test file; never point tests at production).

## Production (hosted)

### Required

| Variable | Example | Why |
|---|---|---|
| `NODE_ENV` | `production` | Secure cookies, JSON logs, static app serving |
| `DATABASE_URL` | Supabase *Session pooler* string | Postgres 15+ with pgvector. SSL is on automatically for hosted databases |
| `ORBITAL_SECRET_KEY` | 32+ random characters | Encrypts connector secrets. Generate once, back up, never change |
| `ORBITAL_PUBLIC_URL` | `https://orbital.example.com` | Base of every emailed link; turns on https enforcement + HSTS |
| `ORBITAL_TRUST_PROXY` | `1` | Render/Fly/Heroku put one proxy in front: needed for real client IPs (rate limits) and https detection |
| `ORBITAL_ADMIN_EMAILS` | `you@example.com` | Server admins: waitlist, server status, failed jobs, AI usage across workspaces |

### Strongly recommended

| Variable | Example | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | from console.anthropic.com | AI chat, research, writing help. Without it, AI features say they're unavailable |
| `ORBITAL_AI_MONTHLY_TOKENS` | `2000000` | Monthly token allowance per workspace; caps your AI bill. `0` = unlimited |
| `RESEND_API_KEY` | from resend.com | Password reset, waitlist confirmation, "you're in" emails. Without it, nothing is emailed and the app says so |
| `ORBITAL_EMAIL_FROM` | `Orbital <hello@example.com>` | Sender on a domain verified in Resend |
| `ORBITAL_ALLOW_SIGNUP` | `false` | Invite-only launch (waitlist → admit); `true` opens sign-up |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `ORBITAL_ALERT_WEBHOOK` | — | Slack-compatible webhook for server errors (one alert per message per 10 min) |
| `LOG_FORMAT` / `LOG_LEVEL` | json / info | Log output |
| `ORBITAL_RUN_JOBS` | true | Background work in this process; with several instances it's safe everywhere, but you may keep it on one |
| `ORBITAL_FORCE_HTTPS` | on with https public URL | Override https enforcement |
| `SESSION_TTL_DAYS` | 30 | Session lifetime |
| `MAX_UPLOAD_MB` | 25 | Upload size limit |
| `ANTHROPIC_MODEL` | claude-opus-5-5 | Model for AI features |
| `ANTHROPIC_TIMEOUT_MS` / `ANTHROPIC_MAX_RETRIES` | 600000 / 2 | Per-request deadline and retries |
| `AI_PRICE_<MODEL>` | built-in list prices | `"in,out,cacheRead"` $/MTok override for cost estimates |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | — | Any OpenAI-compatible endpoint instead of Anthropic |
| `EMBEDDINGS_PROVIDER` | local | `openai` for model embeddings |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | — | Meetings on strict networks |
| `ORBITAL_ALLOW_PRIVATE_WEBHOOKS` | false | Let webhooks/clipper reach private addresses (on-prem only) |

### Render (blueprint)

`render.yaml` sets `NODE_ENV`, `ORBITAL_TRUST_PROXY=1`, the readiness health check, a generated
`ORBITAL_SECRET_KEY`, invite-only sign-up and a 2M-token monthly AI allowance, and asks for the secrets
(`DATABASE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `ORBITAL_EMAIL_FROM`, `ORBITAL_PUBLIC_URL`,
`ORBITAL_ADMIN_EMAILS`, optional `ORBITAL_ALERT_WEBHOOK`). Step-by-step: `docs/DEPLOY.md`.

### Supabase

1. Create a project; *Database → Extensions*: enable `vector`.
2. *Connect → Session pooler*: copy the URI, put your database password in it → `DATABASE_URL`.
3. Orbital creates its tables on first start and locks the public REST API (`anon`/`authenticated`) out of them.
4. Never put the Supabase *secret* or *service_role* key in Orbital or the frontend; Orbital doesn't need them.

### Resend

1. Add and verify your domain (DNS records) in Resend.
2. Create an API key with *sending* permission only → `RESEND_API_KEY`.
3. Set `ORBITAL_EMAIL_FROM` to an address on that domain.
4. Check: Settings → Server status shows "Resend configured"; request a password reset for your own account.

## Operator tools

```bash
npm run reset-link -- someone@example.com   # prints a one-time password reset link (when email isn't set up)
```

`GET /api/admin/status`, `/api/admin/jobs/failed` and Settings → Server status show health, queue, email
and AI configuration. `GET /api/health/ready` is the load-balancer check.
