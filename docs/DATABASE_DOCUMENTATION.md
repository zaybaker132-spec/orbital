# Database documentation

PostgreSQL 15+ with the `pgvector` extension (hosted), or PGlite (embedded, same SQL). 51 tables.
Schema lives in ordered SQL files in `server/db/migrations/`, applied at start-up by `server/db/migrate.ts`.

## Migrations

| File | What it adds |
|---|---|
| 001_init.sql | users, sessions, conversations/messages, memories, documents + chunks (pgvector), knowledge graph, research, jobs |
| 002_workspaces.sql | workspaces, members, invites, API tokens, connectors, automations, actions, audit log, projects/tasks |
| 003_waitlist.sql | public waitlist |
| 004_meetings.sql | meetings and participants |
| 005_productivity.sql | reminders, focus sessions, nudges, folders, collections, milestones |
| 006_research_intelligence.sql | source assessment, lineage, hypotheses, extraction |
| 007_maintenance.sql | knowledge maintenance runs and suggestions |
| 008_docs.sql | Papers: Yjs state, versions, comments |
| 009_waitlist_admit.sql | waitlist admission |
| 010_production.sql | ai_usage, auth_events, password_resets, email_log; waitlist consent/confirm/unsubscribe; job backoff |
| 011_fk_indexes.sql | an index on each of the 48 foreign-key columns that had none |
| 012_constraints.sql | CHECK constraints on job/email status, token counts, normalized emails (NOT VALID) |
| 013_recent_bookmarks.sql | recently viewed trail and favorites |
| 014_media.sql | media library and its 1 MiB file pieces |
| 015_repeating_reminders.sql | reminders: `repeat` rule, `time_zone`, `anchor_day`, `series_id` (nullable columns, no rewrite) |

**Rules for migrations.** Each file runs once, in a transaction, recorded in `schema_migrations`. They are
additive: new tables, columns with defaults, indexes, and constraints added `NOT VALID` so existing rows are
never rewritten or rejected. No migration deletes or rewrites user data. To change a migration that has run
anywhere, add a new file instead. An upgrade from 010 to 012 was tested on a populated Postgres 16 database:
row counts were unchanged and the new constraints rejected bad rows.

**Large tables.** `CREATE INDEX` (in 011) briefly blocks writes to that table. At today's sizes this takes
milliseconds; on a large production database, run the statements from 011 by hand with
`CREATE INDEX CONCURRENTLY` first (they are `IF NOT EXISTS`, so the migration then does nothing).

## Integrity

- **Tenancy:** every workspace-owned table has `workspace_id … REFERENCES workspaces ON DELETE CASCADE`;
  deleting a workspace removes its content. User references on shared content are `ON DELETE SET NULL`
  (a teammate leaving keeps the team's documents); personal data (sessions, reminders, focus, conversations)
  cascades with the user.
- **Indexes:** every foreign key is indexed (verified by a catalog query: 0 unindexed). Hot paths have
  composite indexes, e.g. `documents(workspace_id, kind, updated_at)`, `ai_usage(workspace_id, created_at)`,
  `auth_events(email_hash, event, created_at)`, GIN indexes for full-text search and tags.
- **Vector search** is exact: it scans the embeddings of one workspace (filtered by `workspace_id` first). That is
  fast and fully accurate at personal/team scale; add an HNSW index (`USING hnsw (embedding vector_cosine_ops)`)
  if a single workspace grows past roughly 100,000 chunks.
- **Uniqueness:** emails (users, waitlist), token hashes (sessions, API tokens, invites, reset links,
  waitlist tokens), meeting codes, maintenance fingerprints.
- **Enumerations** are CHECK constraints (roles, statuses, kinds).
- **Secrets at rest:** password hashes (scrypt), token hashes (sha256), connector secrets AES-256-GCM with
  `ORBITAL_SECRET_KEY`. Losing that key makes stored connector secrets unreadable (nothing else).

## Supabase exposure

Supabase publishes every `public` table through its REST API to the `anon` and `authenticated` roles.
Orbital doesn't use that API, so `lockDownPublicApi` (run after migrations) revokes those roles' privileges
and enables row-level security with no policies on every table. Verified on Postgres 16: `anon` can read
0 of 51 tables. Orbital itself connects as the database owner through the session pooler.

## Retention (automatic, `server/lib/housekeeping.ts`)

Runs a minute after start and every 6 hours; server admins can run it from the API. Only operational records:

| Data | Kept |
|---|---|
| Sessions | until they expire (30 days) |
| Password reset links | 1 day after use or expiry |
| Finished jobs / failed jobs | 14 / 60 days |
| Email log | 180 days |
| Security events (auth_events) | 365 days |
| AI usage | 400 days (13 months of cost history) |

User content (documents, memories, conversations, Papers, research) is kept until the user deletes it or their
account/workspace. Account deletion removes the user, their personal workspace and everything in it.

## Backups and restore

- **Supabase:** check *Database → Backups* in your project for what your plan includes (daily backups and
  point-in-time recovery are paid features). Independently, keep your own nightly logical backup:
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --no-owner --file=orbital-$(date +%F).dump
  ```
  Restore into an empty database with `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" orbital-YYYY-MM-DD.dump`,
  then start Orbital against it (migrations are idempotent). Test a restore before launch.
- **Embedded (PGlite / desktop):** stop Orbital, copy `ORBITAL_DATA_DIR` (it holds the database and
  `secret.key`), start again.
- **Per workspace:** Settings → Your data → Export downloads everything as JSON.
- Back up `ORBITAL_SECRET_KEY` with the database.

## Tables

| Table | Purpose | Indexes | References (on delete) | Constraints |
|---|---|---|---|---|
| `actions` | Proposed/approved actions from automations | 4 | automations (set null), users (set null), workspaces (cascade) | CHECK ((kind = ANY (ARRAY['create_task', 'create_note', 'start_research', 'send_message']))); CHECK ((risk = ANY (ARRAY['internal', 'exte… |
| `activity_events` | Activity feed (who did what) | 3 | users (set null), workspaces (cascade) |  |
| `ai_usage` | Every AI call: tokens, estimated cost, feature | 4 | users (set null), workspaces (cascade) |  |
| `api_tokens` | Token API credentials (sha256 only) | 4 | users (set null), workspaces (cascade) | UNIQUE (token_hash) |
| `audit_log` | Workspace admin actions | 3 | users (set null), workspaces (cascade) |  |
| `auth_events` | Sign-ins, failures, resets, deletions (hashed email/IP) | 3 | users (set null) |  |
| `automations` | Scheduled briefings/monitors/operators | 4 | users (set null), workspaces (cascade) | CHECK ((kind = ANY (ARRAY['briefing', 'monitor', 'operator']))) |
| `collection_documents` | Documents in collections | 2 | collections (cascade), documents (cascade) |  |
| `collections` | Named groups of documents | 2 | workspaces (cascade) |  |
| `connectors` | Outgoing webhooks (URL/secret encrypted) | 3 | users (set null), workspaces (cascade) | CHECK ((kind = 'webhook')) |
| `conversations` | Chat threads | 6 | documents (set null), projects (set null), users (cascade), workspaces (cascade) |  |
| `doc_comments` | Papers comment threads | 4 | documents (cascade), users (set null), workspaces (cascade) |  |
| `doc_versions` | Papers named and automatic versions (Yjs snapshots) | 4 | documents (cascade), users (set null), workspaces (cascade) |  |
| `document_chunks` | Retrieval chunks with pgvector embeddings | 3 | documents (cascade), workspaces (cascade) |  |
| `document_files` | Original uploaded files (bytes) | 2 | documents (cascade), workspaces (cascade) |  |
| `documents` | Notes, uploads, clips, Papers (Yjs state) | 9 | folders (set null), projects (set null), users (set null), workspaces (cascade) |  |
| `email_log` | Email attempts and outcome (recipient hashed) | 2 | — |  |
| `extracted_items` | Facts/claims extracted from documents | 5 | documents (cascade), extractions (cascade), workspaces (cascade) |  |
| `extractions` | Extraction runs per document | 3 | documents (cascade), workspaces (cascade) |  |
| `feedback` | Answer feedback | 3 | users (cascade), workspaces (cascade) |  |
| `focus_sessions` | Focus mode sessions | 5 | documents (set null), projects (set null), users (cascade), workspaces (cascade) |  |
| `folders` | Folder tree | 3 | folders (cascade), workspaces (cascade) |  |
| `hypotheses` | Hypotheses and their tests | 5 | projects (set null), research_sessions (set null), users (set null), workspaces (cascade) |  |
| `jobs` | Durable background job queue | 3 | workspaces (cascade) |  |
| `knowledge_edges` | Graph relations | 5 | knowledge_nodes (cascade), workspaces (cascade) | CHECK ((status = ANY (ARRAY['suggested', 'confirmed', 'rejected']))); CHECK ((source_id <> target_id)) |
| `knowledge_gaps` | Detected gaps in knowledge | 2 | workspaces (cascade) | CHECK ((status = ANY (ARRAY['open', 'resolved', 'dismissed']))) |
| `knowledge_nodes` | Graph nodes | 4 | workspaces (cascade) |  |
| `maintenance_runs` | Knowledge maintenance scans | 1 | workspaces (cascade) |  |
| `maintenance_suggestions` | Merge/archive/fix suggestions (undoable) | 4 | users (set null), workspaces (cascade) | UNIQUE (workspace_id, fingerprint) |
| `meeting_participants` | Meeting attendance | 2 | meetings (cascade), users (cascade) |  |
| `meetings` | Video meetings | 3 | users (cascade) | UNIQUE (code) |
| `memories` | Long-term memory with provenance | 4 | users (set null), workspaces (cascade) | CHECK ((status = ANY (ARRAY['active', 'pending', 'rejected', 'archived']))) |
| `messages` | Chat messages | 4 | conversations (cascade), workspaces (cascade) | CHECK ((role = ANY (ARRAY['user', 'assistant']))) |
| `milestones` | Project milestones | 3 | projects (cascade), workspaces (cascade) |  |
| `nudge_dismissals` | Dismissed nudges | 2 | users (cascade), workspaces (cascade) |  |
| `opportunities` | Tracked opportunities with evidence | 4 | projects (set null), research_sessions (set null), workspaces (cascade) |  |
| `password_resets` | One-time reset tokens (sha256 only) | 2 | users (cascade) |  |
| `project_links` | Items linked to projects | 2 | projects (cascade), workspaces (cascade) |  |
| `projects` | Projects | 2 | workspaces (cascade) |  |
| `reminders` | Reminders | 4 | users (cascade), workspaces (cascade) | CHECK ((status = ANY (ARRAY['scheduled', 'fired', 'done', 'dismissed']))); CHECK ((item_type = ANY (ARRAY['task', 'document', 'project', … |
| `research_sessions` | Research runs and reports | 5 | conversations (set null), hypotheses (set null), projects (set null), workspaces (cascade) |  |
| `research_sources` | Sources with assessments | 3 | research_sessions (cascade), workspaces (cascade) |  |
| `schema_migrations` | Applied migrations | 1 | — |  |
| `sessions` | Login sessions (sha256 of token) | 2 | users (cascade) |  |
| `tasks` | Project tasks | 4 | milestones (set null), projects (cascade), workspaces (cascade) |  |
| `user_preferences` | Language and UI settings | 1 | users (cascade) |  |
| `users` | Accounts (scrypt password hash) | 2 | — | UNIQUE (email) |
| `waitlist` | Public waitlist with consent, confirmation, unsubscribe | 4 | — | UNIQUE (email) |
| `workspace_invites` | Pending invitations (sha256 token) | 4 | users (set null), workspaces (cascade) | CHECK ((role = ANY (ARRAY['admin', 'member', 'viewer']))); UNIQUE (token_hash) |
| `workspace_members` | Membership and role | 2 | users (cascade), workspaces (cascade) | CHECK ((role = ANY (ARRAY['owner', 'admin', 'member', 'viewer']))) |
| `workspaces` | Personal and team workspaces | 2 | users (set null) | CHECK ((kind = ANY (ARRAY['personal', 'business']))) |
