BEGIN;

DROP TRIGGER IF EXISTS trg_student_enrollment_class_history_no_update ON student_enrollment_class_history;
CREATE OR REPLACE FUNCTION permit_enrollment_history_interval_closure()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.id IS NOT DISTINCT FROM NEW.id
       AND OLD.enrollment_id IS NOT DISTINCT FROM NEW.enrollment_id
       AND OLD.class_name IS NOT DISTINCT FROM NEW.class_name
       AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from
       AND OLD.changed_by IS NOT DISTINCT FROM NEW.changed_by
       AND OLD.changed_at IS NOT DISTINCT FROM NEW.changed_at
       AND OLD.source IS NOT DISTINCT FROM NEW.source
       AND OLD.import_batch_id IS NOT DISTINCT FROM NEW.import_batch_id
       AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
       AND NEW.effective_to >= OLD.effective_from THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'class history permits only one-way interval closure';
END;
$$;
CREATE TRIGGER trg_student_enrollment_class_history_no_update
BEFORE UPDATE ON student_enrollment_class_history
FOR EACH ROW EXECUTE FUNCTION permit_enrollment_history_interval_closure();

ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_student_id_fkey;
ALTER TABLE student_enrollments ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS lifecycle_effective_date DATE;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS lifecycle_reason_code VARCHAR(64);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS lifecycle_reason VARCHAR(1000);
UPDATE student_enrollments
SET lifecycle_state = CASE WHEN class_assigned AND effective_to IS NULL THEN 'ACTIVE' ELSE 'ENDED' END,
    lifecycle_effective_date = COALESCE(effective_to, effective_from),
    lifecycle_reason_code = COALESCE(lifecycle_reason_code, 'LEGACY_BACKFILL');
ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS ck_student_enrollment_lifecycle_state;
ALTER TABLE student_enrollments ADD CONSTRAINT ck_student_enrollment_lifecycle_state
    CHECK (lifecycle_state IN ('DRAFT','ACTIVE','ENDED','WITHDRAWN','GRADUATED','VOIDED'));
CREATE INDEX IF NOT EXISTS ix_student_enrollments_lifecycle_state ON student_enrollments(lifecycle_state);

ALTER TABLE student_subject_grades DROP CONSTRAINT IF EXISTS student_subject_grades_enrollment_id_fkey;
ALTER TABLE student_subject_grades ADD CONSTRAINT student_subject_grades_enrollment_id_fkey
    FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS student_enrollment_lifecycle_audit (
    id BIGSERIAL PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
    prior_state VARCHAR(16) NOT NULL,
    new_state VARCHAR(16) NOT NULL,
    effective_date DATE NOT NULL,
    actor VARCHAR(255) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    source_workflow VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_student_enrollment_lifecycle_audit_enrollment_id
    ON student_enrollment_lifecycle_audit(enrollment_id);

CREATE OR REPLACE FUNCTION reject_student_enrollment_lifecycle_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'enrollment lifecycle audit is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_student_enrollment_lifecycle_audit_no_update ON student_enrollment_lifecycle_audit;
CREATE TRIGGER trg_student_enrollment_lifecycle_audit_no_update
BEFORE UPDATE OR DELETE ON student_enrollment_lifecycle_audit
FOR EACH ROW EXECUTE FUNCTION reject_student_enrollment_lifecycle_audit_mutation();

COMMIT;
