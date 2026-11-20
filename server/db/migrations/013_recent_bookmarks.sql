-- Recently viewed items and personal favorites (bookmarks), per person and workspace.
-- `ref` is the item's id (uuid) for items, or an app path for pages. Titles of items are looked up when
-- listed (so renames show and deleted items drop off); a page keeps the title it was saved with.

CREATE TABLE recent_items (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('document', 'paper', 'conversation', 'project', 'research')),
  ref text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, kind, ref)
);
CREATE INDEX recent_items_user_idx ON recent_items(user_id, workspace_id, viewed_at DESC);

CREATE TABLE bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('document', 'paper', 'conversation', 'project', 'research', 'page')),
  ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 300),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  -- Your own name for it (optional); otherwise the item's current title.
  label text NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, kind, ref)
);
CREATE INDEX bookmarks_user_idx ON bookmarks(user_id, workspace_id, position);
