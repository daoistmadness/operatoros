PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attendance_import_batches (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'preview'
        CHECK (status IN ('preview','committing','committed','failed','expired')),
    total_rows INTEGER NOT NULL DEFAULT 0,
    logical_rows INTEGER NOT NULL DEFAULT 0,
    new_records INTEGER NOT NULL DEFAULT 0,
    update_records INTEGER NOT NULL DEFAULT 0,
    unchanged_records INTEGER NOT NULL DEFAULT 0,
    conflict_records INTEGER NOT NULL DEFAULT 0,
    invalid_records INTEGER NOT NULL DEFAULT 0,
    new_students INTEGER NOT NULL DEFAULT 0,
    committed_at TIMESTAMP NULL,
    commit_result JSON NULL
);

CREATE INDEX IF NOT EXISTS ix_attendance_import_batches_checksum
    ON attendance_import_batches(checksum);

CREATE TABLE IF NOT EXISTS attendance_import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id VARCHAR(36) NOT NULL REFERENCES attendance_import_batches(id) ON DELETE RESTRICT,
    source_row INTEGER NULL,
    student_identifier VARCHAR(64) NULL,
    student_name VARCHAR(255) NULL,
    attendance_date DATE NULL,
    existing_attendance_id INTEGER NULL REFERENCES attendance(id) ON DELETE RESTRICT,
    classification VARCHAR(32) NOT NULL
        CHECK (classification IN ('NEW','UNCHANGED','DIFFERENCE','CONFLICT','INVALID')),
    existing_record JSON NULL,
    proposed_change JSON NULL,
    validation_error VARCHAR(1000) NULL,
    warning VARCHAR(1000) NULL,
    selected_for_commit BOOLEAN NOT NULL DEFAULT 0,
    CONSTRAINT uq_attendance_import_batch_key
        UNIQUE (batch_id, student_identifier, attendance_date)
);

CREATE INDEX IF NOT EXISTS ix_attendance_import_rows_batch_id
    ON attendance_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS ix_attendance_import_rows_classification
    ON attendance_import_rows(classification);
CREATE INDEX IF NOT EXISTS ix_attendance_import_rows_batch_class
    ON attendance_import_rows(batch_id, classification);

