-- Multi-tenant workspaces. Data ownership moves from users to workspaces.
-- Every existing user gets a personal workspace whose id equals their user id, so existing rows map 1:1.

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'business' CHECK (kind IN ('personal','business')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user_idx ON workspace_members(user_id);

INSERT INTO workspaces(id, name, kind, created_by) SELECT id, 'Personal', 'personal', id FROM users;
INSERT INTO workspace_members(workspace_id, user_id, role) SELECT id, id, 'owner' FROM users;

ALTER TABLE projects DROP CONSTRAINT projects_user_id_fkey;
ALTER TABLE projects RENAME COLUMN user_id TO workspace_id;
ALTER TABLE projects ADD CONSTRAINT projects_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE conversations DROP CONSTRAINT conversations_user_id_fkey;
ALTER TABLE conversations RENAME COLUMN user_id TO workspace_id;
ALTER TABLE conversations ADD CONSTRAINT conversations_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE messages DROP CONSTRAINT messages_user_id_fkey;
ALTER TABLE messages RENAME COLUMN user_id TO workspace_id;
ALTER TABLE messages ADD CONSTRAINT messages_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE knowledge_nodes DROP CONSTRAINT knowledge_nodes_user_id_fkey;
ALTER TABLE knowledge_nodes RENAME COLUMN user_id TO workspace_id;
ALTER TABLE knowledge_nodes ADD CONSTRAINT knowledge_nodes_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE knowledge_edges DROP CONSTRAINT knowledge_edges_user_id_fkey;
ALTER TABLE knowledge_edges RENAME COLUMN user_id TO workspace_id;
ALTER TABLE knowledge_edges ADD CONSTRAINT knowledge_edges_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE memories DROP CONSTRAINT memories_user_id_fkey;
ALTER TABLE memories RENAME COLUMN user_id TO workspace_id;
ALTER TABLE memories ADD CONSTRAINT memories_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE folders DROP CONSTRAINT folders_user_id_fkey;
ALTER TABLE folders RENAME COLUMN user_id TO workspace_id;
ALTER TABLE folders ADD CONSTRAINT folders_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE collections DROP CONSTRAINT collections_user_id_fkey;
ALTER TABLE collections RENAME COLUMN user_id TO workspace_id;
ALTER TABLE collections ADD CONSTRAINT collections_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE documents DROP CONSTRAINT documents_user_id_fkey;
ALTER TABLE documents RENAME COLUMN user_id TO workspace_id;
ALTER TABLE documents ADD CONSTRAINT documents_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE document_chunks DROP CONSTRAINT document_chunks_user_id_fkey;
ALTER TABLE document_chunks RENAME COLUMN user_id TO workspace_id;
ALTER TABLE document_chunks ADD CONSTRAINT document_chunks_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE research_sessions DROP CONSTRAINT research_sessions_user_id_fkey;
ALTER TABLE research_sessions RENAME COLUMN user_id TO workspace_id;
ALTER TABLE research_sessions ADD CONSTRAINT research_sessions_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE research_sources DROP CONSTRAINT research_sources_user_id_fkey;
ALTER TABLE research_sources RENAME COLUMN user_id TO workspace_id;
ALTER TABLE research_sources ADD CONSTRAINT research_sources_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE project_links DROP CONSTRAINT project_links_user_id_fkey;
ALTER TABLE project_links RENAME COLUMN user_id TO workspace_id;
ALTER TABLE project_links ADD CONSTRAINT project_links_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE milestones DROP CONSTRAINT milestones_user_id_fkey;
ALTER TABLE milestones RENAME COLUMN user_id TO workspace_id;
ALTER TABLE milestones ADD CONSTRAINT milestones_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tasks DROP CONSTRAINT tasks_user_id_fkey;
ALTER TABLE tasks RENAME COLUMN user_id TO workspace_id;
ALTER TABLE tasks ADD CONSTRAINT tasks_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE opportunities DROP CONSTRAINT opportunities_user_id_fkey;
ALTER TABLE opportunities RENAME COLUMN user_id TO workspace_id;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE feedback DROP CONSTRAINT feedback_user_id_fkey;
ALTER TABLE feedback RENAME COLUMN user_id TO workspace_id;
ALTER TABLE feedback ADD CONSTRAINT feedback_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE knowledge_gaps DROP CONSTRAINT knowledge_gaps_user_id_fkey;
ALTER TABLE knowledge_gaps RENAME COLUMN user_id TO workspace_id;
ALTER TABLE knowledge_gaps ADD CONSTRAINT knowledge_gaps_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE activity_events DROP CONSTRAINT activity_events_user_id_fkey;
ALTER TABLE activity_events RENAME COLUMN user_id TO workspace_id;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE jobs DROP CONSTRAINT jobs_user_id_fkey;
ALTER TABLE jobs RENAME COLUMN user_id TO workspace_id;
ALTER TABLE jobs ADD CONSTRAINT jobs_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- Who did it (attribution inside shared workspaces). Existing rows: the personal owner.
ALTER TABLE conversations ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE CASCADE;
UPDATE conversations SET created_by = workspace_id;
CREATE INDEX conversations_creator_idx ON conversations(workspace_id, created_by, updated_at DESC);
ALTER TABLE feedback ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE CASCADE;
UPDATE feedback SET created_by = workspace_id;
ALTER TABLE activity_events ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE memories ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','member','viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_ws_idx ON workspace_invites(workspace_id);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tokens_ws_idx ON api_tokens(workspace_id);

CREATE TABLE connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('webhook')),
  name text NOT NULL,
  config_encrypted text NOT NULL,
  config_hint text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connectors_ws_idx ON connectors(workspace_id);

CREATE TABLE automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('briefing','monitor','operator')),
  schedule jsonb NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_due_idx ON automations(enabled, next_run_at);
CREATE INDEX automations_ws_idx ON automations(workspace_id);

CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id uuid REFERENCES automations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('create_task','create_note','start_research','send_message')),
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text NOT NULL DEFAULT '',
  risk text NOT NULL CHECK (risk IN ('internal','external')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executed','failed')),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actions_ws_idx ON actions(workspace_id, status, created_at DESC);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label text NOT NULL DEFAULT '',
  action text NOT NULL,
  target_type text,
  target_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ws_idx ON audit_log(workspace_id, created_at DESC);
