-- Value constraints for operational tables added in 010. NOT VALID: enforced for every new or updated row,
-- without re-checking (or ever touching) rows that already exist, so this can't fail on production data.
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed')) NOT VALID;
ALTER TABLE jobs ADD CONSTRAINT jobs_attempts_check CHECK (attempts >= 0) NOT VALID;
ALTER TABLE email_log ADD CONSTRAINT email_log_status_check CHECK (status IN ('sent', 'failed', 'skipped')) NOT VALID;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_tokens_check CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0 AND cost_micro_usd >= 0) NOT VALID;
ALTER TABLE password_resets ADD CONSTRAINT password_resets_expiry_check CHECK (expires_at > created_at) NOT VALID;
ALTER TABLE waitlist ADD CONSTRAINT waitlist_email_check CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1) NOT VALID;
ALTER TABLE users ADD CONSTRAINT users_email_normalized_check CHECK (email = lower(btrim(email))) NOT VALID;
