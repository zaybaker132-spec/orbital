# Test results

Run on 2026-11-19 in a clean container. Every number below comes from an actual run; nothing is estimated.

## Summary

| Check | Command | Result |
|---|---|---|
| Typecheck (client + server) | `npm run typecheck` | **PASS** (0 errors) |
| Production web build | `npm run build` | **PASS** |
| Server bundle (desktop) | `npm run build:server` | **PASS** |
| Full suite, embedded database (PGlite) | `npm test` | **PASS**: 81 tests, 81 pass, 0 fail (~21 s) |
| Full suite, PostgreSQL 16.15 + pgvector, `anon`/`authenticated` roles present | each file against a fresh database via `TEST_DATABASE_URL` | **PASS**: 76 tests, 76 pass, 0 fail (the 5 i18n tests use no database) |
| Migration upgrade on populated Postgres (010 → 012) | `migrate()` on a database holding data | **PASS**: data unchanged, new constraints enforced |
| Supabase public API lock-down | catalog query as `anon` | **PASS**: 0 of 51 tables readable; RLS on all |
| Unindexed foreign keys | catalog query | **PASS**: 0 (48 before migration 011) |
| Production dependency audit | `npm audit --omit=dev` | **PASS**: 0 vulnerabilities (5 before) |
| Full dependency audit (incl. desktop/build tools) | `npm audit` | **FAIL**: Electron / electron-builder chain still vulnerable (desktop packaging only); see SECURITY_AUDIT.md #21 |
| Secrets in the frontend bundle | grep of `dist/` for key patterns | **PASS**: placeholders only |
| Production server smoke | `npm start`, curl, Playwright | **PASS**: readiness 200, headers present, Settings → Server status and password reset render, no page errors |

## Coverage by category

| Category | Where | Status |
|---|---|---|
| Unit | citation/statistic guards, OpenAlex/Wikipedia parsing, AI error text, log redaction, i18n catalogs | PASS |
| Integration (HTTP + database) | every suite starts the real Express app on a real database | PASS |
| API | 195 routes; all major flows exercised | PASS |
| Authentication | sign-up, sign-in, sessions, password change, reset by email, lockout, invite-only | PASS |
| Authorization | roles (owner/admin/member/viewer), server admins, cross-workspace IDOR matrix (21 probes + 4 foreign-reference cases) | PASS |
| Database | migrations on PGlite and Postgres; upgrade on populated data; constraints; retention | PASS |
| AI | real Anthropic SDK against a local mock: chat streaming, research, structured outputs, usage metering, monthly allowance | PASS |
| Validation | waitlist rules, consent, emails, invalid JSON, bad ids | PASS |
| Security regression | CSRF, cookie flags, CSP/HSTS/https redirect, request ids, secret scrubbing, stack-trace leakage, SSRF (clipper), spreadsheet-formula injection | PASS |
| Email | local stand-in for Resend: delivered, provider failure, not configured, unsubscribed; hashed recipient log | PASS |
| Jobs | backoff, no immediate retry, stale-job takeover safety, admin retry | PASS |
| End-to-end (browser) | Playwright against the production build: settings, server status, forgot-password flow; earlier: Papers live co-editing in two browsers | PASS (targeted, not a full regression suite) |
| Load | `npx tsx server/test/bench.ts` (see below) | Measured |
| Live third parties (Anthropic, Resend, Supabase, Render) | needs credentials | **BLOCKED** |
| Desktop installers (Mac/Windows) after this change | needs a Mac/Windows machine and signing certificates | **UNTESTED** in this pass (server bundle builds) |

## Performance baseline

300 documents and 30 projects in one workspace; 40 sequential requests, then 20 concurrent clients × 5.

PostgreSQL 16 (local):

| Endpoint | p50 ms | p95 ms | p50 ms (20 concurrent) | p95 ms (20 concurrent) |
|---|---|---|---|---|
| health/ready | 1.3 | 1.8 | 12.3 | 51.0 |
| auth/me | 1.6 | 2.2 | 15.6 | 22.4 |
| documents list | 4.5 | 6.3 | 50.6 | 59.4 |
| document | 1.6 | 2.5 | 16.1 | 22.5 |
| search | 4.0 | 6.1 | 49.9 | 59.6 |
| projects | 2.5 | 3.6 | 21.6 | 27.9 |
| graph | 12.0 | 14.0 | 216.7 | 249.2 |
| memories | 2.3 | 2.7 | 16.8 | 21.5 |

Writes: 6.2 ms each including indexing. Memory: 272 MB RSS.
Embedded PGlite is 2–3× slower under concurrency (one connection): fine for the desktop app, not for a public server.
The knowledge graph endpoint returns the whole graph and is the slowest read; it is the first candidate for
pagination if workspaces grow large.

## Test inventory

## ai.test.ts
- chat streams through the SDK, cites retrieved memories, extracts verified memories
- answers follow the person's language; English prompts are unchanged
- research: plan → web sources with citations → synthesis → verification drops fabrications
- opportunities: grounded discovery, validation research, execution plan
- the API key never reaches the browser
## api.test.ts
- auth: signup, csrf header required, session
- knowledge: notes are indexed, wiki-linked, searchable
- memory: create, correct, dedupe, delete
- chat without AI: retrieval works, explicit memories honoured, answer is honest
- graph: manual connections and suggestion review
- projects: tasks, milestones, brief without AI
- opportunities: discovery refuses without AI; manual tracking works
- growth: real counts, timeline, maintenance
- isolation: one user can never read or change another's data
- waitlist: public signup, validation, spam trap, admin-only export
- meetings: codes, host controls, locked rooms, no spoofed signalling
- without an AI provider: images are kept, conversations save as notes, voice explains what's needed
- routes: real pages are recognised; anything else is a 404
- knowledge extraction without AI: dated events, figures and key terms
- knowledge maintenance: suggestions, never silent changes; merge, review, connect, dismiss and undo
- account: rename, change password signs out other devices, preferences validated
## business.test.ts
- workspaces: create, invite by link, email-bound acceptance, roles
- shared knowledge, private conversations, viewer is read-only, personal space stays separate
- public API: token scopes, ingest, search, ask, revocation, tenant isolation
- operations agent: internal actions auto-run, external messages wait for approval, then deliver signed
- briefing with standing authorization delivers automatically; scheduler fires due automations
- schedules respect time zones; webhook SSRF guard
## docs.test.ts
- two people edit the same doc at once; both edits survive and are relayed live
- snapshots make the doc searchable and keep version history
- comments: threads, replies, resolve; live notice
- viewers read and follow along but can't change the doc; outsiders see nothing
- star, copy (with live content), first-open seeding is claimed once, delete
- writing help: rewrites a selection; 'write' uses the knowledge base
## i18n.test.ts
- language instruction is added only for non-English, and follows async work
## intel.test.ts
- source intelligence: authority, recency, methodology, conflicts and corroboration signals
- living reports: shelf life by sensitivity, measured from the newest evidence
- lineage: the best matching passage is the sentence that shares the claim's words
- research report: verified lineage fields, conclusions, source assessments, freshness
- lineage: conclusion → findings → reasoning → exact passage → source → search
- living reports: refreshing a stale section keeps what it used to say
- contradiction lab: positions, why sources disagree, what would resolve it
- hypotheses: test for and against, verdict with history, next tests
- knowledge extraction: verified concepts, evidence, timeline and relationships, into the graph and search
- knowledge maintenance with AI: conflicting memories are resolved by choice, archived not deleted, and undoable
## invite.test.ts
- invite-only: admin joins, strangers wait, admitted waitlist people join
- hosted Postgres connections are encrypted; local ones aren't
## production.test.ts
- health: liveness and readiness (database ping), request ids, secure headers
- https: forced https redirects reads, refuses writes, and sends HSTS
- csrf and cookies: state changes need the Orbital header; session cookie is HttpOnly + SameSite
- IDOR: nothing in one workspace can be read, changed, linked or deleted from another
- lockout: repeated wrong passwords throttle the account, whatever the IP
- password reset: email link, one use, signs out everywhere, no account discovery
- account deletion needs the password and the word DELETE, and removes the data
- waitlist: consent required, confirmation email, one-click unsubscribe, honest admit notification
- waitlist: a server without email says so instead of pretending
- AI: every call is metered (tokens, cost) and the monthly allowance is enforced
- ops: admin-only status, failed jobs with retry, retention
- jobs: a failing job waits before retrying (backoff) and fails for good after its attempts
- logs: secrets are scrubbed by key name and by value
- jobs: only jobs whose heartbeat stopped are taken over (safe with several instances)
## productivity.test.ts
- files: Word, Excel and PowerPoint become searchable Markdown
- files: images are read by the AI provider and served back only to their workspace
- clipper: article extraction keeps the story and drops the chrome
- clipper: refuses private addresses, saves pages and selections, dedupes
- projects: deadline, progress and overdue counts
- nudges: overdue and upcoming work, deadlines, stale ideas; dismiss and snooze
- reminders: personal, fire on time over the live stream, snooze and finish
- focus: one session at a time, notes saved to Knowledge, tasks finished are counted
- search: finds words inside conversations, notes, files, clips and research, with highlights
- voice: server transcription and saving a conversation to memory
- activity calendar: a year of days, colour-coded by kind, per project and in the viewer's time zone
## research.test.ts
- citations to sources that were never retrieved are removed and the finding downgraded
- statistics that don't appear in the source text are dropped
- valid citations are kept
- OpenAlex abstracts are reconstructed from the inverted index
- Wikipedia extracts keep page order and skip stubs
- AI errors become plain sentences, never raw JSON

## How to reproduce

```bash
npm ci && npm run typecheck && npm run build && npm test
# Postgres: an empty database per file
TEST_DATABASE_URL=postgres://user@host/empty_db npx tsx --test server/test/production.test.ts
npx tsx server/test/bench.ts
```
