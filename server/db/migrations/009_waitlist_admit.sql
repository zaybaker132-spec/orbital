-- Invite-only launch: a server admin lets waitlist people in; they can then create an account with that email.
ALTER TABLE waitlist ADD COLUMN admitted_at timestamptz;
