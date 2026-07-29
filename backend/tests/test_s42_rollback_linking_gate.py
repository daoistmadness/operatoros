import logging
import sqlite3
from hashlib import sha256

import pytest
from sqlalchemy import create_engine, text

from core.database import validate_student_linking_gate


def gate_database(tmp_path, students: int, links: list[tuple[int, str]] = ()):
    path = tmp_path / f"gate-{students}-{len(links)}.db"
    engine = create_engine(f"sqlite:///{path}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE student_masters (id TEXT PRIMARY KEY)"))
        connection.execute(text("""
            CREATE TABLE student_device_identities (
                id INTEGER PRIMARY KEY,
                student_master_id TEXT NOT NULL,
                legacy_student_id INTEGER,
                is_active BOOLEAN NOT NULL
            )
        """))
        for student_id in range(1, students + 1):
            connection.execute(
                text("INSERT INTO students (id) VALUES (:id)"),
                {"id": student_id},
            )
        for master_id in dict.fromkeys(master_id for _, master_id in links):
            connection.execute(
                text("INSERT INTO student_masters (id) VALUES (:id)"),
                {"id": master_id},
            )
        for identity_id, (student_id, master_id) in enumerate(links, 1):
            connection.execute(
                text("""
                    INSERT INTO student_device_identities
                        (id, student_master_id, legacy_student_id, is_active)
                    VALUES (:id, :master_id, :student_id, TRUE)
                """),
                {"id": identity_id, "master_id": master_id, "student_id": student_id},
            )
    return engine, path


def test_empty_database_is_accepted(tmp_path):
    engine, _ = gate_database(tmp_path, students=0)
    validate_student_linking_gate(engine)


def test_untouched_all_unlinked_database_is_accepted(tmp_path, caplog):
    engine, _ = gate_database(tmp_path, students=4)
    with caplog.at_level(logging.WARNING, logger="core.database"):
        validate_student_linking_gate(engine)
    assert "STUDENT LINKING PENDING" in caplog.text


@pytest.mark.parametrize("linked_count", [1, 3])
def test_partial_linking_is_rejected(tmp_path, linked_count):
    engine, _ = gate_database(
        tmp_path,
        students=4,
        links=[(student_id, f"master-{student_id}") for student_id in range(1, linked_count + 1)],
    )
    with pytest.raises(RuntimeError, match=rf"students=4, linked_students={linked_count}"):
        validate_student_linking_gate(engine)


def test_fully_linked_database_is_accepted(tmp_path):
    engine, _ = gate_database(
        tmp_path,
        students=4,
        links=[(student_id, f"master-{student_id}") for student_id in range(1, 5)],
    )
    validate_student_linking_gate(engine)


@pytest.mark.parametrize(
    "links",
    [
        [(1, "master-1"), (1, "master-2")],
        [(1, "master-1"), (2, "master-1")],
    ],
)
def test_ambiguous_linking_is_rejected(tmp_path, links):
    engine, _ = gate_database(tmp_path, students=2, links=links)
    with pytest.raises(RuntimeError, match="legacy student linking is inconsistent"):
        validate_student_linking_gate(engine)


def test_orphan_link_is_rejected(tmp_path):
    engine, _ = gate_database(tmp_path, students=1)
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO student_device_identities
                (id, student_master_id, legacy_student_id, is_active)
            VALUES (1, 'missing-master', 1, TRUE)
        """))
    with pytest.raises(RuntimeError, match="legacy student linking is inconsistent"):
        validate_student_linking_gate(engine)


def test_bypass_contract_is_unchanged(tmp_path, caplog):
    engine, _ = gate_database(tmp_path, students=2, links=[(1, "master-1")])
    with caplog.at_level(logging.WARNING, logger="core.database"):
        validate_student_linking_gate(engine, bypass=True)
    assert "STUDENT LINKING GATE BYPASSED" in caplog.text
    assert "BYPASS_STUDENT_LINKING_GATE=true" in caplog.text


def test_validation_is_read_only(tmp_path):
    engine, path = gate_database(tmp_path, students=2)
    engine.dispose()
    checksum_before = sha256(path.read_bytes()).hexdigest()
    validate_student_linking_gate(engine)
    engine.dispose()
    assert sha256(path.read_bytes()).hexdigest() == checksum_before


def test_s42_schema_is_accepted_without_s43_objects(tmp_path):
    engine, path = gate_database(tmp_path, students=2)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE operatoros_schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO operatoros_schema_migrations (version, applied_at)
            VALUES ('20260724_s42', '2026-07-24T00:00:00')
        """))
    validate_student_linking_gate(engine)
    with sqlite3.connect(path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert {
            "attendance_follow_ups",
            "attendance_follow_up_notes",
            "attendance_follow_up_audit",
        }.isdisjoint(tables)
        assert connection.execute(
            "SELECT version FROM operatoros_schema_migrations"
        ).fetchall() == [("20260724_s42",)]
