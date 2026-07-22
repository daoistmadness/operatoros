PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

CREATE TABLE student_progression_mapping_rules (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    source_jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    destination_jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    source_program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
    destination_program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
    source_grade_id INTEGER NOT NULL REFERENCES academic_grades(id) ON DELETE RESTRICT,
    destination_grade_id INTEGER NOT NULL REFERENCES academic_grades(id) ON DELETE RESTRICT,
    outcome VARCHAR(24) NOT NULL DEFAULT 'CROSS_JENJANG',
    active BOOLEAN NOT NULL DEFAULT 1,
    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_progression_mapping_path UNIQUE(source_program_id, source_grade_id, destination_program_id, destination_grade_id),
    CONSTRAINT ck_student_progression_mapping_outcome CHECK(outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG'))
);
CREATE INDEX ix_student_progression_mapping_source_jenjang ON student_progression_mapping_rules(source_jenjang_id);
CREATE INDEX ix_student_progression_mapping_destination_jenjang ON student_progression_mapping_rules(destination_jenjang_id);
CREATE INDEX ix_student_progression_mapping_source_program ON student_progression_mapping_rules(source_program_id);
CREATE INDEX ix_student_progression_mapping_destination_program ON student_progression_mapping_rules(destination_program_id);
CREATE INDEX ix_student_progression_mapping_source_grade ON student_progression_mapping_rules(source_grade_id);
CREATE INDEX ix_student_progression_mapping_destination_grade ON student_progression_mapping_rules(destination_grade_id);
CREATE INDEX ix_student_progression_mapping_active ON student_progression_mapping_rules(active);

CREATE TABLE student_progression_preview_batches (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    source_academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    destination_academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    status VARCHAR(24) NOT NULL DEFAULT 'PREVIEW',
    preview_version INTEGER NOT NULL DEFAULT 1,
    snapshot_checksum VARCHAR(64) NOT NULL,
    rows JSON NOT NULL,
    summary JSON NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    committed_by VARCHAR(255) NULL,
    committed_at DATETIME NULL,
    commit_result JSON NULL,
    CONSTRAINT ck_student_progression_batch_status CHECK(status IN ('PREVIEW','STALE','COMMITTING','COMMITTED','FAILED','EXPIRED')),
    CONSTRAINT ck_student_progression_preview_version CHECK(preview_version > 0)
);
CREATE INDEX ix_student_progression_preview_source_year ON student_progression_preview_batches(source_academic_year_id);
CREATE INDEX ix_student_progression_preview_destination_year ON student_progression_preview_batches(destination_academic_year_id);
CREATE INDEX ix_student_progression_preview_status ON student_progression_preview_batches(status);

CREATE TABLE student_progression_audit (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    batch_id VARCHAR(36) NOT NULL REFERENCES student_progression_preview_batches(id) ON DELETE RESTRICT,
    preview_row_id INTEGER NOT NULL,
    source_enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
    destination_enrollment_id INTEGER NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
    student_master_id VARCHAR(36) NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
    outcome VARCHAR(24) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    mapping_source VARCHAR(32) NOT NULL,
    source_context JSON NOT NULL,
    destination_context JSON NULL,
    actor VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_progression_audit_row UNIQUE(batch_id, preview_row_id),
    CONSTRAINT ck_student_progression_audit_outcome CHECK(outcome IN ('PROMOTE','RETAIN','GRADUATE','CROSS_JENJANG','WITHDRAW','EXCLUDE','MANUAL_REVIEW'))
);
CREATE INDEX ix_student_progression_audit_batch ON student_progression_audit(batch_id);
CREATE INDEX ix_student_progression_audit_source_enrollment ON student_progression_audit(source_enrollment_id);
CREATE INDEX ix_student_progression_audit_destination_enrollment ON student_progression_audit(destination_enrollment_id);
CREATE INDEX ix_student_progression_audit_student_master ON student_progression_audit(student_master_id);
CREATE INDEX ix_student_progression_audit_outcome ON student_progression_audit(outcome);
CREATE TRIGGER trg_student_progression_audit_no_update
BEFORE UPDATE ON student_progression_audit BEGIN SELECT RAISE(ABORT, 'progression audit is append-only'); END;
CREATE TRIGGER trg_student_progression_audit_no_delete
BEFORE DELETE ON student_progression_audit BEGIN SELECT RAISE(ABORT, 'progression audit is append-only'); END;

COMMIT;
