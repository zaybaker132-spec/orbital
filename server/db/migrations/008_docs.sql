-- Docs: full documents written in Orbital, edited together in real time.
-- A doc is a row in `documents` (kind = 'doc') so it is searchable, feeds answers and joins the
-- knowledge graph like any note. `body` keeps the plain text (for search and AI); the formatted
-- content lives in `html` and the live, mergeable editing state in `ydoc` (a Yjs document).
ALTER TABLE documents ADD COLUMN html text;
ALTER TABLE documents ADD COLUMN ydoc bytea;
ALTER TABLE documents ADD COLUMN page jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE documents ADD COLUMN words integer NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN starred_by uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX documents_kind_idx ON documents(workspace_id, kind, updated_at DESC);

-- Version history: saved automatically while people write, or named by hand.
CREATE TABLE doc_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  html text NOT NULL,
  body text NOT NULL,
  words integer NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_versions_doc_idx ON doc_versions(document_id, created_at DESC);

-- Comments anchored to a passage (the passage carries a comment mark with the thread id).
CREATE TABLE doc_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  quote text NOT NULL DEFAULT '',
  body text NOT NULL,
  author uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_comments_doc_idx ON doc_comments(document_id, created_at);
