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


def seed_academic(db_path) -> None:
    from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
    from models.academic_year import AcademicYear
    from models.jenjang import Jenjang
    from models.student import Student
    from models.student_enrollment import StudentEnrollment
    from models.student_master import StudentDeviceIdentity, StudentMaster

    db = _session(db_path)
    try:
        _add_users(db)
        y1 = AcademicYear(label="2025/2026-academic", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), is_default=False)
        y2 = AcademicYear(label="2026/2027-academic", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), is_default=False)
        j_smp = Jenjang(name="SMP", code="SMP", level="junior")
        db.add_all([y1, y2, j_smp])
        db.flush()
        program = AcademicProgram(jenjang_id=j_smp.id, name="SMP Program")
        db.add(program)
        db.flush()
        grade = AcademicGrade(jenjang_id=j_smp.id, program_id=program.id, name="Grade 7", sequence_number=1)
        db.add(grade)
        db.flush()
        aclass = AcademicClass(academic_year_id=y2.id, grade_id=grade.id, class_name="7A", active=True)
        db.add(aclass)
        db.flush()

        m1 = "11111111-1111-1111-1111-111111111111"
        m2 = "22222222-2222-2222-2222-222222222222"
        masters = {}
        for mid in (m1, m2):
            row = StudentMaster(id=mid, full_name=f"Academic Master {mid[:4]}", normalized_name=f"academic master {mid[:4]}", student_status="active")
            db.add(row)
            masters[mid] = row
        db.flush()

        def _legacy(sid, name, master_id=None):
            student = Student(id=sid, name=name, jenjang="SMP", class_name="7A")
            db.add(student)
            db.flush()
            if master_id:
                db.add(StudentDeviceIdentity(
                    student_master_id=master_id, legacy_student_id=sid,
                    device_identifier=str(sid), device_source="attendance_device",
                    effective_from=date(2026, 1, 1), is_active=True,
                ))
            db.flush()
            return student

        s_link = _legacy(701, "Linked Student", m1)
        _legacy(702, "Unlinked Student")
        _legacy(703, "Ambiguous Student", m2)
        _legacy(704, "Second Ambiguous Student")

        ended = StudentEnrollment(
            student_master_id=m1, academic_year_id=y1.id, jenjang_id=j_smp.id,
            class_name="7A-old", lifecycle_state="ENDED",
            effective_from=date(2025, 7, 1), effective_to=date(2026, 6, 30),
        )
        active = StudentEnrollment(
            student_master_id=m1, academic_year_id=y2.id, jenjang_id=j_smp.id,
            academic_class_id=aclass.id, class_name="7A", lifecycle_state="ACTIVE",
            effective_from=date(2026, 7, 1),
        )
        db.add_all([ended, active])
        db.commit()
    finally:
        db.close()


def seed_reports(db_path) -> None:
    from models.absence_reason import AbsenceReason
    from models.absence_reason_class_entry import AbsenceReasonClassEntry
    from models.academic_year import AcademicYear
    from models.attendance import Attendance
    from models.heb_override import HebOverride
    from models.jenjang import Jenjang
    from models.student import Student
    from models.student_enrollment import StudentEnrollment
    from models.student_master import StudentMaster

    db = _session(db_path)
    try:
        _add_users(db)
        year = AcademicYear(label="2026/2027-reports", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), is_default=False)
        db.add(year)
        db.flush()
        j_smp = Jenjang(name="SMP", code="SMP", level="junior")
        j_sd = Jenjang(name="SD", code="SD", level="primary")
        db.add_all([j_smp, j_sd])
        db.flush()

        def _add_enrolled(name, mid, jenjang, cls):
            master = StudentMaster(id=mid, full_name=name, normalized_name=name.lower(), student_status="active")
            db.add(master)
            db.flush()
            student = Student(name=name, jenjang=jenjang.name, class_name=cls)
            db.add(student)
            db.flush()
            enr = StudentEnrollment(student_id=student.id, student_master_id=master.id, academic_year_id=year.id, jenjang_id=jenjang.id, class_name=cls, lifecycle_state="ACTIVE")
            db.add(enr)
            db.flush()
            return enr, student

        _, s_a1 = _add_enrolled("Alice SMP7A", "00000000-0000-0000-0000-000000000101", j_smp, "7A")
        _, s_a2 = _add_enrolled("Bob SMP7A", "00000000-0000-0000-0000-000000000102", j_smp, "7A")
        _, s_a3 = _add_enrolled("Charlie SMP7A", "00000000-0000-0000-0000-000000000103", j_smp, "7A")
        _, s_b1 = _add_enrolled("Dina SMP7B", "00000000-0000-0000-0000-000000000104", j_smp, "7B")
        _, s_b2 = _add_enrolled("Eko SMP7B", "00000000-0000-0000-0000-000000000105", j_smp, "7B")
        _, s_c1 = _add_enrolled("Fajar SD1A", "00000000-0000-0000-0000-000000000201", j_sd, "1A")
        _, s_c2 = _add_enrolled("Gina SD1A", "00000000-0000-0000-0000-000000000202", j_sd, "1A")
        db.commit()

        def _att(student, d, status, late=0):
            ci = time(7, 45) if status == "late" else (time(7, 30) if status in ("on-time", "incomplete") else None)
            co = time(15, 0) if status in ("on-time", "late") else None
            db.add(Attendance(student_id=student.id, date=d, check_in=ci, check_out=co, late_duration=late if status == "late" else 0, late_source="calculated" if status == "late" else "none", is_absent=False, status=status, week="31"))

        for s in [s_a1, s_a2, s_a3]:
            for i in range(3):
                _att(s, date(2026, 8, 1+i), "on-time")
            _att(s, date(2026, 8, 5), "late", late=15)
        for s in [s_b1, s_b2]:
            _att(s, date(2026, 8, 1), "on-time")
            _att(s, date(2026, 8, 2), "incomplete")
        for s in [s_c1, s_c2]:
            _att(s, date(2026, 8, 1), "on-time")
            _att(s, date(2026, 8, 3), "late", late=20)
            _att(s, date(2026, 8, 5), "incomplete")

        db.add_all([
            AbsenceReasonClassEntry(class_name="7A", month=8, year=2026, sakit=2, izin=1, alfa=0, entered_by="golden-seed"),
            AbsenceReasonClassEntry(class_name="7B", month=8, year=2026, sakit=0, izin=0, alfa=1, entered_by="golden-seed"),
            AbsenceReasonClassEntry(class_name="1A", month=8, year=2026, sakit=1, izin=1, alfa=1, entered_by="golden-seed"),
        ])
        db.add_all([
            AbsenceReason(student_id=s_a1.id, class_name="7A", month=8, year=2026, sakit=1, izin=0, alfa=0, entered_by="golden-seed"),
            AbsenceReason(student_id=s_a2.id, class_name="7A", month=8, year=2026, sakit=1, izin=1, alfa=0, entered_by="golden-seed"),
            AbsenceReason(student_id=s_b1.id, class_name="7B", month=8, year=2026, sakit=0, izin=0, alfa=1, entered_by="golden-seed"),
            AbsenceReason(student_id=s_c1.id, class_name="1A", month=8, year=2026, sakit=1, izin=1, alfa=0, entered_by="golden-seed"),
        ])
        db.add(HebOverride(jenjang="SMP", month=8, year=2026, heb_value=18, note="reports golden SMP", set_by="golden-seed"))
        db.add(HebOverride(jenjang="SD", month=8, year=2026, heb_value=15, note="reports golden SD", set_by="golden-seed"))
        db.commit()
    finally:
        db.close()
