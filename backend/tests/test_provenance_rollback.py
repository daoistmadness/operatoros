from __future__ import annotations

import uuid
from datetime import datetime, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models.attendance import Attendance
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_import_session import StudentImportAppliedAction, StudentImportSession
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.student_subject_grade import StudentSubjectGrade
from services.student_import_sessions import append_action, create_preview_session, mark_committed, mark_preview_ready
from services.student_rollback_service import execute_compensating_rollback, generate_rollback_preview


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    yield db
    db.close()


def create_synthetic_committed_session(db, *, import_type="STUDENT_ROSTER"):
    sess = create_preview_session(
        db,
        import_type=import_type,
        filename="synthetic_test.xlsx",
        file_checksum="a" * 64,
        actor="test_admin",
    )
    mark_preview_ready(sess, checksum="b" * 64, row_count=2)
    
    # Create student master
    sm = StudentMaster(
        id=str(uuid.uuid4()),
        full_name="Budi Santoso",
        normalized_name="BUDI SANTOSO",
        nipd="12345",
        nisn="9998887771",
        nik="3171010101010001",
        gender="L",
        student_status="active",
    )
    db.add(sm)
    db.flush()

    # Create legacy student record
    leg_student = Student(id=1001, name="Budi Santoso", class_name="P1A")
    db.add(leg_student)
    db.flush()

    # Create device
    dev = StudentDeviceIdentity(
        student_master_id=sm.id,
        legacy_student_id=leg_student.id,
        device_identifier="DEV-001",
        device_source="FINGERPRINT",
        effective_from=datetime.now().date(),
        is_active=True,
    )
    db.add(dev)
    db.flush()

    # Record action
    act1 = append_action(
        db,
        sess,
        source_row=1,
        sequence=1,
        action_type="CREATE_STUDENT_MASTER",
        entity_type="STUDENT_MASTER",
        entity_id=sm.id,
        actor="test_admin",
        before_state=None,
        after_state={"id": sm.id, "full_name": sm.full_name, "student_status": "active"},
        compensation_type="STATUS_INACTIVE",
        eligibility="ELIGIBLE",
    )

    act2 = append_action(
        db,
        sess,
        source_row=1,
        sequence=2,
        action_type="ADD_DEVICE_IDENTITY",
        entity_type="DEVICE_IDENTITY",
        entity_id=dev.id,
        actor="test_admin",
        before_state=None,
        after_state={"id": dev.id, "device_identifier": "DEV-001", "is_active": True},
        compensation_type="RETIRE_DEVICE",
        eligibility="ELIGIBLE",
    )

    mark_committed(sess, actor="test_admin", selected_count=1, action_count=2)
    db.commit()
    return sess, sm, dev, [act1, act2]


def test_fully_eligible_rollback(test_db):
    sess, sm, dev, actions = create_synthetic_committed_session(test_db)
    preview = generate_rollback_preview(test_db, sess.id, actor="test_admin")

    assert preview["is_rollbackable"] is True
    assert preview["eligible_actions"] == 2
    assert preview["blocked_actions"] == 0
    assert len(preview["proposed_reverse_action_order"]) == 2

    # Execute rollback
    res = execute_compensating_rollback(
        test_db,
        sess.id,
        preview_checksum=preview["preview_checksum"],
        mode="WHOLE_SESSION",
        reason="Testing fully eligible rollback",
        confirmation_value=preview["required_confirmation"],
        idempotency_token="TOKEN-001-TEST",
        actor="test_admin",
    )
    test_db.commit()

    assert res["status"] == "COMPLETED"
    assert res["compensated_action_count"] == 2
    assert sm.student_status == "inactive"
    assert dev.is_active is False


def test_later_attendance_blocks_rollback(test_db):
    sess, sm, dev, actions = create_synthetic_committed_session(test_db)

    # Add attendance for the linked legacy student
    attn = Attendance(student_id=1001, date=datetime.now().date(), check_in=datetime.now().time(), status="present")
    test_db.add(attn)
    test_db.commit()

    preview = generate_rollback_preview(test_db, sess.id, actor="test_admin")
    assert preview["blocked_actions"] > 0
    assert any(c["conflict_code"] == "CREATED_STUDENT_HAS_ATTENDANCE" for c in preview["dependency_conflicts"])


def test_historical_session_non_rollbackable(test_db):
    sess = StudentImportSession(
        session_uuid=str(uuid.uuid4()),
        import_type="STUDENT_ROSTER",
        status="COMMITTED",
        provenance_status="LEGACY_PROVENANCE_UNAVAILABLE",
        rollback_state="NOT_AVAILABLE",
        created_by="system",
        expires_at=datetime.now() + timedelta(days=1),
        source_filename="legacy.xlsx",
        source_file_checksum="c" * 64,
    )
    test_db.add(sess)
    test_db.commit()

    preview = generate_rollback_preview(test_db, sess.id, actor="test_admin")
    assert preview["is_rollbackable"] is False
    assert preview["rollback_state"] == "NOT_AVAILABLE"
    assert "LEGACY_PROVENANCE_UNAVAILABLE" in preview["non_rollbackable_reason"]


def test_idempotent_rollback(test_db):
    sess, sm, dev, actions = create_synthetic_committed_session(test_db)
    preview = generate_rollback_preview(test_db, sess.id, actor="test_admin")

    res1 = execute_compensating_rollback(
        test_db,
        sess.id,
        preview_checksum=preview["preview_checksum"],
        mode="WHOLE_SESSION",
        reason="Idempotency test",
        confirmation_value=preview["required_confirmation"],
        idempotency_token="IDEM-TEST-12345",
        actor="test_admin",
    )
    test_db.commit()

    res2 = execute_compensating_rollback(
        test_db,
        sess.id,
        preview_checksum=preview["preview_checksum"],
        mode="WHOLE_SESSION",
        reason="Idempotency test repeat",
        confirmation_value=preview["required_confirmation"],
        idempotency_token="IDEM-TEST-12345",
        actor="test_admin",
    )
    test_db.commit()

    assert res1["idempotent_replay"] is False
    assert res2["idempotent_replay"] is True
    assert res2["status"] == "COMPLETED"
