-- S3.8 -> S3.9 SQLite DDL contract.
-- Execute through core.schema_migrations.migrate_s38_to_s39_sqlite, which supplies
-- UUIDv5 backfill values and atomic copy/publish semantics unavailable in SQLite SQL.
CREATE TABLE student_import_sessions (
  id VARCHAR(36) PRIMARY KEY, session_uuid VARCHAR(36) NOT NULL UNIQUE,
  import_type VARCHAR(32) NOT NULL CHECK(import_type IN ('STUDENT_ROSTER','STUDENT_DATA_UPDATE')),
  status VARCHAR(32) NOT NULL, provenance_status VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at DATETIME, committed_by VARCHAR(255),
  expires_at DATETIME NOT NULL, source_filename VARCHAR(255) NOT NULL, source_file_checksum VARCHAR(64) NOT NULL,
  preview_checksum VARCHAR(64), commit_checksum VARCHAR(64), idempotency_key VARCHAR(64) UNIQUE,
  request_correlation_id VARCHAR(64), row_count INTEGER NOT NULL, selected_row_count INTEGER NOT NULL,
  applied_action_count INTEGER NOT NULL, rollback_state VARCHAR(32) NOT NULL,
  rollback_requested_at DATETIME, rollback_completed_at DATETIME, metadata JSON NOT NULL, schema_version VARCHAR(32) NOT NULL
);
CREATE TABLE student_import_applied_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id VARCHAR(36) NOT NULL REFERENCES student_import_sessions(id) ON DELETE RESTRICT,
  student_import_batch_id VARCHAR(36) REFERENCES student_import_batches(id) ON DELETE RESTRICT,
  academic_roster_import_batch_id VARCHAR(36) REFERENCES academic_roster_import_batches(id) ON DELETE RESTRICT,
  source_row_number INTEGER NOT NULL, action_sequence INTEGER NOT NULL, action_type VARCHAR(48) NOT NULL,
  entity_type VARCHAR(40) NOT NULL, entity_id VARCHAR(64) NOT NULL, entity_reference VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NOT NULL UNIQUE, parent_action_id INTEGER, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR(255) NOT NULL, request_correlation_id VARCHAR(64), before_state JSON, after_state JSON NOT NULL,
  before_state_checksum VARCHAR(64), after_state_checksum VARCHAR(64) NOT NULL, dependency_checkpoint JSON NOT NULL,
  compensation_type VARCHAR(48) NOT NULL, rollback_eligibility VARCHAR(40) NOT NULL, rollback_block_reason VARCHAR(128),
  rollback_state VARCHAR(32) NOT NULL, rollback_action_id INTEGER UNIQUE, metadata JSON NOT NULL, schema_version VARCHAR(32) NOT NULL,
  CONSTRAINT uq_student_import_action_sequence UNIQUE(session_id,source_row_number,action_sequence),
  CONSTRAINT ck_student_import_action_one_batch CHECK(NOT(student_import_batch_id IS NOT NULL AND academic_roster_import_batch_id IS NOT NULL))
);
-- Ownership columns are added nullable, backfilled, then both batch tables are rebuilt
-- by the Python runner with UNIQUE, NOT NULL, and ON DELETE RESTRICT constraints.
-- The runner also installs the two append-only triggers from _install_sqlite_action_triggers.
-- Ownership type triggers reject update batches linked to roster sessions and vice versa.
