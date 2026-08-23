"""Deterministic seed functions for replay scenarios.

Each seed receives the disposable database path. Models are already imported
and the schema bootstrapped by the harness adapter before seeds run.
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ADMIN_PASS = "golden-admin-pass-1"
STAFF_PASS = "golden-staff-pass-1"


def _session(db_path):
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    return sessionmaker(bind=engine)()


def _hash(password: str) -> str:
    from argon2 import PasswordHasher

    return PasswordHasher().hash(password)


def _add_users(db) -> None:
    from models.user import User

    db.add_all(
        [
            User(username="golden-admin", password_hash=_hash(ADMIN_PASS), role="admin"),
            User(username="golden-staff", password_hash=_hash(STAFF_PASS), role="staff"),
            User(
                username="golden-inactive",
                password_hash=_hash("golden-inactive-pass"),
                role="staff",
                is_active=False,
            ),
        ]
    )
    db.commit()


def seed_none(db_path) -> None:
    return None


def seed_auth_users(db_path) -> None:
    db = _session(db_path)
    try:
        _add_users(db)
    finally:
        db.close()


def _seed_student_with_identity(db, sid: int, name: str, jenjang: str, class_name: str) -> None:
    from models.student import Student
    from models.student_master import StudentDeviceIdentity, StudentMaster

    master = StudentMaster(full_name=name, normalized_name=name.lower(), student_status="active")
    db.add(master)
    db.flush()
    db.add(
        StudentDeviceIdentity(
            student_master_id=master.id,
            legacy_student_id=sid,
            device_identifier=str(sid),
            device_source="attendance_device",
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.add(Student(id=sid, name=name, jenjang=jenjang, class_name=class_name))
    db.flush()


def seed_attendance_review(db_path) -> None:
    from models.attendance import Attendance

    db = _session(db_path)
    try:
        _add_users(db)
        _seed_student_with_identity(db, 7001, "Review Student", "SMP", "SMP7A")
        db.add_all(
            [
                Attendance(
                    student_id=7001, date=date(2026, 6, 15),
                    check_in=time(7, 40), check_out=time(16, 0),
                    late_duration=25, late_source="calculated",
                    is_absent=False, week="25", status="late",
                ),
                Attendance(
                    student_id=7001, date=date(2026, 6, 16),
                    check_in=time(7, 30), check_out=None,
                    late_duration=0, late_source="none",
                    is_absent=False, week="25", status="incomplete",
                ),
                Attendance(
                    student_id=7001, date=date(2026, 6, 17),
                    check_in=time(7, 30), check_out=None,
                    late_duration=0, late_source="none",
                    is_absent=False, week="25", status="incomplete",
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


def seed_corrections(db_path) -> None:
    from models.attendance import Attendance
    from models.attendance_review import AttendanceCorrectionRequest

    db = _session(db_path)
    try:
        _add_users(db)
        _seed_student_with_identity(db, 8001, "Correction Student", "SMP", "SMP8")
        db.add_all(
            [
                Attendance(
                    student_id=8001, date=date(2026, 6, 15),
                    check_in=time(7, 40), check_out=time(16, 0),
                    late_duration=25, late_source="calculated",
                    is_absent=False, week="25", status="late",
                ),
                Attendance(
                    student_id=8001, date=date(2026, 6, 16),
                    check_in=time(7, 50), check_out=time(16, 0),
                    late_duration=35, late_source="calculated",
                    is_absent=False, week="25", status="late",
                ),
                Attendance(
                    student_id=8001, date=date(2026, 6, 17),
                    check_in=time(7, 45), check_out=time(16, 0),
                    late_duration=30, late_source="calculated",
                    is_absent=False, week="25", status="late",
                ),
            ]
        )
        db.commit()
        snapshot = {"status": "late", "check_in": "07:40", "check_out": "16:00"}
        db.add_all(
            [
                AttendanceCorrectionRequest(
                    attendance_id=1, active_key="corr:att:1",
                    original_snapshot=snapshot, original_fingerprint="fingerprint-att-1",
                    proposed_status="on-time", proposed_check_in=time(7, 40),
                    reason_code="DEVICE_FAULT",
                    explanation="Device failed to register on-time scan.",
                    requester="golden-staff", submitted_at=datetime.utcnow(),
                    state="SUBMITTED",
                ),
                AttendanceCorrectionRequest(
                    attendance_id=2, active_key="corr:att:2",
                    original_snapshot={"status": "late"}, original_fingerprint="fingerprint-att-2",
                    proposed_status="on-time",
                    reason_code="DEVICE_FAULT",
                    explanation="Second pending correction.",
                    requester="golden-staff", submitted_at=datetime.utcnow(),
                    state="SUBMITTED",
                ),
                AttendanceCorrectionRequest(
                    attendance_id=3, active_key=None,
                    original_snapshot={"status": "late"}, original_fingerprint="fingerprint-att-3",
                    proposed_status="on-time",
                    reason_code="DEVICE_FAULT",
                    explanation="Draft correction awaiting submit.",
                    requester="golden-staff",
                    state="DRAFT",
                ),
            ]
        )
        db.commit()
    finally:
        db.close()
