---
title: Orbital for business
date: 2026-11-18
tags: [business, operations, deployment]
---

# Orbital for business

How Orbital runs inside a company, what it does on its own, where people stay in control, how it plugs into the tools a business already uses, and what remains before selling it to organisations.

## What a business gets

A **business workspace** is a shared brain for a team. Everything that makes Orbital useful to one person — memory, connected knowledge, cited research, projects, opportunities — becomes shared, and it starts doing work on a schedule.

| Capability | What it means in practice |
|---|---|
| Shared knowledge | Notes, documents, research and projects are visible to the whole team and feed every answer. New hires ask Orbital instead of interrupting people. |
| Organisational memory | Memory extraction records facts about the *business* (customers, decisions, pricing, processes), not personal traits. Facts arriving from other systems wait for review. |
| Business context | Admins describe the business once (what you sell, to whom, priorities, tone). It frames every answer and every automation. |
| Private conversations | Each person's conversations stay theirs; only what they save becomes shared knowledge. |
| Roles | Owner, admin, member, viewer. Viewers can read and ask but never change shared knowledge — useful for contractors, advisors, investors. |
| Automations | Briefings, monitors and an operations agent run on the server on schedule, in the business's time zone. |
| Approvals | Anything that leaves Orbital waits for an admin, who can edit it before it's sent. |
| Connectors | Signed webhooks into Slack, Teams, Zapier, Make, n8n or your own systems. |
| API | Workspace tokens let a CRM, help desk or form tool push knowledge in and ask grounded questions out. |
| Audit log | Every consequential change: who, what, when, under whose authority. |

## How Orbital "runs it for them"

Three automation types, each a real server-side job:

- **Briefing** — every morning (or week) Orbital compiles what changed: new knowledge, research completed, tasks done and due, open questions, opportunities that moved, approvals waiting. With AI it writes a prioritised summary; without, it compiles the facts. Saved to knowledge and optionally delivered to the team channel.
- **Monitor** — recurring cited research on a market, competitor or topic. Findings join the knowledge graph; the summary can be delivered when the run finishes.
- **Operations agent** — given a standing objective ("keep the booking rollout on track and make sure no customer request goes unanswered"), it reads projects, open tasks, recent activity, open questions and relevant knowledge, then proposes at most five concrete actions: create a task in a specific project, write a note, start research, or message the team.

### Who decides

| Action | Default | Can be automated? |
|---|---|---|
| Create task, write note, start research (internal) | Proposed for approval | Yes — per operations agent, by an admin ("carry out internal actions automatically") |
| Briefing / monitor delivery to a connector | Proposed for approval | Yes — an admin can grant *standing authorization* for that automation and connector; it's recorded under their name |
| Message proposed by the operations agent | Always proposed | **No** — always human-approved |
| Anything else external (email, payments, purchases, code) | Not possible | Not built, by design |

Whoever last edits an automation becomes the admin under whose authority it runs; the audit log records `via: auto` or `via: standing` for every automatic execution.

## Plugging into a business's tools

**Outbound (connectors).** Each connector is an HTTPS webhook. Payload:

```json
{ "text": "*Title*\nBody…", "title": "…", "body": "…", "workspace": "Acme Salons", "source": "orbital", "action_id": "…" }
```

`text` is what Slack and Teams incoming webhooks read; Zapier/Make/n8n can route `title`/`body` anywhere (email, CRM notes, tickets). Set a secret and every request carries `X-Orbital-Signature: sha256=<HMAC of the raw body>`. URLs are encrypted at rest (AES-256-GCM), never shown again after saving, and requests to private network addresses are refused unless the operator enables `ORBITAL_ALLOW_PRIVATE_WEBHOOKS` (desktop installs allow them).

**Inbound (API).** Admins create tokens under *Team → API & integrations* with scopes:

| Endpoint | Scope | Use |
|---|---|---|
| `POST /api/v1/documents` | ingest | Call notes, tickets, meeting transcripts, SOPs |
| `POST /api/v1/memories` | ingest | Proposed facts (wait for review) |
| `GET /api/v1/search?q=` | query | Find knowledge from another tool |
| `POST /api/v1/ask` | query | Grounded answer + the context used (e.g. a support macro, an internal bot) |

Tokens are stored hashed, shown once, rate-limited per token, revocable, and see only their own workspace.

**Example recipes**
- *CRM → Orbital*: Zapier "new note in HubSpot" → `POST /documents`. Orbital's answers and the operations agent now know every customer conversation.
- *Orbital → team*: daily briefing → `#ops` with standing authorization.
- *Support*: help desk macro calls `/ask` with the ticket text to draft a grounded reply for an agent to edit.
- *Competitive intelligence*: weekly monitor on competitors → findings in the graph, summary to `#leadership` after approval.

## Where leverage comes from

1. **Compounding context.** Every call note, decision and research run makes the next answer better for everyone — knowledge stops leaving with people.
2. **Work that happens without anyone starting it.** Briefings and monitors replace recurring manual status-gathering and desk research.
3. **One brain, many surfaces.** The same grounded knowledge answers in the app, in Slack (via connectors), and in other tools (via the API).
4. **Controlled autonomy.** Internal busywork can run automatically; external communication stays human-approved. The audit log makes it defensible.
5. **Opportunities with evidence.** The Opportunity Engine works on the team's shared knowledge, so ideas are grounded in what the business actually knows and validated with cited research.

## Deployment models

| Model | Who runs it | Data location | Best for |
|---|---|---|---|
| **Desktop app** | Each person | That computer (embedded Postgres) | Individuals, solo founders, privacy-first users |
| **Self-hosted** | The business's IT | Their server/VPC, their PostgreSQL | Companies with data-control requirements |
| **Hosted service** | You, as the vendor | Your infrastructure, tenant-isolated by workspace | Selling Orbital to many small businesses |

Self-hosted / hosted production checklist: PostgreSQL 15+ with `pgvector` (`DATABASE_URL`), HTTPS in front (cookies become `Secure`), `ORBITAL_SECRET_KEY`, `ORBITAL_PUBLIC_URL`, `ORBITAL_ALLOW_SIGNUP=false` after the first owner signs up, `ANTHROPIC_API_KEY`, recommended semantic embeddings (`EMBEDDINGS_PROVIDER=openai`), database backups that include the secret key.

## Security model (summary)

- Every data row belongs to a workspace; every query filters on it; membership is checked on every request. Tests cover cross-workspace and cross-user isolation, role enforcement, private conversations, token scoping and revocation.
- Roles are enforced on the server; the UI only hides what the server would refuse.
- Invite links are single-use, email-bound and expire in 7 days; only hashes are stored.
- Workspace knowledge, documents and web sources are treated as untrusted data in every prompt.
- No external action exists that can't be seen, approved and audited.

## Before selling to organisations — not yet built

Be clear-eyed about these; they're the usual blockers in procurement:

- **SSO (SAML/OIDC) and SCIM provisioning.** Today: email + password.
- **Email delivery** for invites and digests (today: share the invite link; deliver digests via a connector).
- **Billing and plan limits** (Stripe, seats, usage metering per workspace).
- **Per-workspace AI keys and usage reporting** (today: one server-wide provider key).
- **Horizontal scale.** The job queue, scheduler and rate limits are single-node. Multiple app servers need a shared queue (e.g. Postgres `SKIP LOCKED` workers or Redis) and a shared limiter.
- **Compliance.** SOC 2 / ISO 27001 controls, DPA, data-retention policies, regional hosting.
- **More connectors** (native Slack app, Google Drive/Notion/Gmail ingestion) — today: webhooks out, API in.

Related: [Architecture](ARCHITECTURE.md) describes the engines these features build on · [Desktop packaging](DESKTOP.md) covers the per-person deployment · Up: [README](../README.md)
