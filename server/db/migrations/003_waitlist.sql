-- Public waitlist. Server-wide (not tied to a workspace); readable only by server admins (ORBITAL_ADMIN_EMAILS).
CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  persona text NOT NULL,
  remember text[] NOT NULL DEFAULT '{}',
  remember_other text NOT NULL DEFAULT '',
  scale text NOT NULL DEFAULT '',
  ai_tools text[] NOT NULL DEFAULT '{}',
  notes_apps text[] NOT NULL DEFAULT '{}',
  computers text[] NOT NULL DEFAULT '{}',
  devices text[] NOT NULL DEFAULT '{}',
  heard_from text NOT NULL DEFAULT '',
  discord text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  tiktok text NOT NULL DEFAULT '',
  compound text NOT NULL DEFAULT '',
  ip_hash text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_created_idx ON waitlist(created_at);
