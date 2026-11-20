-- Repeating reminders. A repeating reminder is a "series" row that stays scheduled: each time it comes
-- due, Orbital adds a separate fired copy (series_id points back) for the person to complete or snooze,
-- and moves the series on to its next occurrence, computed in the time zone it was set in.

ALTER TABLE reminders ADD COLUMN repeat jsonb CHECK (repeat IS NULL OR jsonb_typeof(repeat) = 'object');
ALTER TABLE reminders ADD COLUMN time_zone text CHECK (time_zone IS NULL OR length(time_zone) <= 64);
-- The day of the month a monthly/yearly series is on, so "the 31st" isn't pulled to the 30th for good by a short month.
ALTER TABLE reminders ADD COLUMN anchor_day smallint CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31);
ALTER TABLE reminders ADD COLUMN series_id uuid REFERENCES reminders(id) ON DELETE SET NULL;
CREATE INDEX reminders_series_id_idx ON reminders(series_id);
