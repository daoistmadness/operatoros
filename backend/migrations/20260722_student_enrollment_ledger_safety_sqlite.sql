PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS trg_student_enrollment_class_history_no_update;
CREATE TRIGGER trg_student_enrollment_class_history_no_update
BEFORE UPDATE ON student_enrollment_class_history WHEN NOT (
    OLD.id IS NEW.id AND OLD.enrollment_id IS NEW.enrollment_id
    AND OLD.class_name IS NEW.class_name AND OLD.effective_from IS NEW.effective_from
    AND OLD.changed_by IS NEW.changed_by AND OLD.changed_at IS NEW.changed_at
    AND OLD.source IS NEW.source AND OLD.import_batch_id IS NEW.import_batch_id
    AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
    AND NEW.effective_to >= OLD.effective_from
) BEGIN
  SELECT RAISE(ABORT, 'class history permits only one-way interval closure');
END;

CREATE TABLE student_enrollments_safety_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NULL REFERENCES students(id) ON DELETE SET NULL,
    student_master_id VARCHAR(36) NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
    academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    academic_class_id INTEGER NULL REFERENCES academic_classes(id) ON DELETE RESTRICT,
    class_name VARCHAR NULL,
    class_assigned BOOLEAN NOT NULL DEFAULT 0,
    effective_from DATE NULL,
    effective_to DATE NULL,
    lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    lifecycle_effective_date DATE NULL,
    lifecycle_reason_code VARCHAR(64) NULL,
    lifecycle_reason VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT _student_year_uc UNIQUE(student_id, academic_year_id),
    CONSTRAINT ck_student_enrollment_effective_dates CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_student_enrollment_lifecycle_state CHECK(lifecycle_state IN ('DRAFT','ACTIVE','ENDED','WITHDRAWN','GRADUATED','VOIDED'))
);

INSERT INTO student_enrollments_safety_new (
    id, student_id, student_master_id, academic_year_id, jenjang_id,
    academic_class_id, class_name, class_assigned, effective_from, effective_to,
    lifecycle_state, lifecycle_effective_date, lifecycle_reason_code,
    created_at, updated_at
)
SELECT id, student_id, student_master_id, academic_year_id, jenjang_id,
       academic_class_id, class_name, class_assigned, effective_from, effective_to,
       CASE WHEN class_assigned = 1 AND effective_to IS NULL THEN 'ACTIVE' ELSE 'ENDED' END,
       COALESCE(effective_to, effective_from), 'LEGACY_BACKFILL', created_at, updated_at
FROM student_enrollments;

DROP TABLE student_enrollments;
ALTER TABLE student_enrollments_safety_new RENAME TO student_enrollments;
CREATE INDEX ix_student_enrollments_student_id ON student_enrollments(student_id);
CREATE INDEX ix_student_enrollments_student_master_id ON student_enrollments(student_master_id);
CREATE INDEX ix_student_enrollments_academic_year_id ON student_enrollments(academic_year_id);
CREATE INDEX ix_student_enrollments_jenjang_id ON student_enrollments(jenjang_id);
CREATE INDEX ix_student_enrollments_academic_class_id ON student_enrollments(academic_class_id);
CREATE INDEX ix_student_enrollments_lifecycle_state ON student_enrollments(lifecycle_state);
CREATE UNIQUE INDEX uq_student_master_academic_year ON student_enrollments(student_master_id, academic_year_id) WHERE student_master_id IS NOT NULL;

CREATE TABLE student_subject_grades_safety_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    component_id INTEGER NOT NULL REFERENCES assessment_components(id) ON DELETE RESTRICT,
    score FLOAT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT _grade_component_uc UNIQUE(enrollment_id, subject_id, component_id)
);
INSERT INTO student_subject_grades_safety_new SELECT * FROM student_subject_grades;
DROP TABLE student_subject_grades;
ALTER TABLE student_subject_grades_safety_new RENAME TO student_subject_grades;
CREATE INDEX ix_student_subject_grades_enrollment_id ON student_subject_grades(enrollment_id);
CREATE INDEX ix_student_subject_grades_subject_id ON student_subject_grades(subject_id);
CREATE INDEX ix_student_subject_grades_component_id ON student_subject_grades(component_id);

CREATE TABLE student_enrollment_lifecycle_audit (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
    prior_state VARCHAR(16) NOT NULL,
    new_state VARCHAR(16) NOT NULL,
    effective_date DATE NOT NULL,
    actor VARCHAR(255) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    source_workflow VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_student_enrollment_lifecycle_audit_enrollment_id ON student_enrollment_lifecycle_audit(enrollment_id);
CREATE TRIGGER trg_student_enrollment_lifecycle_audit_no_delete
BEFORE DELETE ON student_enrollment_lifecycle_audit BEGIN
  SELECT RAISE(ABORT, 'enrollment lifecycle audit is append-only');
END;
CREATE TRIGGER trg_student_enrollment_lifecycle_audit_no_update
BEFORE UPDATE ON student_enrollment_lifecycle_audit BEGIN
  SELECT RAISE(ABORT, 'enrollment lifecycle audit is append-only');
END;

COMMIT;
PRAGMA foreign_keys=ON;
