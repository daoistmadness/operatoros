-- S3 legacy linking and enrollment population foundation (SQLite).
-- Enrollment columns are added by the inspected startup patch because SQLite
-- has no portable ADD COLUMN IF NOT EXISTS syntax.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_link_preview_batches (
  id VARCHAR(36) PRIMARY KEY, snapshot_checksum VARCHAR(64) NOT NULL,
  rows JSON NOT NULL, created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_legacy_link_preview_checksum ON legacy_link_preview_batches(snapshot_checksum);

CREATE TABLE IF NOT EXISTS legacy_link_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  resolution VARCHAR(32) NOT NULL CHECK(resolution IN ('linked','created','deferred','invalid')),
  student_master_id VARCHAR(36) REFERENCES student_masters(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL, resolved_by VARCHAR(255) NOT NULL,
  resolved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_legacy_link_resolutions_student ON legacy_link_resolutions(legacy_student_id);

CREATE TABLE IF NOT EXISTS enrollment_population_preview_batches (
  id VARCHAR(36) PRIMARY KEY,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  effective_start_date DATE NOT NULL, snapshot_checksum VARCHAR(64) NOT NULL,
  rows JSON NOT NULL, created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_enrollment_population_preview_checksum ON enrollment_population_preview_batches(snapshot_checksum);

CREATE TABLE IF NOT EXISTS student_enrollment_class_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  class_name VARCHAR(255), effective_from DATE NOT NULL, effective_to DATE,
  changed_by VARCHAR(255) NOT NULL, changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(128) NOT NULL,
  import_batch_id VARCHAR(36) REFERENCES student_import_batches(id) ON DELETE RESTRICT,
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_enrollment_class_history_enrollment ON student_enrollment_class_history(enrollment_id);
CREATE TRIGGER IF NOT EXISTS trg_student_enrollment_class_history_no_update
BEFORE UPDATE ON student_enrollment_class_history
BEGIN SELECT RAISE(FAIL, 'student_enrollment_class_history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_student_enrollment_class_history_no_delete
BEFORE DELETE ON student_enrollment_class_history
BEGIN SELECT RAISE(FAIL, 'student_enrollment_class_history is append-only'); END;
