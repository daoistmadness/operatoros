import logging
from hashlib import sha256

import pytest
from sqlalchemy import create_engine, text

from core.database import validate_student_linking_gate


def gate_engine(tmp_path, students: int, links: list[tuple[int, str]] = ()):
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
            connection.execute(text("INSERT INTO students (id) VALUES (:id)"), {"id": student_id})
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


def test_gate_accepts_untouched_operational_legacy_state(tmp_path, caplog):
    engine, _ = gate_engine(tmp_path, students=117)
    with caplog.at_level(logging.WARNING, logger="core.database"):
        validate_student_linking_gate(engine)
    assert "STUDENT LINKING PENDING" in caplog.text
    assert "students=117, linked_students=0, student_masters=0" in caplog.text


def test_gate_accepts_fully_linked_students(tmp_path):
    engine, _ = gate_engine(
        tmp_path,
        students=4,
        links=[(student_id, f"master-{student_id}") for student_id in range(1, 5)],
    )
    validate_student_linking_gate(engine)


@pytest.mark.parametrize("linked_count", [1, 3])
def test_gate_rejects_partial_linking(tmp_path, linked_count):
    engine, _ = gate_engine(
        tmp_path,
        students=4,
        links=[(student_id, f"master-{student_id}") for student_id in range(1, linked_count + 1)],
    )
    with pytest.raises(RuntimeError, match=rf"students=4, linked_students={linked_count}"):
        validate_student_linking_gate(engine)


def test_gate_accepts_empty_first_time_deployment(tmp_path):
    engine, _ = gate_engine(tmp_path, students=0)
    validate_student_linking_gate(engine)


def test_gate_rejects_ambiguous_student_link(tmp_path):
    engine, _ = gate_engine(tmp_path, students=1, links=[(1, "master-1"), (1, "master-2")])
    with pytest.raises(RuntimeError, match="legacy student linking is inconsistent"):
        validate_student_linking_gate(engine)


def test_gate_rejects_master_linked_to_multiple_students(tmp_path):
    engine, _ = gate_engine(tmp_path, students=2, links=[(1, "master-1"), (2, "master-1")])
    with pytest.raises(RuntimeError, match="legacy student linking is inconsistent"):
        validate_student_linking_gate(engine)


def test_gate_rejects_orphan_link(tmp_path):
    engine, _ = gate_engine(tmp_path, students=1)
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO student_device_identities
                (id, student_master_id, legacy_student_id, is_active)
            VALUES (1, 'missing-master', 1, TRUE)
        """))
    with pytest.raises(RuntimeError, match="legacy student linking is inconsistent"):
        validate_student_linking_gate(engine)


def test_gate_is_read_only(tmp_path):
    engine, path = gate_engine(tmp_path, students=2)
    engine.dispose()
    checksum_before = sha256(path.read_bytes()).hexdigest()
    validate_student_linking_gate(engine)
    engine.dispose()
    assert sha256(path.read_bytes()).hexdigest() == checksum_before


def test_gate_bypass_warns_and_allows_startup(tmp_path, caplog):
    engine, _ = gate_engine(tmp_path, students=117)
    with caplog.at_level(logging.WARNING, logger="core.database"):
        validate_student_linking_gate(engine, bypass=True)
    assert "STUDENT LINKING GATE BYPASSED" in caplog.text
    assert "BYPASS_STUDENT_LINKING_GATE=true" in caplog.text
    assert "students=117, student_masters=0" in caplog.text
