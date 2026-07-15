-- S2 Student Master Foundation (PostgreSQL 16). Additive and safe to rerun.
CREATE TABLE IF NOT EXISTS student_masters (
    id VARCHAR(36) PRIMARY KEY, full_name VARCHAR(255) NOT NULL, normalized_name VARCHAR(255) NOT NULL,
    preferred_name VARCHAR(255), nipd VARCHAR(64), nisn VARCHAR(64), nik VARCHAR(64), gender VARCHAR(32),
    birth_place VARCHAR(255), birth_date DATE, religion VARCHAR(64), citizenship VARCHAR(64), blood_type VARCHAR(8),
    student_status VARCHAR(32) NOT NULL DEFAULT 'pending_review'
      CHECK(student_status IN ('pending_review','active','inactive','transferred','withdrawn','graduated','archived')),
    admission_date DATE, admission_type VARCHAR(64), previous_school VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by VARCHAR(255), updated_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS ix_student_masters_full_name ON student_masters(full_name);
CREATE INDEX IF NOT EXISTS ix_student_masters_normalized_name ON student_masters(normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_masters_nipd ON student_masters(nipd) WHERE nipd IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_masters_nisn ON student_masters(nisn) WHERE nisn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_masters_nik ON student_masters(nik) WHERE nik IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_device_identities (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
    legacy_student_id INTEGER REFERENCES students(id) ON DELETE RESTRICT,
    device_identifier VARCHAR(255) NOT NULL, device_source VARCHAR(255) NOT NULL,
    effective_from DATE NOT NULL, effective_to DATE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(), created_by VARCHAR(255),
    UNIQUE(student_master_id, device_source, device_identifier, effective_from),
    CHECK(effective_to IS NULL OR effective_to >= effective_from), CHECK(NOT is_active OR effective_to IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_student_device_identities_master ON student_device_identities(student_master_id);
CREATE INDEX IF NOT EXISTS ix_student_device_identities_legacy ON student_device_identities(legacy_student_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student_device_identity
  ON student_device_identities(device_source, device_identifier) WHERE is_active IS TRUE;

CREATE TABLE IF NOT EXISTS student_addresses (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL UNIQUE REFERENCES student_masters(id) ON DELETE RESTRICT,
    address TEXT, kelurahan VARCHAR(255), kecamatan VARCHAR(255), city_regency VARCHAR(255), province VARCHAR(255), postal_code VARCHAR(32),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_student_addresses_kelurahan ON student_addresses(kelurahan);
CREATE TABLE IF NOT EXISTS student_contacts (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL UNIQUE REFERENCES student_masters(id) ON DELETE RESTRICT,
    student_phone VARCHAR(64), student_email VARCHAR(255), emergency_contact_name VARCHAR(255), emergency_contact_relationship VARCHAR(128),
    emergency_contact_phone VARCHAR(64), emergency_contact_address TEXT, updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS student_parent_guardians (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
    guardian_type VARCHAR(32) NOT NULL CHECK(guardian_type IN ('father','mother','guardian')),
    name VARCHAR(255) NOT NULL, phone VARCHAR(64), email VARCHAR(255), occupation VARCHAR(255), education VARCHAR(255), address TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_student_parent_guardians_master ON student_parent_guardians(student_master_id);
CREATE TABLE IF NOT EXISTS student_health_profiles (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL UNIQUE REFERENCES student_masters(id) ON DELETE RESTRICT,
    allergy TEXT, medical_condition TEXT, special_needs TEXT, updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS student_document_statuses (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL UNIQUE REFERENCES student_masters(id) ON DELETE RESTRICT,
    family_card_received BOOLEAN NOT NULL DEFAULT FALSE, birth_certificate_received BOOLEAN NOT NULL DEFAULT FALSE,
    parent_id_received BOOLEAN NOT NULL DEFAULT FALSE, school_agreement_received BOOLEAN NOT NULL DEFAULT FALSE,
    publication_consent_received BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_import_batches (
    id VARCHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, file_checksum VARCHAR(64) NOT NULL, source_sheet VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','approved','committing','committed','failed','expired')),
    total_rows INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0, update_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0, conflict_count INTEGER NOT NULL DEFAULT 0, invalid_count INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT now(), committed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_student_import_batches_checksum ON student_import_batches(file_checksum);
CREATE TABLE IF NOT EXISTS student_import_rows (
    id SERIAL PRIMARY KEY, batch_id VARCHAR(36) NOT NULL REFERENCES student_import_batches(id) ON DELETE RESTRICT,
    source_row INTEGER NOT NULL, classification VARCHAR(64) NOT NULL,
    matched_student_master_id VARCHAR(36) REFERENCES student_masters(id) ON DELETE RESTRICT,
    normalized_payload JSON NOT NULL, differences JSON NOT NULL, validation_errors JSON NOT NULL,
    selected_for_commit BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE(batch_id, source_row)
);
CREATE INDEX IF NOT EXISTS ix_student_import_rows_batch ON student_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS ix_student_import_rows_match ON student_import_rows(matched_student_master_id);
CREATE TABLE IF NOT EXISTS student_master_change_history (
    id SERIAL PRIMARY KEY, student_master_id VARCHAR(36) NOT NULL REFERENCES student_masters(id) ON DELETE RESTRICT,
    action VARCHAR(64) NOT NULL, field_name VARCHAR(128), old_value TEXT, new_value TEXT, source VARCHAR(128) NOT NULL,
    import_batch_id VARCHAR(36) REFERENCES student_import_batches(id) ON DELETE RESTRICT,
    changed_by VARCHAR(255) NOT NULL, changed_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_student_master_history_master ON student_master_change_history(student_master_id);
CREATE INDEX IF NOT EXISTS ix_student_master_history_batch ON student_master_change_history(import_batch_id);
CREATE INDEX IF NOT EXISTS ix_student_master_history_changed ON student_master_change_history(changed_at);

ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS student_master_id VARCHAR(36)
  REFERENCES student_masters(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_student_enrollments_master_id ON student_enrollments(student_master_id);

CREATE OR REPLACE FUNCTION prevent_operatoros_append_only_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'append-only history cannot be modified'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_attendance_override_history_no_update ON attendance_override_history;
DROP TRIGGER IF EXISTS trg_attendance_override_history_no_delete ON attendance_override_history;
DROP TRIGGER IF EXISTS trg_student_master_change_history_no_update ON student_master_change_history;
DROP TRIGGER IF EXISTS trg_student_master_change_history_no_delete ON student_master_change_history;
CREATE TRIGGER trg_attendance_override_history_no_update BEFORE UPDATE ON attendance_override_history
  FOR EACH ROW EXECUTE FUNCTION prevent_operatoros_append_only_mutation();
CREATE TRIGGER trg_attendance_override_history_no_delete BEFORE DELETE ON attendance_override_history
  FOR EACH ROW EXECUTE FUNCTION prevent_operatoros_append_only_mutation();
CREATE TRIGGER trg_student_master_change_history_no_update BEFORE UPDATE ON student_master_change_history
  FOR EACH ROW EXECUTE FUNCTION prevent_operatoros_append_only_mutation();
CREATE TRIGGER trg_student_master_change_history_no_delete BEFORE DELETE ON student_master_change_history
  FOR EACH ROW EXECUTE FUNCTION prevent_operatoros_append_only_mutation();
