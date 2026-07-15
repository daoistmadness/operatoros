PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS student_academic_mapping_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mapping_type VARCHAR(16) NOT NULL
        CHECK (mapping_type IN ('jenjang','class')),
    source_value VARCHAR(255) NOT NULL,
    normalized_source_value VARCHAR(255) NOT NULL,
    target_value VARCHAR(255) NULL,
    target_id INTEGER NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','approved','rejected')),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by VARCHAR(255) NULL,
    approved_at TIMESTAMP NULL,
    CONSTRAINT ck_student_academic_mapping_target CHECK (
        (mapping_type='jenjang' AND target_id IS NOT NULL) OR
        (mapping_type='class' AND target_value IS NOT NULL)
    ),
    CONSTRAINT ck_student_academic_mapping_approval CHECK (
        status!='approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CONSTRAINT uq_student_academic_mapping_source
        UNIQUE (mapping_type, normalized_source_value)
);

CREATE INDEX IF NOT EXISTS ix_student_academic_mapping_rules_mapping_type
    ON student_academic_mapping_rules(mapping_type);
CREATE INDEX IF NOT EXISTS ix_student_academic_mapping_rules_status
    ON student_academic_mapping_rules(status);
