-- Files, reminders, focus sessions and project deadlines.

-- Original bytes of uploaded images (so the Knowledge page can show them). Text-bearing files
-- (PDF, Word, Excel...) keep only their extracted text in documents.body.
CREATE TABLE document_files (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL
);

ALTER TABLE projects ADD COLUMN deadline date;

-- Reminders are personal: each belongs to the person who set it, inside a workspace.
CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  item_type text CHECK (item_type IN ('task','document','project','opportunity','gap','conversation')),
  item_id uuid,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','fired','done','dismissed')),
  fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders(status, due_at);
CREATE INDEX reminders_user_idx ON reminders(workspace_id, user_id, status, due_at);

-- Smart suggestions a person snoozed or dismissed (until = NULL means for good).
CREATE TABLE nudge_dismissals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nudge_key text NOT NULL,
  until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, nudge_key)
);

CREATE TABLE focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  planned_minutes integer NOT NULL DEFAULT 50,
  focused_seconds integer NOT NULL DEFAULT 0,
  tasks_completed integer NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX focus_sessions_user_idx ON focus_sessions(workspace_id, user_id, started_at DESC);

-- "Save to memory" keeps one transcript note per conversation, updated on each save.
ALTER TABLE conversations ADD COLUMN saved_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
