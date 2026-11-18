-- ORBITAL core schema. Every user-owned table carries user_id and every query filters on it.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  goals text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects(user_id, updated_at DESC);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'New conversation',
  mode text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON conversations(user_id, updated_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  mode text NOT NULL DEFAULT 'standard',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX messages_conv_idx ON messages(conversation_id, created_at);
CREATE INDEX messages_user_idx ON messages(user_id);
CREATE INDEX messages_tsv_idx ON messages USING gin(tsv);

CREATE TABLE knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  ref_type text,
  ref_id uuid,
  embedding vector(256),
  embedding_model text,
  access_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || summary)) STORED
);
CREATE INDEX nodes_user_idx ON knowledge_nodes(user_id, kind);
CREATE UNIQUE INDEX nodes_ref_idx ON knowledge_nodes(user_id, ref_type, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX nodes_tsv_idx ON knowledge_nodes USING gin(tsv);

CREATE TABLE knowledge_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation text NOT NULL,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','rejected')),
  origin text NOT NULL DEFAULT 'ai',
  confidence real NOT NULL DEFAULT 0.5,
  rationale text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK (source_id <> target_id)
);
CREATE UNIQUE INDEX edges_unique_idx ON knowledge_edges(user_id, source_id, target_id, relation);
CREATE INDEX edges_user_status_idx ON knowledge_edges(user_id, status);
CREATE INDEX edges_target_idx ON knowledge_edges(target_id);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  category text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  importance real NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','rejected','archived')),
  origin text NOT NULL DEFAULT 'user',
  reason text NOT NULL DEFAULT '',
  source_type text,
  source_id uuid,
  source_excerpt text NOT NULL DEFAULT '',
  user_corrected boolean NOT NULL DEFAULT false,
  corrected_at timestamptz,
  embedding vector(256),
  embedding_model text,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX memories_user_idx ON memories(user_id, status);
CREATE INDEX memories_tsv_idx ON memories USING gin(tsv);

CREATE TABLE folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES folders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folders_user_idx ON folders(user_id);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_user_idx ON collections(user_id);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled',
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'note',
  tags text[] NOT NULL DEFAULT '{}',
  source_url text,
  file_name text,
  mime_type text,
  ai_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED
);
CREATE INDEX documents_user_idx ON documents(user_id, updated_at DESC);
CREATE INDEX documents_tsv_idx ON documents USING gin(tsv);
CREATE INDEX documents_tags_idx ON documents USING gin(tags);

CREATE TABLE collection_documents (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, document_id)
);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  content text NOT NULL,
  embedding vector(256),
  embedding_model text
);
CREATE INDEX chunks_user_idx ON document_chunks(user_id);
CREATE INDEX chunks_doc_idx ON document_chunks(document_id);

CREATE TABLE research_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  report jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX research_user_idx ON research_sessions(user_id, created_at DESC);

CREATE TABLE research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_id uuid NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_number integer NOT NULL,
  provider text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  authors text NOT NULL DEFAULT '',
  published text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'web',
  excerpt text NOT NULL DEFAULT '',
  subquestion text NOT NULL DEFAULT '',
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_research_idx ON research_sources(research_id, ref_number);

CREATE TABLE project_links (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, item_type, item_id)
);

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  target_date date,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milestones_project_idx ON milestones(project_id);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES milestones(id) ON DELETE SET NULL,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  due_date date,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX tasks_project_idx ON tasks(project_id, sort);
CREATE INDEX tasks_user_idx ON tasks(user_id);

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  explanation text NOT NULL DEFAULT '',
  why_identified text NOT NULL DEFAULT '',
  area text NOT NULL DEFAULT '',
  memory_ids uuid[] NOT NULL DEFAULT '{}',
  node_ids uuid[] NOT NULL DEFAULT '{}',
  research_id uuid REFERENCES research_sessions(id) ON DELETE SET NULL,
  market_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_model text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'unknown',
  resources text NOT NULL DEFAULT '',
  risks text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  uncertainty text NOT NULL DEFAULT '',
  is_investment boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'identified',
  outcome_notes text NOT NULL DEFAULT '',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_user_idx ON opportunities(user_id, updated_at DESC);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  rating smallint NOT NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user_idx ON feedback(user_id, target_type);

CREATE TABLE knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question text NOT NULL,
  origin text NOT NULL DEFAULT '',
  origin_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX gaps_user_idx ON knowledge_gaps(user_id, status);

CREATE TABLE activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  ref_type text,
  ref_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_user_idx ON activity_events(user_id, created_at DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_status_idx ON jobs(status, created_at);
