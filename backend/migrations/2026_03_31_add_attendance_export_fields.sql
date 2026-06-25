-- Adds nullable class mapping for students and the full attendance export footprint.
-- Safe to run against an existing PostgreSQL database more than once.

ALTER TABLE IF EXISTS students
    ADD COLUMN IF NOT EXISTS class_name VARCHAR(255);

ALTER TABLE IF EXISTS students
    ALTER COLUMN class_name DROP DEFAULT;

ALTER TABLE IF EXISTS attendance
    ADD COLUMN IF NOT EXISTS check_out TIME NULL,
    ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS overtime INTERVAL NULL,
    ADD COLUMN IF NOT EXISTS exception VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS week VARCHAR(64) NULL;

ALTER TABLE IF EXISTS attendance
    ALTER COLUMN check_in DROP NOT NULL;

ALTER TABLE IF EXISTS attendance
    ALTER COLUMN late_duration DROP NOT NULL;

ALTER TABLE IF EXISTS attendance
    ALTER COLUMN status SET NOT NULL;
