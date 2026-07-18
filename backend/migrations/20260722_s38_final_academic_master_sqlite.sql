PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE jenjangs_s38 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(32) NULL UNIQUE,
    name VARCHAR NOT NULL,
    level VARCHAR(64) NULL,
    active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
INSERT INTO jenjangs_s38(id,code,name,level,active)
SELECT id,code,name,CAST(level AS TEXT),active FROM jenjangs;
DROP TABLE jenjangs;
ALTER TABLE jenjangs_s38 RENAME TO jenjangs;
CREATE INDEX ix_jenjangs_name ON jenjangs(name);
CREATE UNIQUE INDEX ix_jenjangs_code ON jenjangs(code);
CREATE INDEX ix_jenjangs_active ON jenjangs(active);

ALTER TABLE academic_years ADD COLUMN created_at TIMESTAMP NULL;
ALTER TABLE academic_years ADD COLUMN updated_at TIMESTAMP NULL;
ALTER TABLE academic_programs ADD COLUMN created_at TIMESTAMP NULL;
ALTER TABLE academic_programs ADD COLUMN updated_at TIMESTAMP NULL;

CREATE TABLE academic_grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
    active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_academic_grade_program_name UNIQUE(program_id,name),
    CONSTRAINT uq_academic_grade_program_sequence UNIQUE(program_id,sequence_number)
);

DROP TABLE academic_classes;
CREATE TABLE academic_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    grade_id INTEGER NOT NULL REFERENCES academic_grades(id) ON DELETE RESTRICT,
    class_name VARCHAR(255) NOT NULL,
    section_code VARCHAR(32) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_academic_class_year_grade_name UNIQUE(academic_year_id,grade_id,class_name),
    CONSTRAINT uq_academic_class_year_grade_section UNIQUE(academic_year_id,grade_id,section_code)
);

CREATE TABLE academic_master_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(24) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    before_data JSON NULL,
    after_data JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
