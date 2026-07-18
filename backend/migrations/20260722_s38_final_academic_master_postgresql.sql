ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL;
ALTER TABLE jenjangs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL;
ALTER TABLE jenjangs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL;
ALTER TABLE jenjangs ALTER COLUMN level TYPE VARCHAR(64) USING level::text;
ALTER TABLE academic_programs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL;
ALTER TABLE academic_programs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM academic_classes LIMIT 1) THEN
        RAISE EXCEPTION 'academic_classes must be explicitly mapped to grades before S3.8 migration';
    END IF;
END $$;

DO $$ DECLARE constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid='jenjangs'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) ILIKE 'UNIQUE (name)%'
    LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE jenjangs DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS academic_grades (
    id BIGSERIAL PRIMARY KEY,
    jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
    program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_academic_grade_program_name UNIQUE(program_id,name),
    CONSTRAINT uq_academic_grade_program_sequence UNIQUE(program_id,sequence_number)
);

DO $$ DECLARE constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid='student_enrollments'::regclass AND contype='f'
      AND pg_get_constraintdef(oid) ILIKE '%academic_classes%'
    LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE student_enrollments DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

DROP TABLE academic_classes;
CREATE TABLE academic_classes (
    id BIGSERIAL PRIMARY KEY,
    academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    grade_id BIGINT NOT NULL REFERENCES academic_grades(id) ON DELETE RESTRICT,
    class_name VARCHAR(255) NOT NULL,
    section_code VARCHAR(32) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_academic_class_year_grade_name UNIQUE(academic_year_id,grade_id,class_name),
    CONSTRAINT uq_academic_class_year_grade_section UNIQUE(academic_year_id,grade_id,section_code)
);

ALTER TABLE student_enrollments
    ADD CONSTRAINT fk_student_enrollment_academic_class
    FOREIGN KEY (academic_class_id) REFERENCES academic_classes(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS academic_master_audit (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(24) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    before_data JSONB NULL,
    after_data JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
