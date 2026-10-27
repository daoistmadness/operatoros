CREATE TABLE student_identity_verifications_v53 (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NIK','KK')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_status IN ('UNVERIFIED','IDENTIFIER_ENTERED','VERIFIED','NEEDS_CORRECTION')),
  verified_at TEXT,
  verified_by TEXT,
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (verification_status = 'VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND correction_reason IS NULL) OR
    (verification_status = 'NEEDS_CORRECTION' AND correction_reason IS NOT NULL AND verified_at IS NULL AND verified_by IS NULL) OR
    (verification_status IN ('UNVERIFIED','IDENTIFIER_ENTERED') AND verified_at IS NULL AND verified_by IS NULL AND correction_reason IS NULL)
  )
);
INSERT INTO student_identity_verifications_v53
SELECT id, student_master_id, identifier_type, verification_status, verified_at, verified_by, notes, correction_reason, created_at, updated_at
FROM student_identity_verifications;
DROP TABLE student_identity_verifications;
ALTER TABLE student_identity_verifications_v53 RENAME TO student_identity_verifications;
CREATE UNIQUE INDEX student_identity_verifications_student_type_uc
  ON student_identity_verifications(student_master_id, identifier_type);
CREATE INDEX student_identity_verifications_status_idx
  ON student_identity_verifications(identifier_type, verification_status);

CREATE TABLE student_identity_verification_history_v53 (
  id INTEGER PRIMARY KEY,
  student_master_id TEXT NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('NIK','KK')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('UNVERIFIED','IDENTIFIER_ENTERED','VERIFIED','NEEDS_CORRECTION')),
  to_status TEXT NOT NULL CHECK (to_status IN ('UNVERIFIED','IDENTIFIER_ENTERED','VERIFIED','NEEDS_CORRECTION')),
  changed_by TEXT NOT NULL CHECK (length(trim(changed_by)) > 0),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(trim(correction_reason)) > 0),
  notes TEXT CHECK (notes IS NULL OR length(trim(notes)) > 0),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO student_identity_verification_history_v53
SELECT id, student_master_id, identifier_type, from_status, to_status, changed_by, correction_reason, notes, occurred_at
FROM student_identity_verification_history;
DROP TABLE student_identity_verification_history;
ALTER TABLE student_identity_verification_history_v53 RENAME TO student_identity_verification_history;
CREATE INDEX student_identity_verif_history_student_idx
  ON student_identity_verification_history(student_master_id, id DESC);

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
CREATE TRIGGER trg_student_identity_verification_status_transition
BEFORE UPDATE OF verification_status ON student_identity_verifications
WHEN OLD.verification_status <> NEW.verification_status AND NOT (
  (OLD.verification_status = 'UNVERIFIED' AND NEW.verification_status IN ('IDENTIFIER_ENTERED','NEEDS_CORRECTION')) OR
  (OLD.verification_status = 'IDENTIFIER_ENTERED' AND NEW.verification_status IN ('UNVERIFIED','VERIFIED','NEEDS_CORRECTION')) OR
  (OLD.verification_status = 'VERIFIED' AND NEW.verification_status IN ('IDENTIFIER_ENTERED','NEEDS_CORRECTION')) OR
  (OLD.verification_status = 'NEEDS_CORRECTION' AND NEW.verification_status IN ('UNVERIFIED','IDENTIFIER_ENTERED'))
)
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_IDENTITY_VERIFICATION_INVALID_TRANSITION');
END;
CREATE TRIGGER trg_student_dapodik_status_transition
BEFORE UPDATE OF status ON student_dapodik_registrations
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'NOT_STARTED' AND NEW.status = 'PENDING_EXTERNAL_PROCESSING') OR
  (OLD.status = 'PENDING_EXTERNAL_PROCESSING' AND NEW.status IN ('ENTERED','NEEDS_CORRECTION')) OR
  (OLD.status = 'ENTERED' AND NEW.status IN ('SYNCHRONIZED','NEEDS_CORRECTION')) OR
  (OLD.status = 'SYNCHRONIZED' AND NEW.status = 'NEEDS_CORRECTION') OR
  (OLD.status = 'NEEDS_CORRECTION' AND NEW.status = 'PENDING_EXTERNAL_PROCESSING')
)
BEGIN
  SELECT RAISE(ABORT, 'STUDENT_DAPODIK_INVALID_TRANSITION');
END;
