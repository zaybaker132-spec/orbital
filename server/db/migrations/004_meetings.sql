-- Video meetings. Media flows peer-to-peer (WebRTC); the server stores rooms and relays signalling.
CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX meetings_host_idx ON meetings(host_id, created_at DESC);

CREATE TABLE meeting_participants (
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE INDEX meeting_participants_user_idx ON meeting_participants(user_id, last_seen_at DESC);
