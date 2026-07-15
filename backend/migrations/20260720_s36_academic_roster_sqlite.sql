CREATE TABLE IF NOT EXISTS academic_roster_import_batches (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    source_owner VARCHAR(255) NOT NULL,
    date_received DATE NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(24) NOT NULL DEFAULT 'preview'
        CHECK (status IN ('preview','committed','failed','expired')),
    rows JSON NOT NULL,
    summary JSON NOT NULL,
    committed_by VARCHAR(255) NULL,
    committed_at TIMESTAMP NULL,
    commit_result JSON NULL
);

CREATE INDEX IF NOT EXISTS ix_academic_roster_import_batches_checksum
    ON academic_roster_import_batches(checksum);

