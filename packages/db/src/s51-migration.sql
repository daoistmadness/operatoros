CREATE TABLE upp_monthly_reports (
  id INTEGER PRIMARY KEY,
  school_unit_id INTEGER NOT NULL REFERENCES school_units(id) ON DELETE RESTRICT,
  reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 1 AND 9999),
  reporting_month INTEGER NOT NULL CHECK (reporting_month BETWEEN 1 AND 12),
  submission_status TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (submission_status IN ('UPLOADED','READY_FOR_SUBMISSION','SUBMITTED')),
  submitted_at TEXT,
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  submission_notes TEXT CHECK (submission_notes IS NULL OR length(trim(submission_notes)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((submission_status = 'SUBMITTED' AND submitted_at IS NOT NULL AND submitted_by_user_id IS NOT NULL) OR
    (submission_status != 'SUBMITTED' AND submitted_at IS NULL AND submitted_by_user_id IS NULL))
);
CREATE UNIQUE INDEX upp_monthly_reports_identity_uc
  ON upp_monthly_reports(school_unit_id, reporting_year, reporting_month);
CREATE INDEX upp_monthly_reports_period_status_idx
  ON upp_monthly_reports(reporting_year, reporting_month, submission_status);

CREATE TABLE upp_report_versions (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES upp_monthly_reports(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at TEXT NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0)
);
CREATE UNIQUE INDEX upp_report_versions_identity_uc ON upp_report_versions(report_id, version_number);
CREATE UNIQUE INDEX upp_report_one_active_version_uc
  ON upp_report_versions(report_id) WHERE is_active=1;
CREATE INDEX upp_report_versions_report_order_idx
  ON upp_report_versions(report_id, version_number);

CREATE TABLE upp_report_submission_evidence (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES upp_monthly_reports(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX upp_report_submission_evidence_report_idx
  ON upp_report_submission_evidence(report_id, id);

CREATE TABLE upp_report_history (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES upp_monthly_reports(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('UPLOAD','REPLACEMENT','STATUS_CHANGED')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('UPLOADED','READY_FOR_SUBMISSION','SUBMITTED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('UPLOADED','READY_FOR_SUBMISSION','SUBMITTED')),
  version_id INTEGER REFERENCES upp_report_versions(id) ON DELETE RESTRICT,
  evidence_id INTEGER REFERENCES upp_report_submission_evidence(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  occurred_at TEXT NOT NULL,
  CHECK ((action = 'UPLOAD' AND from_status IS NULL AND to_status = 'UPLOADED' AND version_id IS NOT NULL) OR
    (action = 'REPLACEMENT' AND from_status IS NOT NULL AND to_status = 'UPLOADED' AND version_id IS NOT NULL) OR
    (action = 'STATUS_CHANGED' AND from_status IS NOT NULL AND version_id IS NULL))
);
CREATE INDEX upp_report_history_report_order_idx ON upp_report_history(report_id, id DESC);

CREATE TRIGGER trg_upp_report_status_transition
BEFORE UPDATE OF submission_status ON upp_monthly_reports
WHEN NEW.submission_status != OLD.submission_status AND NOT (
  (OLD.submission_status = 'UPLOADED' AND NEW.submission_status = 'READY_FOR_SUBMISSION') OR
  (OLD.submission_status = 'READY_FOR_SUBMISSION' AND NEW.submission_status = 'SUBMITTED') OR
  NEW.submission_status = 'UPLOADED'
)
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_INVALID_STATUS_TRANSITION');
END;

CREATE TRIGGER trg_upp_report_identity_immutable
BEFORE UPDATE ON upp_monthly_reports
WHEN NEW.id IS NOT OLD.id OR NEW.school_unit_id IS NOT OLD.school_unit_id OR
  NEW.reporting_year IS NOT OLD.reporting_year OR NEW.reporting_month IS NOT OLD.reporting_month OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_IDENTITY_IMMUTABLE');
END;
CREATE TRIGGER trg_upp_monthly_reports_no_delete
BEFORE DELETE ON upp_monthly_reports
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_upp_report_versions_active_once
BEFORE UPDATE ON upp_report_versions
WHEN NEW.id IS NOT OLD.id OR NEW.report_id IS NOT OLD.report_id OR NEW.version_number IS NOT OLD.version_number OR
  NEW.original_filename IS NOT OLD.original_filename OR NEW.file_sha256 IS NOT OLD.file_sha256 OR
  NEW.file_size_bytes IS NOT OLD.file_size_bytes OR NEW.uploaded_by_user_id IS NOT OLD.uploaded_by_user_id OR
  NEW.uploaded_at IS NOT OLD.uploaded_at OR NEW.notes IS NOT OLD.notes OR
  NOT (OLD.is_active = 1 AND NEW.is_active = 0)
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_VERSION_IMMUTABLE');
END;
CREATE TRIGGER trg_upp_report_versions_no_delete
BEFORE DELETE ON upp_report_versions
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_VERSION_IMMUTABLE');
END;

CREATE TRIGGER trg_upp_report_history_no_update
BEFORE UPDATE ON upp_report_history
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_HISTORY_IMMUTABLE');
END;
CREATE TRIGGER trg_upp_report_history_no_delete
BEFORE DELETE ON upp_report_history
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_HISTORY_IMMUTABLE');
END;
CREATE TRIGGER trg_upp_report_evidence_no_update
BEFORE UPDATE ON upp_report_submission_evidence
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_EVIDENCE_IMMUTABLE');
END;
CREATE TRIGGER trg_upp_report_evidence_no_delete
BEFORE DELETE ON upp_report_submission_evidence
BEGIN
  SELECT RAISE(ABORT, 'UPP_REPORT_EVIDENCE_IMMUTABLE');
END;
