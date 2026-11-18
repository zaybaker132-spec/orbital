# Architecture

```
orbital/
├─ server/                     Express + TypeScript API (tsx)
│  ├─ index.ts                 app factory, security headers, static serving (prod)
│  ├─ config.ts                env configuration
│  ├─ db/                      Database adapter (PGlite | pg), migrations runner, SQL migrations
│  ├─ main.ts                  process entry (also bundled for the desktop app)
│  ├─ auth/                    scrypt passwords, hashed session tokens, CSRF check, workspace membership + roles
│  ├─ ai/
│  │  ├─ provider.ts           provider-independent interface: stream / json / webSearch / readFile (images, scanned PDFs)
│  │  ├─ anthropic.ts          Claude via @anthropic-ai/sdk (adaptive thinking, effort, fallbacks, web search)
│  │  ├─ openai.ts             OpenAI-compatible endpoint (no web search)
│  │  └─ embeddings.ts         local hashed features | remote embeddings (256-d)
│  ├─ engines/
│  │  ├─ memory.ts             ENGINE 01 — extraction, verification, dedupe, CRUD
│  │  ├─ graph.ts              ENGINE 02 — nodes, suggestions, classification, wiki links, clusters
│  │  ├─ research.ts           ENGINE 03 — workflow, synthesis, verification, graph integration
│  │  ├─ retrieval.ts          ENGINE 04 — hybrid retrieval + graph expansion + context framing
│  │  ├─ chat.ts               ENGINE 04 — modes, streaming, post-turn jobs
│  │  ├─ opportunity.ts        ENGINE 05 — discovery, validation, execution plans
│  │  ├─ knowledge.ts          documents → chunks → embeddings → nodes
│  │  ├─ automation.ts         OPERATIONS — schedules, briefings, monitors, operations agent, actions, connectors
│  │  ├─ files.ts              file intelligence: PDF, .docx, .xlsx, .pptx (local XML parsing), images via the AI provider
│  │  ├─ clipper.ts            web clipper: SSRF-guarded fetch (every redirect), article extraction → Markdown
│  │  ├─ reminders.ts          personal reminders (scheduler tick → per-user SSE) and computed nudges
│  │  ├─ search.ts             universal full-text search with highlighted snippets
│  │  ├─ sourceIntel.ts        source credibility: authority, methodology, recency, independence, corroboration
│  │  ├─ lineage.ts            conclusion → finding → passage → source → search, for any report
│  │  ├─ freshness.ts          living reports: shelf life per fact, daily checks, section refresh with history
│  │  ├─ hypotheses.ts         hypothesis verdicts from hypothesis-mode research (research.ts plans and synthesizes)
│  │  ├─ extraction.ts         long-document extraction: concepts, evidence, timeline, relationships
│  │  ├─ maintenance.ts        knowledge maintenance: daily scans, stored suggestions, apply with undo, health score
│  │  └─ growth.ts             metrics, timeline, maintenance
│  ├─ research/sources.ts      Wikipedia, OpenAlex, web-search citation connectors
│  ├─ lib/                     jobs (durable queue), events (SSE bus), activity + audit logs, crypto, rate limit, http helpers
│  └─ routes/                  core.ts (auth, events, chat, memory, graph, feedback), workspace.ts (knowledge, research,
│                              projects, opportunities, growth), business.ts (workspaces, team, connectors, automations,
│                              approvals, tokens, audit), v1.ts (token-authenticated public API), productivity.ts
│                              (reminders, nudges, focus sessions, voice transcription, save conversation to memory),
│                              meetings.ts, waitlist.ts, researchIntel.ts (lineage, assessment, refresh,
│                              contradiction lab from the graph, hypotheses, knowledge extraction)
├─ desktop/                    Electron main process + preload bridge
├─ scripts/build-server.mjs    esbuild bundle of the server for the desktop app
├─ electron-builder.yml        installer configuration (dmg, nsis, AppImage, deb)
├─ .github/workflows/          desktop.yml — test, then build installers on macOS/Windows/Linux
├─ src/                        React + TypeScript + Tailwind (Vite)
│  ├─ neural/                  Neural Core: geometry, GLSL, R3F component, 2D fallback
│  ├─ components/              Shell (sidebar/topbar), RightPanel, CommandPalette, Markdown, ui kit
│  ├─ pages/                   Chat, Core, Research, Knowledge, Connections, Projects, Opportunities, Reminders, Focus,
│  │                           Search, Clip, Meetings, Settings, Auth, Waitlist
│  ├─ state/                   app (auth/prefs), core (Neural Core states), events (SSE), ui (toasts, panel)
│  └─ lib/                     api client, cached resources with invalidation, formatting, voice (speech in/out), when
└─ docs/
```

## Tenancy

Data belongs to a **workspace**, not a user. Every user has a personal workspace whose id equals their user id (so data created before workspaces existed maps 1:1); business workspaces have members with roles. `resolveWorkspace` reads `X-Orbital-Workspace` (or the `workspace` query parameter for the SSE stream), checks membership and the viewer write allowlist, and sets `req.workspace`; every query filters on `workspace_id`. Conversations additionally carry `created_by` and are visible only to their author. The public API authenticates with workspace tokens and sets the same `req.workspace`.

## Data model

`users`, `sessions`, `user_preferences`, `workspaces`, `workspace_members`, `workspace_invites`, `api_tokens`, `connectors`, `automations`, `actions`, `audit_log`, `conversations`, `messages`, `memories`, `knowledge_nodes`, `knowledge_edges`, `folders`, `collections`, `collection_documents`, `documents`, `document_chunks`, `research_sessions`, `research_sources`, `projects`, `project_links`, `milestones`, `tasks`, `opportunities`, `feedback`, `knowledge_gaps`, `activity_events`, `jobs`.

- Embeddings are `vector(256)` with an `embedding_model` column; similarity is only computed between vectors from the same model.
- Full-text search uses generated `tsvector` columns with GIN indexes.
- Graph edges are unique per `(user, source, target, relation)` with a `status` of `suggested | confirmed | rejected` and an `origin` (`ai`, `similarity`, `user`, `system`).
- Personal-scale vector search uses exact scans filtered by `user_id` (correct under ownership filtering). Add HNSW indexes per user partition if a single account grows past ~10⁵ items.

## Request flow: a chat turn

1. `POST /api/conversations/:id/messages` (SSE response).
2. Store the user message; honour explicit "remember…" instructions.
3. Deep Research → enqueue `research.run`, post a live research card, done.
4. Otherwise: hybrid retrieval → `context` event (shown in the right panel) → stream model output as `delta` events → store the assistant message with its retrieval summary → `done`.
5. Background: `memory.extract` (if enabled) and, for Deep Thinking/Learning, `gaps.detect`.
6. Server events (`/api/events`) drive the Neural Core: thinking → learning (new memories/nodes) → connecting (suggested edges).

## Background jobs

`jobs` table + in-process worker (concurrency 3). Interrupted jobs are re-queued on boot; failures retry twice unless marked non-retryable. Types: `research.run`, `memory.extract`, `gaps.detect`, `document.index`, `opportunity.discover`, `automation.run`.

The automation scheduler ticks every minute, claims due automations with a conditional update (so a run is enqueued once), advances `next_run_at` in the automation's own time zone, and enqueues a durable `automation.run` job.

## AI provider interface

```ts
interface LLMProvider {
  stream(opts: { system, messages, effort?, maxTokens?, onText?, signal? }): Promise<{ text, stopReason }>;
  json<T>(opts: { system, prompt, schema: ZodType<T>, effort?, maxTokens? }): Promise<T>;   // structured outputs
  webSearch?(opts: { query, instructions, maxUses? }): Promise<{ text, citations, results }>;
}
```

Engines depend only on this interface. Claude uses structured outputs (`output_config.format`), adaptive thinking with `effort` per task (low for extraction/classification, medium for chat, high for synthesis/deep thinking/discovery), prompt caching on the system prompt, and streaming for long outputs.

Related: [Desktop app](DESKTOP.md) builds on this server layout · [Orbital for business](BUSINESS.md) describes the tenancy and operations layer · Up: [README](../README.md)
