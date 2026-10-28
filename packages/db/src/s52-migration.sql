CREATE TABLE student_identity_verifications (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NIK','KK')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED','NEEDS_CORRECTION')),
  verified_at TEXT,
  verified_by TEXT,
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (verification_status = 'VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL) OR
    (verification_status = 'NEEDS_CORRECTION' AND correction_reason IS NOT NULL) OR
    (verification_status = 'UNVERIFIED')
  )
);
CREATE UNIQUE INDEX student_identity_verifications_student_type_uc
  ON student_identity_verifications(student_master_id, identifier_type);
CREATE INDEX student_identity_verifications_status_idx
  ON student_identity_verifications(identifier_type, verification_status);

CREATE TABLE student_identity_verification_history (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NIK','KK')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('UNVERIFIED','VERIFIED','NEEDS_CORRECTION')),
  to_status TEXT NOT NULL CHECK (to_status IN ('UNVERIFIED','VERIFIED','NEEDS_CORRECTION')),
  changed_by TEXT NOT NULL CHECK (length(trim(changed_by)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX student_identity_verif_history_student_idx
  ON student_identity_verification_history(student_master_id, id DESC);

CREATE TABLE student_dapodik_registrations (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','PENDING_EXTERNAL_PROCESSING','ENTERED','SYNCHRONIZED','NEEDS_CORRECTION')),
  external_reference TEXT CHECK (external_reference IS NULL OR length(trim(external_reference)) > 0),
  updated_by TEXT NOT NULL CHECK (length(trim(updated_by)) > 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  synchronized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'SYNCHRONIZED' AND synchronized_at IS NOT NULL) OR
    (status = 'NEEDS_CORRECTION' AND correction_reason IS NOT NULL) OR
    (status IN ('NOT_STARTED','PENDING_EXTERNAL_PROCESSING','ENTERED'))
  )
);
CREATE UNIQUE INDEX student_dapodik_registrations_student_uc
  ON student_dapodik_registrations(student_master_id);
CREATE INDEX student_dapodik_registrations_status_idx
  ON student_dapodik_registrations(status);

CREATE TABLE student_dapodik_history (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('NOT_STARTED','PENDING_EXTERNAL_PROCESSING','ENTERED','SYNCHRONIZED','NEEDS_CORRECTION')),
  to_status TEXT NOT NULL CHECK (to_status IN ('NOT_STARTED','PENDING_EXTERNAL_PROCESSING','ENTERED','SYNCHRONIZED','NEEDS_CORRECTION')),
  changed_by TEXT NOT NULL CHECK (length(trim(changed_by)) > 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX student_dapodik_history_student_idx
  ON student_dapodik_history(student_master_id, id DESC);

CREATE TABLE student_iom_documents (
  id TEXT PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  iom_type TEXT NOT NULL CHECK (iom_type IN ('TRANSFER_IN','TRANSFER_OUT')),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  uploaded_by TEXT NOT NULL CHECK (length(trim(uploaded_by)) > 0),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT CHECK (updated_by IS NULL OR length(trim(updated_by)) > 0)
);
CREATE INDEX student_iom_documents_student_idx
  ON student_iom_documents(student_master_id, uploaded_at DESC);
CREATE INDEX student_iom_documents_sha256_idx
  ON student_iom_documents(file_sha256);

CREATE TRIGGER trg_student_identity_verification_history_no_update
BEFORE UPDATE ON student_identity_verification_history
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_VERIFICATION_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_student_identity_verification_history_no_delete
BEFORE DELETE ON student_identity_verification_history
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_VERIFICATION_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_student_dapodik_history_no_update
BEFORE UPDATE ON student_dapodik_history
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_DAPODIK_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_student_dapodik_history_no_delete
BEFORE DELETE ON student_dapodik_history
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_DAPODIK_HISTORY_IMMUTABLE');
END;

CREATE TRIGGER trg_student_iom_documents_no_delete
BEFORE DELETE ON student_iom_documents
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_IOM_DOCUMENT_IMMUTABLE');
END;

CREATE TRIGGER trg_student_iom_documents_immutable_fields
BEFORE UPDATE ON student_iom_documents
WHEN NEW.id IS NOT OLD.id OR NEW.student_master_id IS NOT OLD.student_master_id OR
  NEW.iom_type IS NOT OLD.iom_type OR NEW.file_sha256 IS NOT OLD.file_sha256 OR
  NEW.file_size_bytes IS NOT OLD.file_size_bytes OR NEW.original_filename IS NOT OLD.original_filename OR
  NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_IOM_DOCUMENT_IMMUTABLE');
END;
