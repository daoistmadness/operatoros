import pytest
from datetime import date, time, datetime, timedelta
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from core.database import Base
from core.early_departure_migration import ensure_early_departure_tables_exist
from models.dismissal_policy import DismissalPolicy, DismissalPolicyAudit
from models.early_departure_excuse import EarlyDepartureExcuse, EarlyDepartureExcuseAudit
from models.attendance import Attendance
from models.student import Student
from models.user import User
from models.attendance_review import AttendanceOverride, AttendanceCorrectionRequest, AttendancePeriod
from models.teacher_class_assignment import TeacherClassAssignment
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.jenjang import Jenjang
from models.academic_year import AcademicYear

from services.dismissal_policy import (
    create_dismissal_policy, deactivate_dismissal_policy, list_dismissal_policies
)
from services.early_departure_excuse import (
    record_early_departure_excuse, revoke_early_departure_excuse
)
from services.early_departure_resolver import (
    resolve_departure_status, find_applicable_dismissal_policy
)


@pytest.fixture
def db_session():
    """Isolated synthetic in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)

    # Attach append-only triggers for audit tables
    with engine.begin() as conn:
        for table in ("dismissal_policy_audits", "early_departure_excuse_audits"):
            conn.execute(text(f"CREATE TRIGGER trg_{table}_no_update BEFORE UPDATE ON {table} BEGIN SELECT RAISE(FAIL, '{table} is append-only'); END;"))
            conn.execute(text(f"CREATE TRIGGER trg_{table}_no_delete BEFORE DELETE ON {table} BEGIN SELECT RAISE(FAIL, '{table} is append-only'); END;"))

    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed minimum test data
    jenjang = Jenjang(id=1, name="Primary", code="SD", level=1, active=True)
    session.add(jenjang)
    session.flush()

    student = Student(id=101, name="Budi Santoso", class_name="7A", jenjang="Primary")
    session.add(student)

    admin_user = User(id=1, username="admin1", role="admin", password_hash="pw")
    teacher_user = User(id=2, username="teacher1", role="staff", password_hash="pw")
    session.add_all([admin_user, teacher_user])
    session.commit()

    yield session
    session.close()


def test_dismissal_policy_creation_and_overlap_rejection(db_session):
    # Create active policy for Primary on Monday (weekday 0)
    p1 = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=0,
        dismissal_time=time(14, 0),
        grace_period_minutes=15,
        effective_from=date(2026, 1, 1),
        effective_to=None,
        change_reason="Standard 2026 schedule",
        actor="admin1",
    )
    assert p1.id is not None
    assert p1.is_active is True

    # Attempting to create an overlapping active policy for same jenjang + weekday must raise DISMISSAL_POLICY_OVERLAP
    with pytest.raises(ValueError, match="DISMISSAL_POLICY_OVERLAP"):
        create_dismissal_policy(
            db=db_session,
            jenjang="Primary",
            weekday=0,
            dismissal_time=time(13, 30),
            grace_period_minutes=10,
            effective_from=date(2026, 2, 1),
            actor="admin1",
        )

    # Deactivating p1 should allow a new policy
    deactivate_dismissal_policy(db_session, policy_id=p1.id, change_reason="Replaced", actor="admin1")
    assert p1.is_active is False

    p2 = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=0,
        dismissal_time=time(13, 30),
        grace_period_minutes=10,
        effective_from=date(2026, 2, 1),
        actor="admin1",
    )
    assert p2.id is not None
    assert p2.is_active is True


def test_canonical_resolver_classifications(db_session):
    # Setup policy for Primary on Friday (weekday 4): Dismissal 11:30, grace 15m -> threshold 11:15
    policy = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=4,
        dismissal_time=time(11, 30),
        grace_period_minutes=15,
        effective_from=date(2026, 1, 1),
        actor="admin1",
    )

    test_date = date(2026, 7, 24)  # Friday (weekday 4)

    # 1. On-time departure (scan out 11:20 >= 11:15)
    att_ontime = Attendance(id=1, student_id=101, date=test_date, check_in=time(7, 0), check_out=time(11, 20), status="Hadir")
    res_ontime = resolve_departure_status(attendance=att_ontime, policy=policy)
    assert res_ontime["classification"] == "ON_TIME_DEPARTURE"
    assert res_ontime["minutes_early"] == 0

    # 2. Early departure (scan out 10:30 < 11:15 -> 60 minutes early from 11:30)
    att_early = Attendance(id=2, student_id=101, date=test_date, check_in=time(7, 0), check_out=time(10, 30), status="Hadir")
    res_early = resolve_departure_status(attendance=att_early, policy=policy)
    assert res_early["classification"] == "EARLY_DEPARTURE"
    assert res_early["minutes_early"] == 60

    # 3. Missing checkout (check_in present, check_out None)
    att_missing = Attendance(id=3, student_id=101, date=test_date, check_in=time(7, 0), check_out=None, status="Hadir")
    res_missing = resolve_departure_status(attendance=att_missing, policy=policy)
    assert res_missing["classification"] == "MISSING_CHECKOUT"

    # 4. Unknown policy (no policy matching date/weekday)
    res_nopolicies = resolve_departure_status(attendance=att_early, policy=None)
    assert res_nopolicies["classification"] == "UNKNOWN_POLICY"

    # 5. Full day absence -> NOT_APPLICABLE
    att_sakit = Attendance(id=4, student_id=101, date=test_date, check_in=None, check_out=None, status="Sakit")
    res_sakit = resolve_departure_status(attendance=att_sakit, policy=policy)
    assert res_sakit["classification"] == "NOT_APPLICABLE"


def test_excuse_recording_revocation_and_invariants(db_session):
    policy = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=4,
        dismissal_time=time(11, 30),
        grace_period_minutes=15,
        effective_from=date(2026, 1, 1),
        actor="admin1",
    )

    test_date = date(2026, 7, 24)
    att = Attendance(id=10, student_id=101, date=test_date, check_in=time(7, 0), check_out=time(10, 0), status="Hadir")
    db_session.add(att)
    db_session.commit()

    # Initial classification -> EARLY_DEPARTURE
    res0 = resolve_departure_status(attendance=att, policy=policy)
    assert res0["classification"] == "EARLY_DEPARTURE"

    # Record excuse
    excuse = record_early_departure_excuse(
        db=db_session,
        attendance_id=att.id,
        reason_code="MEDICAL",
        explanation="Dokter gigi",
        actor="teacher1",
    )
    assert excuse.state == "ACTIVE"

    # Re-evaluate -> EXCUSED_EARLY_DEPARTURE
    res1 = resolve_departure_status(attendance=att, policy=policy, active_excuse=excuse)
    assert res1["classification"] == "EXCUSED_EARLY_DEPARTURE"
    assert res1["excuse"]["reason_code"] == "MEDICAL"

    # Attempting second active excuse must fail (invariant: max 1 active excuse)
    with pytest.raises(ValueError, match="EARLY_DEPARTURE_EXCUSE_ALREADY_ACTIVE"):
        record_early_departure_excuse(
            db=db_session,
            attendance_id=att.id,
            reason_code="FAMILY_EMERGENCY",
            actor="teacher1",
        )

    # Revoke excuse
    revoked = revoke_early_departure_excuse(
        db=db_session,
        excuse_id=excuse.id,
        revocation_reason="Salah catat",
        actor="teacher1",
    )
    assert revoked.state == "REVOKED"

    # Re-evaluate -> returns back to EARLY_DEPARTURE
    res2 = resolve_departure_status(attendance=att, policy=policy, active_excuse=None)
    assert res2["classification"] == "EARLY_DEPARTURE"


def test_override_effect_and_pending_correction_isolation(db_session):
    policy = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=4,
        dismissal_time=time(11, 30),
        grace_period_minutes=15,
        effective_from=date(2026, 1, 1),
        actor="admin1",
    )

    test_date = date(2026, 7, 24)
    att = Attendance(id=20, student_id=101, date=test_date, check_in=time(7, 0), check_out=time(10, 0), status="Hadir")
    db_session.add(att)
    db_session.commit()

    # Approved override changes effective check_out to 11:30 (on-time)
    ovr = AttendanceOverride(
        attendance_id=att.id,
        original_status="Hadir",
        override_status="Hadir",
        override_check_out=time(11, 30),
        note="Perbaikan scan",
        reviewed_by="admin1",
    )
    db_session.add(ovr)
    db_session.commit()

    # Pending correction request exists
    req = AttendanceCorrectionRequest(
        attendance_id=att.id,
        original_snapshot={},
        original_fingerprint="fp",
        proposed_status="Hadir",
        reason_code="MEDICAL",
        explanation="keterangan",
        requester="teacher1",
        state="SUBMITTED",
    )
    db_session.add(req)
    db_session.commit()

    res = resolve_departure_status(attendance=att, override=ovr, policy=policy, has_pending_correction=True)
    assert res["classification"] == "ON_TIME_DEPARTURE"
    assert res["effective_check_out"] == "11:30"
    assert res["has_override"] is True
    assert res["has_pending_correction"] is True


def test_append_only_audit_triggers(db_session):
    policy = create_dismissal_policy(
        db=db_session,
        jenjang="Primary",
        weekday=0,
        dismissal_time=time(14, 0),
        grace_period_minutes=10,
        effective_from=date(2026, 1, 1),
        actor="admin1",
    )

    audit = db_session.query(DismissalPolicyAudit).filter(DismissalPolicyAudit.policy_id == policy.id).first()
    assert audit is not None

    # Updating or deleting audit row must be rejected by trigger
    with pytest.raises(Exception):
        db_session.execute(text("UPDATE dismissal_policy_audits SET actor = 'hacked' WHERE id = :id"), {"id": audit.id})

    with pytest.raises(Exception):
        db_session.execute(text("DELETE FROM dismissal_policy_audits WHERE id = :id"), {"id": audit.id})


def test_finalized_period_blocks_non_admin_excuses(db_session):
    test_date = date(2026, 7, 24)
    att = Attendance(id=30, student_id=101, date=test_date, check_in=time(7, 0), check_out=time(10, 0), status="Hadir")
    period = AttendancePeriod(attendance_date=test_date, status="FINALIZED", finalized_by="admin1")
    db_session.add_all([att, period])
    db_session.commit()

    # Non-admin attempt to record excuse on finalized date must raise ATTENDANCE_PERIOD_FINALIZED
    with pytest.raises(ValueError, match="ATTENDANCE_PERIOD_FINALIZED"):
        record_early_departure_excuse(
            db=db_session,
            attendance_id=att.id,
            reason_code="MEDICAL",
            actor="teacher1",
            is_admin_or_override=False,
        )

    # Admin override attempt succeeds
    excuse = record_early_departure_excuse(
        db=db_session,
        attendance_id=att.id,
        reason_code="MEDICAL",
        actor="admin1",
        is_admin_or_override=True,
    )
    assert excuse.id is not None
