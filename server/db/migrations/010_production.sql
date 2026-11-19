-- Production readiness: AI usage and cost, security events, password reset, email delivery log,
-- waitlist consent / confirmation / unsubscribe.

-- Every AI request: who it was for, what it cost. Tokens come from the provider's own usage report.
CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  feature text NOT NULL DEFAULT '',
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  -- Estimated cost in millionths of a US dollar (list price for the model; see server/lib/usage.ts).
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_ws_idx ON ai_usage(workspace_id, created_at);
CREATE INDEX ai_usage_created_idx ON ai_usage(created_at);

-- Sign-ins, failed sign-ins, password changes and resets, account deletion. No passwords, no raw IPs.
CREATE TABLE auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- sha256 of the normalized email: lets failed sign-ins be throttled per account without storing addresses.
  email_hash text NOT NULL DEFAULT '',
  event text NOT NULL,
  ip_hash text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user_idx ON auth_events(user_id, created_at);
CREATE INDEX auth_events_email_idx ON auth_events(email_hash, event, created_at);

-- One-time password reset links (only the hash of the token is stored).
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);

-- What was emailed and whether the provider accepted it. Recipients are stored hashed.
CREATE TABLE email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  to_hash text NOT NULL,
  -- sent (provider accepted it) | failed (provider refused or unreachable) | skipped (email not configured / unsubscribed)
  status text NOT NULL,
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx ON email_log(created_at);

-- Waitlist: explicit consent, confirmed address, and a one-click unsubscribe.
ALTER TABLE waitlist ADD COLUMN consent_at timestamptz;
ALTER TABLE waitlist ADD COLUMN consent_text text NOT NULL DEFAULT '';
ALTER TABLE waitlist ADD COLUMN confirmed_at timestamptz;
ALTER TABLE waitlist ADD COLUMN token text;
ALTER TABLE waitlist ADD COLUMN unsubscribed_at timestamptz;
CREATE UNIQUE INDEX waitlist_token_idx ON waitlist(token);

-- Background jobs: retries wait (backoff) instead of running again immediately.
ALTER TABLE jobs ADD COLUMN run_after timestamptz;
