CREATE TABLE IF NOT EXISTS upload_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_by TEXT NULL,
    total_records INTEGER NOT NULL DEFAULT 0,
    new_students INTEGER NOT NULL DEFAULT 0,
    late_entries INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_uploaded_at ON upload_logs (uploaded_at DESC);

ALTER TABLE students ADD COLUMN id_updated_at TIMESTAMP NULL;
