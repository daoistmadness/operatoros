import hashlib
import json
import shutil
import sqlite3
import uuid
from pathlib import Path

import pytest

from core.schema_guard import _validate_sqlite_file
from core.schema_migrations import (
    STUDENT_IMPORT_SESSION_NAMESPACE,
    adopt_current_sqlite_schema,
    initialize_fresh_sqlite_database,
    migrate_s38_to_s39_sqlite,
    protected_fingerprints,
)

pytestmark = pytest.mark.skip(
    reason="Protected-database copies are prohibited; enrollment migration coverage uses isolated synthetic databases."
)

ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_DB = ROOT / "backend" / "attendance.db"
COUNTS = {"attendance": 3651, "student_device_identities": 117, "student_enrollments": 0, "student_masters": 117, "students": 117}


def s38_fixture(tmp_path: Path, *, seed: bool = True) -> Path:
    target = tmp_path / "s38.db"
    shutil.copy2(PRODUCTION_DB, target)
    adopt_current_sqlite_schema(target, expected_counts=COUNTS, approved_by="MIGRATION_TEST")
    if seed:
        with sqlite3.connect(target) as connection:
            connection.execute(
                "INSERT INTO student_import_batches(id,filename,file_checksum,status,total_rows,new_count,update_count,unchanged_count,conflict_count,invalid_count,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                ("update-9000000000", "murid-ü.xlsx", "a" * 64, "committed", 2, 0, 2, 0, 0, 0, "operator", "2026-07-20 10:00:00"),
            )
            connection.execute(
                "INSERT INTO academic_roster_import_batches(id,filename,checksum,source_owner,date_received,created_by,created_at,status,rows,summary) VALUES(?,?,?,?,?,?,?,?,?,?)",
                ("roster-9000000000", "roster.xlsx", "a" * 64, "school", "2026-07-20", "operator", "2026-07-20 11:00:00", "preview", "[]", "{}"),
            )
        with sqlite3.connect(target) as connection:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return target


def logical_schema(path: Path):
    with sqlite3.connect(path) as connection:
        result = {}
        for table in ("student_import_sessions", "student_import_applied_actions", "student_import_batches", "academic_roster_import_batches"):
            def affinity(declared):
                upper = declared.upper()
                if "INT" in upper: return "INTEGER"
                if any(token in upper for token in ("CHAR", "CLOB", "TEXT")): return "TEXT"
                if any(token in upper for token in ("REAL", "FLOA", "DOUB")): return "REAL"
                if not upper or "BLOB" in upper: return "BLOB"
                return "NUMERIC"
            result[table] = {
                "columns": sorted((row[1], affinity(row[2]), int(bool(row[3] or row[5]))) for row in connection.execute(f"PRAGMA table_info({table})")),
                "fks": sorted((row[2], row[3], row[4], row[6]) for row in connection.execute(f"PRAGMA foreign_key_list({table})")),
            }
        result["triggers"] = sorted(row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_student_import_actions_%'"))
        return result


def test_s38_to_s39_backfills_deterministic_sessions_without_actions(tmp_path):
    target = s38_fixture(tmp_path)
    with sqlite3.connect(target) as connection:
        before = protected_fingerprints(connection)
    assert migrate_s38_to_s39_sqlite(target) == "MIGRATION_COMPLETE"
    assert migrate_s38_to_s39_sqlite(target) == "MIGRATION_ALREADY_CURRENT"
    with sqlite3.connect(target) as connection:
        sessions = connection.execute("SELECT id,import_type,provenance_status,rollback_state FROM student_import_sessions ORDER BY import_type").fetchall()
        assert len(sessions) == 2
        assert {row[0] for row in sessions} == {
            str(uuid.uuid5(STUDENT_IMPORT_SESSION_NAMESPACE, "student-update:update-9000000000")),
            str(uuid.uuid5(STUDENT_IMPORT_SESSION_NAMESPACE, "academic-roster:roster-9000000000")),
        }
        assert all(row[2:] == ("LEGACY_PROVENANCE_UNAVAILABLE", "NOT_AVAILABLE") for row in sessions)
        assert connection.execute("SELECT COUNT(*) FROM student_import_applied_actions").fetchone() == (0,)
        assert protected_fingerprints(connection) == before
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    _validate_sqlite_file(target)


@pytest.mark.parametrize("step", ["session_table", "ledger_table", "first_ownership_column", "historical_session_backfill", "batch_linking", "not_null", "triggers", "fingerprint_validation", "before_revision", "revision"])
def test_failure_injection_leaves_s38_source_unchanged_and_retryable(tmp_path, step):
    target = s38_fixture(tmp_path)
    before = hashlib.sha256(target.read_bytes()).hexdigest()
    with pytest.raises(RuntimeError, match="INJECTED_FAILURE"):
        migrate_s38_to_s39_sqlite(target, failure_step=step)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == before
    with sqlite3.connect(target) as connection:
        assert connection.execute("SELECT version FROM operatoros_schema_migrations").fetchall() == [("20260722_s38",)]
        assert "student_import_sessions" not in {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert migrate_s38_to_s39_sqlite(target) == "MIGRATION_COMPLETE"


def test_fresh_and_migrated_s39_are_logically_equivalent(tmp_path):
    migrated = s38_fixture(tmp_path, seed=False)
    fresh = tmp_path / "fresh.db"
    migrate_s38_to_s39_sqlite(migrated)
    initialize_fresh_sqlite_database(fresh)
    assert logical_schema(migrated) == logical_schema(fresh)


def test_sqlite_ledger_triggers_reject_delete_and_immutable_update(tmp_path):
    target = s38_fixture(tmp_path)
    migrate_s38_to_s39_sqlite(target)
    with sqlite3.connect(target) as connection:
        session_id = connection.execute("SELECT id FROM student_import_sessions LIMIT 1").fetchone()[0]
        connection.execute("INSERT INTO student_import_applied_actions(session_id,source_row_number,action_sequence,action_type,entity_type,entity_id,entity_reference,operation_id,applied_by,after_state,after_state_checksum,dependency_checkpoint,compensation_type,rollback_eligibility,rollback_state,metadata,schema_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (session_id,1,1,"TEST","student","opaque","opaque","b"*64,"operator","{}","c"*64,"{}","NONE","NOT_ELIGIBLE","NOT_REQUESTED","{}","1"))
        action_id = connection.execute("SELECT id FROM student_import_applied_actions").fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("UPDATE student_import_applied_actions SET action_type='REWRITE' WHERE id=?", (action_id,))
        connection.execute("UPDATE student_import_applied_actions SET rollback_state='BLOCKED' WHERE id=?", (action_id,))
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM student_import_applied_actions WHERE id=?", (action_id,))


def test_postgresql_migration_is_transactional_and_uses_uuidv5():
    sql = (ROOT / "backend/migrations/20260722_s39_student_import_provenance_postgresql.sql").read_text()
    assert sql.startswith("BEGIN;") and sql.rstrip().endswith("COMMIT;")
    assert "uuid_generate_v5" in sql
    assert "ALTER COLUMN session_id SET NOT NULL" in sql
    assert "enforce_student_import_action_append_only" in sql
