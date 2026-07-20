BEGIN;
DO $$ BEGIN
  IF (SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1) <> '20260722_s38' THEN
    RAISE EXCEPTION 'S3.8 predecessor required';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE student_import_sessions (
  id VARCHAR(36) PRIMARY KEY, session_uuid VARCHAR(36) NOT NULL UNIQUE,
  import_type VARCHAR(32) NOT NULL CHECK(import_type IN ('STUDENT_ROSTER','STUDENT_DATA_UPDATE')),
  status VARCHAR(32) NOT NULL, provenance_status VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at TIMESTAMP, committed_by VARCHAR(255), expires_at TIMESTAMP NOT NULL,
  source_filename VARCHAR(255) NOT NULL, source_file_checksum VARCHAR(64) NOT NULL, preview_checksum VARCHAR(64), commit_checksum VARCHAR(64),
  idempotency_key VARCHAR(64) UNIQUE, request_correlation_id VARCHAR(64), row_count INTEGER NOT NULL DEFAULT 0,
  selected_row_count INTEGER NOT NULL DEFAULT 0, applied_action_count INTEGER NOT NULL DEFAULT 0, rollback_state VARCHAR(32) NOT NULL,
  rollback_requested_at TIMESTAMP, rollback_completed_at TIMESTAMP, metadata JSON NOT NULL, schema_version VARCHAR(32) NOT NULL
);
ALTER TABLE student_import_batches ADD COLUMN session_id VARCHAR(36);
ALTER TABLE academic_roster_import_batches ADD COLUMN session_id VARCHAR(36);
WITH source AS (SELECT *, uuid_generate_v5('9e81c7d8-e73f-4eac-bb72-d55b004297e1'::uuid,'student-update:'||id)::text sid FROM student_import_batches)
INSERT INTO student_import_sessions(id,session_uuid,import_type,status,provenance_status,created_at,created_by,updated_at,committed_at,expires_at,source_filename,source_file_checksum,idempotency_key,row_count,selected_row_count,applied_action_count,rollback_state,metadata,schema_version)
SELECT sid,sid,'STUDENT_DATA_UPDATE',CASE WHEN status='committed' THEN 'COMMITTED' ELSE 'ARCHIVED' END,'LEGACY_PROVENANCE_UNAVAILABLE',created_at,created_by,created_at,committed_at,created_at + INTERVAL '24 hours',COALESCE(filename,'legacy-import.xlsx'),file_checksum,NULL,total_rows,0,0,'NOT_AVAILABLE',json_build_object('legacy_batch_model','student_import_batches','legacy_batch_id',id,'migration_revision','20260722_s39','backfill_version','1'),'1' FROM source;
UPDATE student_import_batches b SET session_id=uuid_generate_v5('9e81c7d8-e73f-4eac-bb72-d55b004297e1'::uuid,'student-update:'||b.id)::text;
WITH source AS (SELECT *, uuid_generate_v5('9e81c7d8-e73f-4eac-bb72-d55b004297e1'::uuid,'academic-roster:'||id)::text sid FROM academic_roster_import_batches)
INSERT INTO student_import_sessions(id,session_uuid,import_type,status,provenance_status,created_at,created_by,updated_at,committed_at,expires_at,source_filename,source_file_checksum,idempotency_key,row_count,selected_row_count,applied_action_count,rollback_state,metadata,schema_version)
SELECT sid,sid,'STUDENT_ROSTER',CASE WHEN status='committed' THEN 'COMMITTED' ELSE 'ARCHIVED' END,'LEGACY_PROVENANCE_UNAVAILABLE',created_at,created_by,created_at,committed_at,created_at + INTERVAL '24 hours',COALESCE(filename,'legacy-import.xlsx'),checksum,NULL,0,0,0,'NOT_AVAILABLE',json_build_object('legacy_batch_model','academic_roster_import_batches','legacy_batch_id',id,'migration_revision','20260722_s39','backfill_version','1'),'1' FROM source;
UPDATE academic_roster_import_batches b SET session_id=uuid_generate_v5('9e81c7d8-e73f-4eac-bb72-d55b004297e1'::uuid,'academic-roster:'||b.id)::text;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM student_import_batches WHERE session_id IS NULL) OR EXISTS(SELECT 1 FROM academic_roster_import_batches WHERE session_id IS NULL) THEN RAISE EXCEPTION 'orphan import batch'; END IF; END $$;
ALTER TABLE student_import_batches ALTER COLUMN session_id SET NOT NULL, ADD CONSTRAINT uq_student_import_batches_session UNIQUE(session_id), ADD CONSTRAINT fk_student_import_batches_session FOREIGN KEY(session_id) REFERENCES student_import_sessions(id) ON DELETE RESTRICT;
ALTER TABLE academic_roster_import_batches ALTER COLUMN session_id SET NOT NULL, ADD CONSTRAINT uq_academic_roster_batches_session UNIQUE(session_id), ADD CONSTRAINT fk_academic_roster_batches_session FOREIGN KEY(session_id) REFERENCES student_import_sessions(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION enforce_import_session_type() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE expected VARCHAR(32); BEGIN
 expected := CASE TG_TABLE_NAME WHEN 'student_import_batches' THEN 'STUDENT_DATA_UPDATE' ELSE 'STUDENT_ROSTER' END;
 IF (SELECT import_type FROM student_import_sessions WHERE id=NEW.session_id) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'import session type mismatch'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_student_import_batch_session_type BEFORE INSERT OR UPDATE OF session_id ON student_import_batches FOR EACH ROW EXECUTE FUNCTION enforce_import_session_type();
CREATE TRIGGER trg_academic_roster_batch_session_type BEFORE INSERT OR UPDATE OF session_id ON academic_roster_import_batches FOR EACH ROW EXECUTE FUNCTION enforce_import_session_type();
CREATE TABLE student_import_applied_actions (
 id BIGSERIAL PRIMARY KEY, session_id VARCHAR(36) NOT NULL REFERENCES student_import_sessions(id) ON DELETE RESTRICT,
 student_import_batch_id VARCHAR(36) REFERENCES student_import_batches(id) ON DELETE RESTRICT, academic_roster_import_batch_id VARCHAR(36) REFERENCES academic_roster_import_batches(id) ON DELETE RESTRICT,
 source_row_number INTEGER NOT NULL, action_sequence INTEGER NOT NULL, action_type VARCHAR(48) NOT NULL, entity_type VARCHAR(40) NOT NULL,
 entity_id VARCHAR(64) NOT NULL, entity_reference VARCHAR(64) NOT NULL, operation_id VARCHAR(64) NOT NULL UNIQUE, parent_action_id BIGINT,
 applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_by VARCHAR(255) NOT NULL, request_correlation_id VARCHAR(64), before_state JSON,
 after_state JSON NOT NULL, before_state_checksum VARCHAR(64), after_state_checksum VARCHAR(64) NOT NULL, dependency_checkpoint JSON NOT NULL,
 compensation_type VARCHAR(48) NOT NULL, rollback_eligibility VARCHAR(40) NOT NULL, rollback_block_reason VARCHAR(128), rollback_state VARCHAR(32) NOT NULL,
 rollback_action_id BIGINT UNIQUE, metadata JSON NOT NULL, schema_version VARCHAR(32) NOT NULL, UNIQUE(session_id,source_row_number,action_sequence),
 CHECK(NOT(student_import_batch_id IS NOT NULL AND academic_roster_import_batch_id IS NOT NULL))
);
CREATE INDEX ix_student_import_actions_session ON student_import_applied_actions(session_id);
CREATE INDEX ix_student_import_actions_type ON student_import_applied_actions(action_type);
CREATE INDEX ix_student_import_actions_rollback ON student_import_applied_actions(rollback_state);
CREATE OR REPLACE FUNCTION enforce_student_import_action_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'student import actions are append-only'; END IF;
 IF (to_jsonb(OLD)-ARRAY['rollback_state','rollback_block_reason','rollback_action_id','metadata']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['rollback_state','rollback_block_reason','rollback_action_id','metadata']) THEN RAISE EXCEPTION 'student import action provenance is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_student_import_actions_append_only BEFORE UPDATE OR DELETE ON student_import_applied_actions FOR EACH ROW EXECUTE FUNCTION enforce_student_import_action_append_only();
-- The deployment runner records protected fingerprints and the S3.9 ledger row only after validation.
COMMIT;
