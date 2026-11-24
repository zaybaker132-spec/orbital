-- Orbital Pro on the desktop app: one row per install. trial_started_at begins the 14-day trial;
-- the license key (from the license service) and what it last said are kept so Pro keeps working
-- offline until valid_until.
CREATE TABLE app_license (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  license_key text CHECK (license_key IS NULL OR length(license_key) <= 200),
  license_plan text CHECK (license_plan IS NULL OR license_plan IN ('monthly', 'yearly')),
  license_email text,
  license_status text,
  renews_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- Pro stays on until here without needing to check again (the paid-for period plus a few days).
  valid_until timestamptz,
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
