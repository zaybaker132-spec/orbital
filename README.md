# ORBITAL

**Your intelligence. Compounding.**

Orbital is a personal — and team — intelligence environment. Every conversation, note, document, research session and project feeds a private knowledge system that remembers what matters, connects ideas, researches with verifiable sources, and turns accumulated knowledge into practical opportunities. Its signature is the **Neural Core**: a human head and brain built from tens of thousands of individually rendered particles, animated by what the system is actually doing.

---

## Quick start

Requirements: Node.js 22+.

```bash
npm install
```

```bash
cp .env.example .env    # then add ANTHROPIC_API_KEY (optional, see below)
```

```bash
npm run dev
```

Open http://localhost:5173 and create an account. The API runs on :8787 and Vite proxies `/api` to it.

### Desktop app

```bash
npm run desktop
```

Runs Orbital as a native app (Electron) with its own private database. `npm run desktop:dist` builds installers; the GitHub Actions workflow builds macOS, Windows and Linux installers on real runners. See [Desktop app](docs/DESKTOP.md).

No database setup is needed: by default Orbital runs **embedded PostgreSQL (PGlite) with pgvector**, stored in `.orbital-data/`. Point `DATABASE_URL` at a PostgreSQL server with pgvector for production — the same migrations run on both.

### Production

```bash
npm run build
```

```bash
NODE_ENV=production npm start
```

The server serves the built app with a strict Content-Security-Policy, secure cookies (HTTPS required) and security headers.

### Tests

```bash
npm test
```

38 tests: auth and CSRF, notes/graph/search, memory, chat without AI, projects, growth metrics, **cross-user and cross-workspace isolation**, research verification, source parsing, the full AI pipeline (streaming chat, memory extraction, research synthesis + verification, opportunity discovery → validation → execution plan), files (Word, Excel, PowerPoint, images through the AI provider), the web clipper (article extraction, SSRF refusal, selections, dedupe), reminders delivered only to their owner over the live stream, nudges, project deadlines and progress, focus sessions, universal search with highlights and privacy, voice transcription and "save to memory", and the business layer (roles, email-bound invites, private conversations, viewer restrictions, API token scopes and revocation, operations agent with auto-run internal actions and approval-gated signed webhooks, scheduled briefings, time-zone schedules, SSRF guard). AI paths run through the real Anthropic SDK against a deterministic local mock of the Messages API.

---

## Configuration

All secrets are server-side environment variables. Nothing is ever sent to the browser.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude (default model `claude-opus-5-5`): answers, live web research, memory extraction, relationship classification, opportunity discovery. |
| `ANTHROPIC_MODEL` | Override the model. |
| `ANTHROPIC_FALLBACKS` | Server-side refusal fallback (Anthropic beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`). On by default; set `off` to disable. |
| `AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` | Use any OpenAI-compatible endpoint instead (e.g. a local Ollama). Web search is unavailable on this path. |
| `EMBEDDINGS_PROVIDER=openai`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY` | Semantic embeddings for retrieval (256-dim via `dimensions`). **Recommended** — see limitations. |
| `DATABASE_URL` | External PostgreSQL. Needs the `vector` extension. |
| `RESEARCH_WIKIPEDIA`, `RESEARCH_OPENALEX`, `RESEARCH_WEB_SEARCH` | Toggle research source connectors. |
| `ORBITAL_ALLOW_SIGNUP` | Set `false` after creating your account on a shared server. |
| `TRANSCRIPTION_BASE_URL`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL` | Speech-to-text for voice where the browser has none (desktop app, Firefox). Any OpenAI-compatible `/audio/transcriptions` endpoint. |

See `.env.example` for the full list.

### What works without an AI key

Orbital is usable with no AI provider: notes, PDF/Word/Excel/PowerPoint/text import, web clipping, universal search, reminders and nudges, focus mode, project deadlines and progress, dictation (in browsers with speech recognition), folders, tags, collections, `[[wiki links]]`, full-text and vector search, the knowledge graph with similarity-based suggestions, manual memories (including "remember that…" in chat), projects, tasks, milestones, opportunity tracking, the growth dashboard and maintenance. Chat answers honestly list what your knowledge base holds instead of generating text. Research gathers and stores real sources (Wikipedia, OpenAlex) but doesn't synthesize findings. Everything that needs a model says so in the UI — nothing is simulated.

---

## Everyday tools

**Voice** (talk to Orbital, dictate, save any conversation to memory) · **Universal search** across every conversation, note, file, web clip and research report · **File intelligence** for PDFs (including scanned), Word, Excel, PowerPoint and images · **Project tracking** with deadlines, due dates, progress and overdue work · **Smart reminders** you set, plus nudges about overdue tasks, slipping deadlines, stalled projects and unfinished ideas · **Web clipper** (dialog or bookmarklet) · **Learning mode** that teaches from what you already know · **Focus mode** for one objective with a timer, tasks and a scratchpad. What each needs and how it works: [Everyday tools](docs/EVERYDAY.md).

## Front door, waitlist and meetings

Signed-out visitors land on the **waitlist** (`/`), where the Neural Core orbits as a knowledge graph until they join; members sign in at `/login`. Server admins (`ORBITAL_ADMIN_EMAILS`) see and export signups in Settings. Signed in, **Meetings** gives video rooms joined by code, with screen sharing, chat, raise hand and host controls; media flows peer-to-peer. See [Meetings](docs/MEETINGS.md).

## Orbital for business

Every account has a private **personal workspace**; anyone can create **business workspaces** and invite their team by link with a role (owner, admin, member, viewer). Knowledge, memory, research, projects and opportunities are shared within a workspace; each person's conversations stay private. On top of the five engines, a business workspace adds:

- **Operations** — scheduled **briefings**, research **monitors** and an **operations agent** that reviews the workspace against a standing objective and proposes tasks, notes, research and team messages. Internal actions can run automatically; anything leaving Orbital waits in the **approval queue** (editable before sending) unless an admin grants a briefing or monitor standing authorization.
- **Connectors** — signed HTTPS webhooks to Slack, Teams, Zapier, Make, n8n or your own systems, encrypted at rest, SSRF-guarded.
- **Public API** — workspace tokens (`ingest`, `query`) for `POST /api/v1/documents`, `POST /api/v1/memories`, `GET /api/v1/search`, `POST /api/v1/ask`.
- **Business context**, **audit log**, role-aware UI.

The full guide — how it runs a business, who decides what, integration recipes, deployment models, and what's still needed before selling to organisations — is in [Orbital for business](docs/BUSINESS.md).

---

## The five engines

**01 Memory** (`server/engines/memory.ts`) — After each exchange, a background job asks the model for durable facts the *user* stated, each with a verbatim evidence quote. The server checks the quote against the user's actual words: only verified, high-confidence memories are saved automatically; everything else waits in **Knowledge → Review**. Near-duplicates (cosine ≥ 0.92) reinforce the existing memory instead of copying it. Every memory records category, confidence, importance, source conversation and excerpt, reason, correction status, usage, and its graph links. Users can edit (marked *corrected by you*, prioritised in retrieval), archive or delete anything. Extraction can be turned off in Settings.

**02 Connections** (`server/engines/graph.ts`) — Notes, documents, memories, findings, research, projects and opportunities are graph nodes with embeddings. New nodes get candidate links by vector similarity; with a model, candidates are classified into `related_to / supports / contradicts / derived_from / explains / expands_upon / similar_to / depends_on`. All AI or similarity links stay **suggested** (dashed) until confirmed. `[[Title]]` links and manual connections are confirmed. Contradictions and duplicates surface in maintenance.

**03 Research** (`server/engines/research.ts`, `server/research/sources.ts`) — A durable background workflow: understand → decompose into sub-questions → search (Claude web search with citations, Wikipedia, OpenAlex scholarly abstracts) → store numbered sources with the retrieved text → synthesize with structured output → **server-side verification** → connect to the graph and open knowledge gaps. Verification removes citations to sources that weren't retrieved, downgrades "verified" claims without real citations to *inference*, and **drops any statistic whose figure doesn't appear in the cited source's text**. Findings are labelled verified / inference / speculation. Progress streams live to the UI and the Neural Core.

**04 Reasoning** (`server/engines/retrieval.ts`, `server/engines/chat.ts`) — Hybrid retrieval (pgvector cosine + Postgres full-text rank + importance) over memories, nodes and document chunks, plus one hop across *confirmed* graph relationships, the active project's goals and open tasks, and — in deep modes — open questions. Context is labelled `[M1] [K2] [C1] [D3]`, framed as untrusted data, and cited inline; the context panel shows exactly what informed each answer. Five modes run different workflows:

| Mode | Workflow |
|---|---|
| Standard | Light retrieval, medium effort. |
| Deep Research | Launches the research workflow; the report posts back into the conversation. |
| Deep Thinking | Deep retrieval + graph expansion + open questions, high effort, explicit reasoning/assumptions/uncertainty; detects new knowledge gaps. |
| Opportunity | Deep retrieval, opportunity lens grounded in the user's context. |
| Learning | Explains from what the user already knows, learning path, comprehension checks; detects gaps. |

**05 Opportunities** (`server/engines/opportunity.ts`) — Discovery analyses goals/skills/interests memories, knowledge clusters, completed research sources and *the user's feedback on past suggestions*, and proposes at most three opportunities. Each must cite real memories (ungrounded ones are discarded); market evidence links only to retrieved sources. **Validate** runs demand-and-competitor research and absorbs its cited sources as evidence; **Create execution plan** (user-initiated) builds a project with milestones and tasks; status, outcome notes and ratings track results. No revenue figures; investment ideas are labelled research, not advice.

### Growth system
`server/engines/growth.ts` reports live counts only — and separates volume (nodes, connections, memories, research, clusters) from **meaningful growth**: verified findings, user-confirmed insights, memory retrievals and helpful retrievals (answers that used memories and were rated helpful), corrected memories, resolved gaps, opportunities acted on. A 12-week timeline, growing subjects, and maintenance (duplicates, contradictions, outdated and unused knowledge, open questions) — each with an approve/act control.

---

## The Neural Core

`src/neural/` — Three.js via React Three Fiber, custom GLSL, one `BufferGeometry` of ~70–90k points (density adapts).

- **Anatomy, not an image.** `geometry.ts` builds the point cloud procedurally: a right-facing side-profile silhouette (forehead, brow, nose, lips, chin, jaw, neck, shoulders) swept into 3D with an anatomical width profile; ear and eye landmarks; a brain from cerebrum + temporal lobes (gyri via noise-ridge density and radial displacement, longitudinal fissure), striated cerebellum and brainstem; sparse interior volume and ambient dust for depth. Colour flows around the brain across the full spectrum with noise mixing; the head stays cool white and sparse.
- **Motion** (`shaders.ts`): per-particle organic drift; cursor repulsion with a gentle attraction ring and smoothed reorganisation; click ripples; subtle parallax. Points are soft round discs, additive, depth-dimmed — no lines.
- **States driven by real work** (`state/core.ts`, `state/events.ts`): *thinking* while a response streams; *researching* while a research job runs (activity travels region to region); *learning* when nodes/memories are created (reserve particles emerge and regions densify); *connecting* when relationships are suggested (beads flow between clusters); *opportunity detected* when discovery finds something (a pulse crosses the brain, frontal regions stay lit).
- **Growth**: 16k reserve particles are revealed per region as knowledge accumulates — memories grow the temporal lobe, research the occipital, notes the frontal, concepts the parietal, projects/opportunities the prefrontal, connections the cerebellum.
- **Performance & accessibility**: density by hardware and a frame-time check that steps density down; DPR clamp; resources disposed on unmount; WebGL context-loss handling; Canvas 2D fallback; reduced-motion (system or Settings) freezes motion while keeping state brightness.

---

## Security & privacy

- Email + password (scrypt), opaque session tokens stored hashed, `HttpOnly` / `SameSite=Lax` / `Secure` cookies.
- CSRF: every state-changing request must carry `X-Orbital-Request: 1` (cross-origin pages can't set it without a CORS preflight, which is never granted).
- Every table carries `user_id`; every query filters on it. Tests assert another user can't read, modify, search, retrieve or connect to someone else's data.
- Rate limits on auth, chat, uploads, research and discovery. Input validation with Zod on every route. Uploads: size-limited, type-checked (PDF magic bytes, binary detection), parsed server-side, never executed.
- Retrieved context, documents, attachments and web sources are wrapped as untrusted data; prompts instruct the model to ignore instructions inside them. Markdown rendering drops images and unsafe link schemes.
- Orbital takes no external actions (messages, purchases, code execution, investing). Creating a project from an opportunity happens only on explicit click.
- Export all data (JSON) and delete the account from Settings.

---

## Keyboard

`⌘K / Ctrl K` command palette (search everything, navigate, start research, create notes/projects) · `⌥N` new conversation · `⌘\` sidebar · `⌘.` context panel · `/` focus composer · `g` then `n r k g p t f o m w c s` to jump between sections (`t` reminders, `f` focus) · Space pauses focus mode and interrupts a spoken answer.

---

## Known limitations

- **Local embeddings are lexical.** The default embedding is a private, offline hashed-feature model: it matches shared words and word stems, not meaning (e.g. "salon scheduling" won't strongly match "software for local companies"). For good semantic retrieval, set `EMBEDDINGS_PROVIDER=openai` with any OpenAI-compatible embeddings endpoint. Mixed-model vectors are never compared; re-save content after switching to re-embed it.
- **Live web research requires the Anthropic provider.** Other providers use Wikipedia and OpenAlex only.
- **Single-node background jobs and rate limits** (durable job table, in-process worker). Scale-out needs a shared queue/limiter.
- **The anatomical model is procedural**, sculpted from proportional landmarks rather than sampled from a licensed 3D scan. `geometry.ts` isolates this: swap in samples from an anatomical mesh (e.g. via surface/volume sampling of a GLB) without touching the renderer.
- Scanned (image-only) PDFs and images are read only with an AI provider (Claude reads both; OpenAI-compatible providers read images).
- Voice input needs a browser with speech recognition or a configured transcription service; spoken answers use the operating system's voices.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): read before changing the server, engines, data model or AI provider layer.
- [Orbital for business](docs/BUSINESS.md): read when deploying Orbital for a company or integrating it with other tools.
- [Desktop app](docs/DESKTOP.md): read when building, signing or distributing the macOS, Windows and Linux apps.
- [Everyday tools](docs/EVERYDAY.md): read to learn what voice, search, file import, reminders, the web clipper, learning and focus mode do and what each needs.
- [Meetings](docs/MEETINGS.md): read before running video meetings for others, especially on strict networks (TURN relay).
