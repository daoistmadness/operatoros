CREATE TABLE IF NOT EXISTS jenjang_config (
    id BIGSERIAL PRIMARY KEY,
    jenjang VARCHAR(64) NOT NULL UNIQUE,
    cutoff_time VARCHAR(5) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS late_source VARCHAR(16) NOT NULL DEFAULT 'none';

ALTER TABLE attendance
    ALTER COLUMN late_duration TYPE INTEGER
    USING COALESCE(CAST(EXTRACT(EPOCH FROM late_duration) / 60 AS INTEGER), 0);

ALTER TABLE attendance
    ALTER COLUMN late_duration SET DEFAULT 0;

UPDATE attendance
SET late_source = 'excel'
WHERE late_duration > 0 AND (late_source IS NULL OR late_source = 'none');
