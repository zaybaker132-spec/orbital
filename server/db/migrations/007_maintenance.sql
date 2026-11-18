-- Automatic knowledge maintenance: suggestions are stored so decisions stick, and every applied
-- change keeps what it needs to be undone.
CREATE TABLE maintenance_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- duplicate_notes | duplicate_memories | conflicting_memories | outdated | disconnected | broken_link
  kind text NOT NULL,
  -- Stable identity of the issue (kind + the items involved), so a dismissed issue never comes back.
  fingerprint text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity integer NOT NULL DEFAULT 1,
  ai boolean NOT NULL DEFAULT false,
  -- open | applied | dismissed | snoozed | resolved (fixed some other way) | ignored (checked: not an issue)
  status text NOT NULL DEFAULT 'open',
  snoozed_until timestamptz,
  resolution text NOT NULL DEFAULT '',
  undo jsonb,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (workspace_id, fingerprint)
);
CREATE INDEX maintenance_open_idx ON maintenance_suggestions(workspace_id, status, severity DESC);

CREATE TABLE maintenance_runs (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- "Still true": a reviewed memory isn't flagged as outdated again for a while.
ALTER TABLE memories ADD COLUMN reviewed_at timestamptz;
