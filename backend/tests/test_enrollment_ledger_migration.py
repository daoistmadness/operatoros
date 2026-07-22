import sqlite3
from pathlib import Path

import pytest

from core.enrollment_ledger_migration import migrate_enrollment_ledger_sqlite


def legacy_database(path: Path) -> Path:
    with sqlite3.connect(path) as connection:
        connection.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE students(id INTEGER PRIMARY KEY);
        CREATE TABLE student_masters(id VARCHAR(36) PRIMARY KEY);
        CREATE TABLE academic_years(id INTEGER PRIMARY KEY);
        CREATE TABLE jenjangs(id INTEGER PRIMARY KEY);
        CREATE TABLE academic_classes(id INTEGER PRIMARY KEY);
        CREATE TABLE subjects(id INTEGER PRIMARY KEY);
        CREATE TABLE assessment_components(id INTEGER PRIMARY KEY);
        CREATE TABLE student_enrollments(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          student_master_id VARCHAR(36) REFERENCES student_masters(id) ON DELETE RESTRICT,
          academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
          jenjang_id INTEGER NOT NULL REFERENCES jenjangs(id) ON DELETE RESTRICT,
          academic_class_id INTEGER REFERENCES academic_classes(id) ON DELETE RESTRICT,
          class_name VARCHAR, class_assigned BOOLEAN NOT NULL DEFAULT 0,
          effective_from DATE, effective_to DATE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(student_id, academic_year_id)
        );
        CREATE UNIQUE INDEX uq_student_master_academic_year ON student_enrollments(student_master_id, academic_year_id) WHERE student_master_id IS NOT NULL;
        CREATE TABLE student_subject_grades(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
          subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
          component_id INTEGER NOT NULL REFERENCES assessment_components(id) ON DELETE RESTRICT,
          score FLOAT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(enrollment_id, subject_id, component_id)
        );
        CREATE TABLE student_enrollment_class_history(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
          class_name VARCHAR, effective_from DATE NOT NULL, effective_to DATE,
          changed_by VARCHAR NOT NULL, changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          source VARCHAR NOT NULL, import_batch_id VARCHAR
        );
        CREATE TRIGGER trg_student_enrollment_class_history_no_update
          BEFORE UPDATE ON student_enrollment_class_history BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        INSERT INTO students VALUES(1); INSERT INTO student_masters VALUES('master');
        INSERT INTO academic_years VALUES(1); INSERT INTO jenjangs VALUES(1); INSERT INTO academic_classes VALUES(1);
        INSERT INTO student_enrollments(student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from)
          VALUES(1,'master',1,1,1,'A',1,'2026-07-01');
        """)
    return path


def test_synthetic_migration_replaces_cascades_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("OPERATOROS_ISOLATED_TEST", "true")
    target = legacy_database(tmp_path / "synthetic.db")
    assert migrate_enrollment_ledger_sqlite(target) == "MIGRATION_COMPLETE"
    assert migrate_enrollment_ledger_sqlite(target) == "MIGRATION_ALREADY_CURRENT"
    with sqlite3.connect(target) as connection:
        enrollment_fks = {row[3]: row[6] for row in connection.execute("PRAGMA foreign_key_list(student_enrollments)")}
        grade_fks = {row[3]: row[6] for row in connection.execute("PRAGMA foreign_key_list(student_subject_grades)")}
        assert enrollment_fks["student_id"] == "SET NULL"
        assert grade_fks["enrollment_id"] == "RESTRICT"
        assert connection.execute("SELECT lifecycle_state FROM student_enrollments").fetchone() == ("ACTIVE",)
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("DELETE FROM students WHERE id=1")
        assert connection.execute("SELECT student_id FROM student_enrollments").fetchone() == (None,)


def test_migration_requires_isolated_approval(tmp_path, monkeypatch):
    monkeypatch.delenv("OPERATOROS_ISOLATED_TEST", raising=False)
    target = legacy_database(tmp_path / "synthetic.db")
    with pytest.raises(RuntimeError, match="ISOLATED_MIGRATION_APPROVAL_REQUIRED"):
        migrate_enrollment_ledger_sqlite(target)
