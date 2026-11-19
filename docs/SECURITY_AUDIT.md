# Security audit

Scope: the Orbital server (`server/`), the web client's handling of data and secrets (`src/`), the database
schema and its exposure through Supabase, dependencies, and deployment configuration. Method: code review of
every route and middleware, automated regression tests for each finding (`server/test/production.test.ts`
plus the existing suites), a dependency audit, and a scan of the built frontend bundle for secrets.
Tests run on PGlite and on PostgreSQL 16 + pgvector with Supabase's `anon`/`authenticated` roles present.

Status key: **Fixed** (changed and covered by a test), **Mitigated** (risk reduced, residual noted),
**Accepted** (documented trade-off), **Open** (needs work or a decision).

## Findings and fixes

| # | Area | Finding | Severity | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Rate limiting | Behind a hosting proxy every request appeared to come from the proxy's IP, so per-IP limits (sign-in, waitlist, reset) were either shared by all users or trivially useless. | High | Fixed: `ORBITAL_TRUST_PROXY` (default loopback; `1` on Render) | production.test "lockout", per-client IPs |
| 2 | Brute force | Sign-in throttling was per IP only; a botnet could guess one account's password from many IPs. | High | Fixed: per-account lockout after 8 failures in 15 min (any IP), events stored with hashed email/IP | "lockout" |
| 3 | Account recovery | No password reset at all. | High (essential function) | Fixed: email link (1 h, single use, only hash stored), signs out every device, no account discovery, honest failure when email is unavailable or the send fails; `npm run reset-link` for operators | "password reset" |
| 4 | Host header poisoning | Emailed links would have used the request's Host header. | High | Fixed: links use `ORBITAL_PUBLIC_URL`; Host is trusted only for localhost | "password reset" asserts the link base |
| 5 | Account deletion | Deleting the account needed only a session (a hijacked session could destroy all data). | Medium | Fixed: requires current password + typing DELETE; audited | "account deletion" |
| 6 | IDOR (references) | Task `milestoneId` and document/paper `folderId` were stored without checking they belong to the caller's workspace. | Medium | Fixed: `ownMilestone`, `ownFolder` checks | "IDOR" matrix |
| 7 | IDOR (matrix) | Verified 21 read/update/delete probes across documents, papers, projects, milestones, folders, memories, conversations from another workspace, plus foreign workspace selection. Deletes are idempotent (200, no effect) and the test proves nothing changed. | n/a | Pass | "IDOR" |
| 8 | Transport | No HSTS or http→https redirect. | Medium | Fixed: `ORBITAL_FORCE_HTTPS` (auto-on in production with an https public URL); writes over http are refused, not redirected | "https" |
| 9 | Headers | API responses had no CSP. | Low | Fixed: `default-src 'none'; frame-ancestors 'none'` on every API response; `no-store` caching | "health" |
| 10 | Waitlist overwrite | Anyone could overwrite another person's waitlist answers by re-submitting their email. | Medium | Fixed: confirmed entries can't be rewritten; confirmation by email | "waitlist" |
| 11 | Consent / anti-spam law | No recorded consent, no unsubscribe. | Medium (legal) | Fixed: explicit consent checkbox (text and time stored), List-Unsubscribe + RFC 8058 one-click, unsubscribed people are never emailed | "waitlist" |
| 12 | Fake success | Admitting a waitlist person implied they were notified; there was no email at all. | Medium | Fixed: real email via Resend, the admin sees sent / failed / not configured / unsubscribed | "waitlist", "server without email" |
| 13 | AI cost abuse | No metering or cap; a compromised or runaway account could run up an unbounded bill. | High | Fixed: per-call token + cost metering, monthly per-workspace allowance enforced before the provider is called, admin views | "AI" |
| 14 | AI availability | The OpenAI-compatible provider had no timeout; a hung upstream held requests forever. | Medium | Fixed: deadline + abort on every call | code review |
| 15 | Jobs | Failed jobs retried immediately (hammering a rate-limited upstream); a restart on one instance stole jobs running on another. | Medium | Fixed: backoff 30 s / 2 min; heartbeat + stale sweep | "jobs" tests |
| 16 | Logging | Errors in background engines went to raw console output; error messages could carry API keys or DB passwords. | Medium | Fixed: structured logger everywhere, redaction by key and by value (Anthropic/OpenAI/Resend/Supabase keys, JWTs, bearer tokens, URL passwords) | "logs" |
| 17 | Data retention | Sessions, tokens, job rows and logs grew forever. | Low | Fixed: retention schedule (housekeeping), never touches user content | "ops" |
| 18 | Input normalization | Emails with surrounding spaces were rejected before trimming (sign-in, waitlist, invites). | Low | Fixed: trim + lowercase, then validate | "waitlist" |
| 19 | Waitlist position on Postgres | Position compared a JS-rounded timestamp, telling a new person they were #0. | Low (bug) | Fixed: comparison inside SQL | api.test on Postgres |
| 20 | Dependencies (server) | zod (memory exhaustion, high), multer/busboy/dicer (crash, high), fflate (infinite loop, moderate). | High | Fixed: zod 4.6.7, multer 2.x, fflate 0.8.3 → `npm audit --omit=dev`: 0 | npm audit |
| 21 | Dependencies (desktop/build) | Electron ≤42 (ASAR integrity bypass, IPC spoofing), electron-builder chain (tar, extract-zip path traversal at build time). | High (desktop app only) | **Open**: needs Electron 45 + electron-builder 26 and a re-test of the Mac and Windows builds | npm audit |
| 22 | Dependencies (frontend) | react-router open redirect via backslash paths. | Moderate | Accepted: Orbital never navigates to a user-supplied path; upgrade with the next router major | grep for redirect params |
| 23 | Dev server | esbuild/vite dev server can be read cross-origin. | Moderate (dev only) | Accepted: not used in production; don't run `npm run dev` on untrusted networks | |
| 24 | Database exposure | Supabase exposes every `public` table through its REST API with the anon key. | Critical if left open | Fixed earlier: `lockDownPublicApi` revokes `anon`/`authenticated` and enables RLS on every table; verified 0 of 51 tables readable by `anon` on Postgres 16 | migrate.ts, manual SQL check |

## Controls verified (no change needed)

- **SQL injection:** every query is parameterized (`$1…`); dynamic SQL only interpolates constants
  (e.g. the retention table). No string-built WHERE clauses from input.
- **XSS:** React escapes by default; Markdown rendering sanitizes; uploaded files are served with their stored
  type, `nosniff` and `default-src 'none'`; waitlist HTML pages escape their only dynamic value and send their own CSP.
- **CSRF:** custom header requirement on all state-changing `/api` calls (tested: a request with a stolen cookie
  but no header is refused). SameSite=Lax cookies as defence in depth.
- **Cookies:** `orbital_session` is HttpOnly, SameSite=Lax, Secure in production, 30-day absolute expiry
  (`SESSION_TTL_DAYS`), only the token's sha256 is stored; password change/reset revokes other sessions;
  users can see and revoke sessions.
- **Passwords:** scrypt (N=16384, r=8, p=1, 64-byte key, random salt); constant-time compare; a dummy hash is
  checked for unknown emails so timing doesn't reveal accounts.
- **CORS:** no CORS headers are sent; the API is same-origin only. The token API (`/api/v1`) uses Bearer tokens,
  not cookies.
- **SSRF:** webhooks, connectors and the web clipper resolve the host and refuse private, loopback and
  link-local addresses unless `ORBITAL_ALLOW_PRIVATE_WEBHOOKS=true`; redirects are re-checked.
- **Uploads:** size limit (`MAX_UPLOAD_MB`), per-user rate limit, type detection, stored in the database
  (no filesystem paths from input), malformed multipart returns 400.
- **Authorization:** roles `owner > admin > member > viewer`; viewers are read-only by default with an explicit
  allowlist; admin-only routes use `requireRole`; server-operator routes (waitlist, status, jobs, usage) need
  `ORBITAL_ADMIN_EMAILS` and are tested for 401/403.
- **Information leakage:** 500 responses carry only a request id; no `x-powered-by`; status endpoints were
  checked for secrets; job payloads (user content) are excluded from the admin job list.
- **Secrets in the bundle:** the built `dist/` contains only placeholder text (`sk-ant-…`, `ANTHROPIC_API_KEY=…`),
  no keys. AI, email and database credentials exist only in server environment variables.
- **Audit logging:** workspace actions in `audit_log`; sign-ins, failures, password changes/resets and account
  deletion in `auth_events` (hashed email and IP).

## Residual risks and recommendations

1. **Electron upgrade (Open, High for desktop users).** Upgrade to Electron 45 / electron-builder 26, rebuild,
   and test both installers before the next desktop release. Code-sign and notarize the builds (needs Apple and
   Windows certificates).
2. **Account lockout can be used to annoy a known user** (8 wrong guesses lock them out for 15 minutes). Password
   reset still works. Accepted trade-off against distributed guessing.
3. **DNS rebinding:** the SSRF check resolves the hostname, then the HTTP client resolves it again. A hostile DNS
   server could answer differently the second time. Pinning the resolved IP in the HTTP agent closes this.
4. **In-memory rate limits and live events are per instance.** Run one web instance (the Render blueprint does),
   or move limits and the event bus to Postgres/Redis before scaling out.
5. **No MFA.** Recommended before opening sign-up broadly: TOTP for owners and server admins.
6. **No session idle timeout** (30-day absolute). Consider a shorter TTL for admins.
7. **Waitlist tokens are stored in clear** (they only confirm or unsubscribe that one entry and must be re-sent
   in later emails). Anyone with database access already has the entries themselves.
8. **Secrets shared in chat during setup** (a Supabase secret key and an Anthropic key were pasted into the
   conversation earlier): rotate both in their dashboards. Neither is stored in the repository.
