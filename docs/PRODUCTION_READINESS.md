# Production readiness

**Verdict: not yet ready for a public launch. Ready for a private, invite-only beta once the four
launch blockers below are done.** The code-level blockers found in this review are fixed and tested.
What remains needs credentials, a decision, or hardware this review didn't have: live email, live AI and
database connections, a desktop runtime upgrade, and backups. The app shouldn't be called production-ready
until those are verified.

## Launch blockers

| # | Item | Why it blocks | Owner action |
|---|---|---|---|
| B1 | **Rotate the keys pasted in chat** (Supabase secret key, Anthropic key) | They are exposed outside your control | Rotate both in their dashboards; never paste keys into chat again |
| B2 | **Email (Resend) configured and verified** | Without it there is no password reset and no waitlist confirmation (the app says so honestly, but people can't recover accounts) | Verify a domain in Resend, set `RESEND_API_KEY` + `ORBITAL_EMAIL_FROM`, send yourself a reset |
| B3 | **Backups** | No tested restore = one mistake loses everyone's data | Confirm your Supabase plan's backups, add a nightly `pg_dump`, do one test restore (DATABASE_DOCUMENTATION.md) |
| B4 | **Live end-to-end check on the real stack** | Supabase, Render and Anthropic were not reachable from this review | Deploy to a staging Render service with a separate Supabase project, run the checklist below |

Before shipping new **desktop** builds: upgrade Electron (SECURITY_AUDIT.md #21) and test both installers.
The current desktop zips predate this work and still run on the older Electron.

## Status by area

| Area | Status | Notes |
|---|---|---|
| Tenant isolation / IDOR | PASS | Matrix test across 7 resource types + foreign references |
| Authentication | PASS | scrypt, hashed sessions, lockout, reset, session revocation |
| Authorization | PASS | Roles, viewer read-only, server-admin routes tested |
| CSRF / cookies / headers / HTTPS | PASS | Tested, including HSTS and redirect behaviour |
| Input validation | PASS | zod on every route; email normalization fixed |
| Secrets handling | PASS (code) / BLOCKED (B1) | None in repo, bundle or logs; leaked chat keys must be rotated |
| Account deletion & data export | PASS | Password-confirmed deletion; JSON export |
| Password recovery | PASS (code) / BLOCKED (B2) | Works end-to-end against a mock provider; needs real email |
| Waitlist (consent, confirm, unsubscribe, admit) | PASS (code) / BLOCKED (B2) | Honest status when email isn't configured |
| AI: server-side, timeouts, retries, metering, cap | PASS (mock) / BLOCKED (live key) | Tested through the real SDK against a mock |
| Background jobs | PASS | Backoff, failed-job view and retry, multi-instance-safe claiming and takeover |
| Database: constraints, FKs, indexes, migrations | PASS | 0 unindexed FKs; additive migrations tested on populated data |
| Database exposure (Supabase REST) | PASS | 0 tables readable by `anon` |
| Backups & restore | **BLOCKED (B3)** | Documented; not set up or tested |
| Retention | PASS | Automatic, operational records only |
| Logging & monitoring | PASS | JSON logs with request ids, secret redaction, error alerts webhook, readiness check, admin status |
| Alerting | PASS (code) / UNTESTED (live) | Needs `ORBITAL_ALERT_WEBHOOK` |
| Performance | PASS at beta scale | p95 < 60 ms under 20 concurrent requests except the full graph (~250 ms) |
| Horizontal scaling | Limited | Rate limits and live events are in-memory per instance: run **one** web instance |
| Production dependencies | PASS | 0 known vulnerabilities |
| Desktop app runtime | **FAIL** | Electron 33 has known high-severity issues; upgrade before the next desktop release |
| Code signing (Mac/Windows) | BLOCKED | Needs Apple Developer ID and a Windows code-signing certificate |
| MFA | Not implemented | Recommended before opening sign-up publicly |
| Live deploy (Render + Supabase) | BLOCKED (B4) | Not deployed (no authorization or credentials in this review) |

## Deployment checklist

Before the first deploy:

- [ ] B1: keys rotated
- [ ] Supabase project created, `vector` extension enabled, session-pooler URL in `DATABASE_URL`
- [ ] Render blueprint applied; secrets entered in Render, not in files
- [ ] `ORBITAL_PUBLIC_URL` is the final https address; custom domain attached in Render
- [ ] `ORBITAL_ADMIN_EMAILS` set to your address; `ORBITAL_ALLOW_SIGNUP=false` for the beta
- [ ] `ORBITAL_AI_MONTHLY_TOKENS` set to a number you're comfortable paying for per workspace
- [ ] B2: Resend domain verified, key + sender set
- [ ] `ORBITAL_ALERT_WEBHOOK` set (Slack or similar)
- [ ] B3: backups confirmed + one restore tested

After deploying (staging first, then production):

- [ ] `GET /api/health/ready` returns 200 and Render's health check is green
- [ ] `http://` redirects to `https://`; response has `strict-transport-security`
- [ ] Settings → Server status: database postgres, email configured, AI configured, HTTPS enforced, alerts on
- [ ] Join the waitlist with a second address → confirmation email arrives → confirm link works → unsubscribe link works
- [ ] Admit that address → "you're in" email arrives → sign up with it
- [ ] Forgot password → email arrives → reset works → old sessions are signed out
- [ ] Chat with AI → Settings → AI usage shows the request and cost
- [ ] Create a Paper, open it in a second browser, edit together
- [ ] Upload a PDF and an image; open the original file
- [ ] Delete a test account with its password
- [ ] Watch the logs for an hour: no `level:"error"` lines

## Operations

- **Health:** `/api/health` (liveness), `/api/health/ready` (database).
- **Status:** Settings → Server status, or `GET /api/admin/status`.
- **Failed jobs:** Settings → Server status → Failed jobs (retry), or `GET /api/admin/jobs/failed`.
- **Logs:** JSON lines with `req`, `user`, `ws`, `feature`; search by the `x-request-id` a user reports.
- **AI spend:** Settings → AI & research (workspace) and server totals for admins; the monthly allowance
  stops further AI calls with a clear message.
- **Locked-out user:** wait 15 minutes, or reset the password (email, or `npm run reset-link -- email`).
- **Rollback:** redeploy the previous Render build. Migrations are additive, so older code runs on the newer schema.
