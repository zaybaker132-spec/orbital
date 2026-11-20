-- Media library: screenshots, screen recordings, voice and camera recordings, meeting recordings and
-- uploaded images, video and audio. Files are stored in 1 MiB pieces (media_chunks) so large videos stream
-- with seeking (HTTP ranges) without loading whole files into memory, on PGlite and Postgres alike.

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('screenshot', 'screen_recording', 'voice', 'recording', 'meeting', 'upload')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  mime text NOT NULL CHECK (mime ~ '^(image|video|audio)/[a-z0-9.+-]+$'),
  size bigint NOT NULL DEFAULT 0 CHECK (size >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  width integer, height integer,
  -- complete = every piece arrived; an upload that stopped half-way is removed by housekeeping.
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'complete')),
  thumbnail bytea,
  transcript text NOT NULL DEFAULT '',
  meeting_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_ws_idx ON media(workspace_id, created_at DESC);
CREATE INDEX media_created_by_idx ON media(created_by);

CREATE TABLE media_chunks (
  media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  data bytea NOT NULL,
  PRIMARY KEY (media_id, seq)
);
