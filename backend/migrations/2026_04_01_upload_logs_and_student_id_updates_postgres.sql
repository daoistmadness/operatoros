CREATE TABLE IF NOT EXISTS upload_logs (
    id BIGSERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(255) NULL,
    total_records INTEGER NOT NULL DEFAULT 0,
    new_students INTEGER NOT NULL DEFAULT 0,
    late_entries INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_uploaded_at ON upload_logs (uploaded_at DESC);

ALTER TABLE IF EXISTS students
    ADD COLUMN IF NOT EXISTS id_updated_at TIMESTAMP NULL;
