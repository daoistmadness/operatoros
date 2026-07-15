PRAGMA foreign_keys = ON;

ALTER TABLE jenjangs ADD COLUMN code VARCHAR(32) NULL;
ALTER TABLE jenjangs ADD COLUMN level INTEGER NULL;
ALTER TABLE jenjangs ADD COLUMN active BOOLEAN NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS ix_jenjangs_code ON jenjangs(code);
CREATE INDEX IF NOT EXISTS ix_jenjangs_active ON jenjangs(active);

CREATE TABLE IF NOT EXISTS academic_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT 1,
    CONSTRAINT uq_academic_program_jenjang_name UNIQUE(jenjang_id,name)
);
CREATE INDEX IF NOT EXISTS ix_academic_programs_jenjang_id ON academic_programs(jenjang_id);

CREATE TABLE IF NOT EXISTS academic_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
    jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    class_name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT 1,
    CONSTRAINT uq_academic_class_year_jenjang_name UNIQUE(academic_year_id,jenjang_id,class_name)
);
CREATE INDEX IF NOT EXISTS ix_academic_classes_academic_year_id ON academic_classes(academic_year_id);
CREATE INDEX IF NOT EXISTS ix_academic_classes_program_id ON academic_classes(program_id);
CREATE INDEX IF NOT EXISTS ix_academic_classes_jenjang_id ON academic_classes(jenjang_id);

CREATE TABLE IF NOT EXISTS academic_master_import_previews (
    id VARCHAR(36) PRIMARY KEY,
    source_owner VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(24) NOT NULL DEFAULT 'review_required'
        CHECK(status IN ('review_required','approved','rejected','expired')),
    proposed_data JSON NOT NULL,
    validation_result JSON NOT NULL,
    approved_by VARCHAR(255) NULL,
    approved_at TIMESTAMP NULL
);

ALTER TABLE student_enrollments ADD COLUMN academic_class_id INTEGER NULL
    REFERENCES academic_classes(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS ix_student_enrollments_academic_class_id
    ON student_enrollments(academic_class_id);
