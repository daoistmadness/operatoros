import sqlite3

import pytest
from sqlalchemy import create_engine

from core.attendance_correction_migration import S42_PREDECESSOR, S42_VERSION, migrate_attendance_corrections_sqlite
from core.database import Base
from core.schema_guard import LEDGER_TABLE
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
from models.student import Student


def make_s41_database(path):
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine, tables=[
        Student.__table__, Attendance.__table__, AttendanceOverride.__table__, AttendanceOverrideHistory.__table__,
    ])
    engine.dispose()
    with sqlite3.connect(path) as connection:
        connection.execute(f"CREATE TABLE {LEDGER_TABLE} (version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL, protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)")
        connection.execute(f"INSERT INTO {LEDGER_TABLE} VALUES (?,?,?,?,?,?)", (S42_PREDECESSOR, None, "s41", "{}", "test", "2026-07-24"))
        connection.execute("INSERT INTO students(id,name) VALUES(1,'Synthetic')")
        connection.execute("INSERT INTO attendance(id,student_id,date,late_duration,late_source,is_absent,status) VALUES(1,1,'2026-07-24',0,'none',0,'on-time')")


def test_s42_migration_is_safe_idempotent_and_installs_append_only_triggers(tmp_path):
    path = tmp_path / "synthetic-s41.db"
    make_s41_database(path)
    assert migrate_attendance_corrections_sqlite(path) == "MIGRATION_COMPLETE"
    assert migrate_attendance_corrections_sqlite(path) == "MIGRATION_ALREADY_CURRENT"
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM attendance").fetchone() == (1,)
        assert connection.execute(f"SELECT version FROM {LEDGER_TABLE} ORDER BY applied_at DESC, version DESC LIMIT 1").fetchone() == (S42_VERSION,)
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"attendance_correction_requests", "attendance_correction_audit", "attendance_periods", "attendance_period_audit"}.issubset(tables)
        connection.execute("INSERT INTO attendance_correction_requests(attendance_id,original_snapshot,original_fingerprint,proposed_status,reason_code,explanation,requester,state,version,created_at,updated_at) VALUES(1,'{}','fingerprint','late','TEST','Synthetic reason','maker','DRAFT',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        connection.execute("INSERT INTO attendance_correction_audit(request_id,action,new_state,actor,effective_date,source_workflow,metadata_version,created_at) VALUES(1,'CREATE','DRAFT','maker','2026-07-24','ATTENDANCE_CORRECTION',1,CURRENT_TIMESTAMP)")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE attendance_correction_audit SET action='TAMPERED' WHERE id=1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM attendance_correction_audit WHERE id=1")
