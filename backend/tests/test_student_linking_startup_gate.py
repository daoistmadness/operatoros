import logging

import pytest
from sqlalchemy import create_engine, text

from core.database import validate_student_linking_gate


def gate_engine(tmp_path, students: int, masters: int):
    engine = create_engine(f"sqlite:///{tmp_path / f'gate-{students}-{masters}.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE student_masters (id INTEGER PRIMARY KEY)"))
        for student_id in range(1, students + 1):
            connection.execute(text("INSERT INTO students (id) VALUES (:id)"), {"id": student_id})
        for master_id in range(1, masters + 1):
            connection.execute(text("INSERT INTO student_masters (id) VALUES (:id)"), {"id": master_id})
    return engine


def test_gate_rejects_all_legacy_students_unlinked(tmp_path):
    engine = gate_engine(tmp_path, students=117, masters=0)
    with pytest.raises(RuntimeError, match=r"students=117, student_masters=0"):
        validate_student_linking_gate(engine)


def test_gate_accepts_fully_linked_students(tmp_path):
    validate_student_linking_gate(gate_engine(tmp_path, students=117, masters=117))


def test_gate_rejects_partial_linking(tmp_path):
    engine = gate_engine(tmp_path, students=117, masters=116)
    with pytest.raises(RuntimeError, match=r"students=117, student_masters=116"):
        validate_student_linking_gate(engine)


def test_gate_accepts_empty_first_time_deployment(tmp_path):
    validate_student_linking_gate(gate_engine(tmp_path, students=0, masters=0))


def test_gate_bypass_warns_and_allows_startup(tmp_path, caplog):
    engine = gate_engine(tmp_path, students=117, masters=0)
    with caplog.at_level(logging.WARNING, logger="core.database"):
        validate_student_linking_gate(engine, bypass=True)
    assert "STUDENT LINKING GATE BYPASSED" in caplog.text
    assert "BYPASS_STUDENT_LINKING_GATE=true" in caplog.text
    assert "students=117, student_masters=0" in caplog.text
