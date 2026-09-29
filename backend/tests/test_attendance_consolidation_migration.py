"""S4.7 ledger migration preserves saved values and records assumed cutoffs."""

import sqlite3
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.attendance_consolidation_migration import (
    S47_PREDECESSOR,
    _schema_fingerprint,
    migrate_attendance_consolidation_sqlite,
)


def _s46_database(path: Path, *, configured_cutoff: bool = True) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE operatoros_schema_migrations (
              version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL,
              protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL
            );
            CREATE TABLE academic_years (id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT);
            CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, jenjang TEXT, class_name TEXT);
            CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
            CREATE TABLE student_device_identities (id INTEGER PRIMARY KEY, student_master_id TEXT);
            CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, status TEXT);
            CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER);
            CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, class_name TEXT);
            CREATE TABLE absence_reason_class_entries (
              id INTEGER PRIMARY KEY, class_name TEXT, month INTEGER, year INTEGER,
              sakit INTEGER, izin INTEGER, alfa INTEGER, note TEXT, entered_by TEXT,
              entered_at TEXT, updated_at TEXT
            );
            CREATE TABLE jenjang_config (id INTEGER PRIMARY KEY, jenjang TEXT, cutoff_time TEXT);
            INSERT INTO academic_years VALUES (1, '2026-07-01', '2027-06-30');
            INSERT INTO jenjangs VALUES (1, 'SMP');
            INSERT INTO students VALUES (1, 'Synthetic Student', 'SMP', '7A');
            INSERT INTO attendance VALUES (1, 1, '2026-08-02', 'late');
            INSERT INTO academic_classes VALUES (1, 1, '7A');
            INSERT INTO student_enrollments VALUES (1, 1, 1, 1, 1);
            INSERT INTO absence_reason_class_entries VALUES (1, '7A', 8, 2026, 2, 1, 3, 'original note', 'old-operator', '2026-08-31', '2026-08-31');
            """
        )
        if configured_cutoff:
            connection.execute("INSERT INTO jenjang_config VALUES (1, 'SMP', '07:30')")
        fingerprint = _schema_fingerprint(connection)
        connection.execute(
            "INSERT INTO operatoros_schema_migrations VALUES (?, ?, ?, '{}', 'TEST', '2026-09-01T10:00:00+00:00')",
            (S47_PREDECESSOR, '20260901_s45', fingerprint),
        )


def test_migration_copies_legacy_totals_and_backfills_cutoff_without_reclassifying(tmp_path: Path) -> None:
    database = tmp_path / "s46.db"
    _s46_database(database)

    assert migrate_attendance_consolidation_sqlite(database) == "MIGRATION_COMPLETE"

    with sqlite3.connect(database) as connection:
        revision = connection.execute(
            "SELECT entry_mode,state,sakit,izin,alfa,created_by,submitted_by,legacy_saved,legacy_source_entry_id,note "
            "FROM attendance_ledger_revisions"
        ).fetchone()
        assert revision == (
            "TOTALS_ONLY", "SUBMITTED", 2, 1, 3, "S47_MIGRATION", "S47_MIGRATION", 1, 1, "original note"
        )
        assert connection.execute(
            "SELECT jenjang_id,effective_from,cutoff_time,source,created_by FROM jenjang_lateness_policy"
        ).fetchone() == (1, "2026-08-02", "07:30", "BACKFILL_ASSUMED", "S47_MIGRATION")
        assert connection.execute("SELECT status FROM attendance WHERE id=1").fetchone() == ("late",)
        assert connection.execute("SELECT COUNT(*) FROM absence_reason_class_entries").fetchone() == (1,)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jenjang_lateness_policy)")}
        assert "grace_minutes" not in columns
        with pytest.raises(sqlite3.IntegrityError, match="requires a reason"):
            connection.execute(
                "INSERT INTO attendance_ledger_revisions "
                "(class_month_id,revision_no,entry_mode,state,created_by,created_at) "
                "VALUES (1,2,'PER_STUDENT','OPEN','test','2026-09-01')"
            )
        connection.execute(
            "INSERT INTO attendance_ledger_revisions "
            "(class_month_id,revision_no,entry_mode,state,created_by,created_at,change_reason) "
            "VALUES (1,2,'PER_STUDENT','OPEN','test','2026-09-01','Approved mode change')"
        )
        connection.execute(
            "INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) "
            "VALUES (2,1,1,0,2)"
        )
        assert connection.execute("SELECT sakit,izin,alfa FROM attendance_ledger_revisions WHERE id=2").fetchone() == (None, None, None)
        assert connection.execute("SELECT COUNT(*) FROM attendance_ledger_student_totals WHERE revision_id=2").fetchone() == (1,)
        connection.execute(
            "INSERT INTO attendance_ledger_revisions "
            "(class_month_id,revision_no,entry_mode,state,created_by,created_at,submitted_by,submitted_at) "
            "VALUES (1,3,'PER_STUDENT','SUBMITTED','test','2026-09-02','test','2026-09-02')"
        )
        connection.execute(
            "INSERT INTO attendance_ledger_class_months (academic_year_id,class_id,month) VALUES (1,1,'2026-09')"
        )
        with pytest.raises(sqlite3.IntegrityError, match="must start OPEN"):
            connection.execute(
                "INSERT INTO attendance_ledger_revisions "
                "(class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,submitted_by,submitted_at) "
                "VALUES (2,1,'TOTALS_ONLY','SUBMITTED',0,0,0,'test','2026-09-03','test','2026-09-03')"
            )
        connection.execute(
            "INSERT INTO attendance_ledger_revisions "
            "(class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at) "
            "VALUES (2,1,'TOTALS_ONLY','OPEN',0,0,0,'test','2026-09-03')"
        )
        connection.execute(
            "INSERT INTO attendance_ledger_revisions "
            "(class_month_id,revision_no,entry_mode,state,sakit,izin,alfa,created_by,created_at,submitted_by,submitted_at) "
            "VALUES (2,2,'TOTALS_ONLY','SUBMITTED',0,0,0,'test','2026-09-04','test','2026-09-04')"
        )
        with pytest.raises(sqlite3.IntegrityError, match="require PER_STUDENT mode"):
            connection.execute(
                "INSERT INTO attendance_ledger_student_totals (revision_id,enrollment_id,sakit,izin,alfa) "
                "VALUES (4,1,1,0,0)"
            )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE attendance_ledger_revisions SET sakit=99 WHERE id=1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM jenjang_lateness_policy WHERE id=1")
        assert _schema_fingerprint(connection) == connection.execute(
            "SELECT schema_fingerprint FROM operatoros_schema_migrations WHERE version='20260929_s47'"
        ).fetchone()[0]


def test_preflight_failure_leaves_source_database_unchanged(tmp_path: Path) -> None:
    database = tmp_path / "s46-no-cutoff.db"
    _s46_database(database, configured_cutoff=False)
    before = database.read_bytes()

    with pytest.raises(RuntimeError, match="MIGRATION_PREFLIGHT_FAILED"):
        migrate_attendance_consolidation_sqlite(database)

    assert database.read_bytes() == before
    assert not database.with_name(f".{database.name}.s47-migrating").exists()


def test_ambiguous_legacy_class_mapping_fails_before_publish(tmp_path: Path) -> None:
    database = tmp_path / "s46-ambiguous-class.db"
    _s46_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO academic_classes VALUES (2, 1, '7A')")
        connection.execute(
            "UPDATE operatoros_schema_migrations SET schema_fingerprint=? WHERE version=?",
            (_schema_fingerprint(connection), S47_PREDECESSOR),
        )
    before = database.read_bytes()

    with pytest.raises(RuntimeError, match="legacy class-month does not map"):
        migrate_attendance_consolidation_sqlite(database)

    assert database.read_bytes() == before
