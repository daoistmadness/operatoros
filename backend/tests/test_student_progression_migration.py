import sqlite3

import pytest
from sqlalchemy import create_engine

from core.database import Base
from core.student_progression_migration import migrate_student_progression_sqlite
from models.student_progression import StudentProgressionAudit, StudentProgressionMappingRule, StudentProgressionPreviewBatch


def _synthetic_s40(path):
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE student_progression_audit")
        connection.execute("DROP TABLE student_progression_preview_batches")
        connection.execute("DROP TABLE student_progression_mapping_rules")
        connection.execute("CREATE TABLE operatoros_schema_migrations(version TEXT PRIMARY KEY, predecessor TEXT, schema_fingerprint TEXT NOT NULL, protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)")
        connection.execute("INSERT INTO operatoros_schema_migrations VALUES('20260722_s40','20260722_s39','synthetic','{}','TEST','2026-07-22T00:00:00Z')")
        connection.commit()


def test_progression_migration_is_isolated_idempotent_and_append_only(monkeypatch, tmp_path):
    target = tmp_path / "synthetic-s40.db"
    _synthetic_s40(target)
    monkeypatch.setenv("OPERATOROS_ISOLATED_TEST", "true")
    assert migrate_student_progression_sqlite(target) == "MIGRATION_COMPLETE"
    assert migrate_student_progression_sqlite(target) == "MIGRATION_ALREADY_CURRENT"
    with sqlite3.connect(target) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"student_progression_mapping_rules", "student_progression_preview_batches", "student_progression_audit"}.issubset(tables)
        assert connection.execute("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC LIMIT 1").fetchone() == ("20260722_s41",)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("step", ["schema", "ledger"])
def test_progression_migration_failure_does_not_publish(monkeypatch, tmp_path, step):
    target = tmp_path / f"failure-{step}.db"
    _synthetic_s40(target)
    before = target.read_bytes()
    monkeypatch.setenv("OPERATOROS_ISOLATED_TEST", "true")
    with pytest.raises(RuntimeError, match="INJECTED_FAILURE"):
        migrate_student_progression_sqlite(target, failure_step=step)
    assert target.read_bytes() == before
    assert not target.with_name(f".{target.name}.progression-migrating").exists()


def test_progression_migration_refuses_unapproved_or_protected_target(monkeypatch, tmp_path):
    target = tmp_path / "protected-synthetic.db"
    _synthetic_s40(target)
    monkeypatch.delenv("OPERATOROS_ISOLATED_TEST", raising=False)
    with pytest.raises(RuntimeError, match="ISOLATED_MIGRATION_APPROVAL_REQUIRED"):
        migrate_student_progression_sqlite(target)
    monkeypatch.setenv("OPERATOROS_ISOLATED_TEST", "true")
    monkeypatch.setitem(migrate_student_progression_sqlite.__globals__, "PROTECTED_DATABASES", {target.resolve()})
    with pytest.raises(RuntimeError, match="PROTECTED_DATABASE_PATH_REJECTED"):
        migrate_student_progression_sqlite(target)
