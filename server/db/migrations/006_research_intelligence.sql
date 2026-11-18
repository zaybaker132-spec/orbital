-- Research intelligence: source assessments, research modes, hypotheses, living reports, knowledge extraction.

-- standard | contradiction (contradiction lab) | hypothesis (testing a hypothesis)
ALTER TABLE research_sessions ADD COLUMN kind text NOT NULL DEFAULT 'standard';
ALTER TABLE research_sessions ADD COLUMN hypothesis_id uuid;
-- Living reports: when sections were last refreshed, and the latest freshness check.
ALTER TABLE research_sessions ADD COLUMN refreshed_at timestamptz;
ALTER TABLE research_sessions ADD COLUMN freshness jsonb;
ALTER TABLE research_sessions ADD COLUMN freshness_checked_at timestamptz;

-- Source intelligence (credibility breakdown) and, in the lab and hypothesis tests, which side a source was gathered for.
ALTER TABLE research_sources ADD COLUMN assessment jsonb;
ALTER TABLE research_sources ADD COLUMN position text NOT NULL DEFAULT '';

CREATE TABLE hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  statement text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  -- untested | testing | supported | contested | refuted | insufficient
  status text NOT NULL DEFAULT 'untested',
  confidence real,
  verdict jsonb,
  last_research_id uuid REFERENCES research_sessions(id) ON DELETE SET NULL,
  tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hypotheses_ws_idx ON hypotheses(workspace_id, updated_at DESC);
ALTER TABLE research_sessions ADD CONSTRAINT research_hypothesis_fkey FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id) ON DELETE SET NULL;

-- Knowledge extraction from long documents.
CREATE TABLE extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- ai | basic (no AI provider: dates, figures and key terms only)
  mode text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'queued',
  parts_total integer NOT NULL DEFAULT 0,
  parts_done integer NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX extractions_doc_idx ON extractions(document_id, created_at DESC);

CREATE TABLE extracted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- concept | evidence | event | relation
  kind text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  quote text NOT NULL DEFAULT '',
  -- evidence: fact | statistic | argument | finding; relation: the verb
  subtype text NOT NULL DEFAULT '',
  date_text text NOT NULL DEFAULT '',
  sort_date text NOT NULL DEFAULT '',
  part integer NOT NULL DEFAULT 0,
  mentions integer NOT NULL DEFAULT 1,
  verified boolean NOT NULL DEFAULT false,
  node_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || detail || ' ' || quote)) STORED
);
CREATE INDEX extracted_items_doc_idx ON extracted_items(document_id, kind);
CREATE INDEX extracted_items_ws_idx ON extracted_items(workspace_id, kind);
CREATE INDEX extracted_items_tsv_idx ON extracted_items USING gin(tsv);

-- Reminders can point at a research report (e.g. "refresh this").
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_item_type_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_item_type_check CHECK (item_type IN ('task','document','project','opportunity','gap','conversation','research'));
