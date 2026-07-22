import json
import sqlite3
from datetime import date

import pytest
from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import Base
from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment, StudentEnrollmentLifecycleAudit
from models.student_master import StudentEnrollmentClassHistory, StudentMaster
from models.student_progression import StudentProgressionAudit, StudentProgressionMappingRule
from services.student_progression import (
    CROSS_JENJANG_CONFIRMATION,
    GRADUATION_CONFIRMATION,
    STANDARD_CONFIRMATION,
    build_progression_rows,
    commit_progression_batch,
    create_progression_preview,
    patch_progression_row,
    revalidate_progression_preview,
)
from api.student_progression import router as progression_router
from core.database import get_db
from models.user import User
from security.dependencies import get_current_user


@pytest.fixture
def progression_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    source_year = AcademicYear(label="2026/2027", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), status="active", is_default=True)
    destination_year = AcademicYear(label="2027/2028", start_date=date(2027, 7, 1), end_date=date(2028, 6, 30), status="upcoming", is_default=False)
    closed_year = AcademicYear(label="2028/2029", start_date=date(2028, 7, 1), end_date=date(2029, 6, 30), status="closed", is_default=False)
    primary = Jenjang(name="Progression Primary")
    secondary = Jenjang(name="Progression Secondary")
    db.add_all([source_year, destination_year, closed_year, primary, secondary]); db.flush()
    primary_program = AcademicProgram(jenjang_id=primary.id, name="Primary Program", active=True)
    secondary_program = AcademicProgram(jenjang_id=secondary.id, name="Secondary Program", active=True)
    db.add_all([primary_program, secondary_program]); db.flush()
    grade_one = AcademicGrade(jenjang_id=primary.id, program_id=primary_program.id, name="Grade 1", sequence_number=1, active=True)
    grade_two = AcademicGrade(jenjang_id=primary.id, program_id=primary_program.id, name="Grade 2", sequence_number=2, active=True)
    secondary_grade = AcademicGrade(jenjang_id=secondary.id, program_id=secondary_program.id, name="Grade 7", sequence_number=1, active=True)
    db.add_all([grade_one, grade_two, secondary_grade]); db.flush()
    classes = {
        "source_one": AcademicClass(academic_year_id=source_year.id, grade_id=grade_one.id, class_name="Source 1A", section_code="A", active=True),
        "source_two": AcademicClass(academic_year_id=source_year.id, grade_id=grade_two.id, class_name="Source 2A", section_code="A", active=True),
        "destination_one": AcademicClass(academic_year_id=destination_year.id, grade_id=grade_one.id, class_name="Destination 1A", section_code="A", active=True),
        "destination_two": AcademicClass(academic_year_id=destination_year.id, grade_id=grade_two.id, class_name="Destination 2A", section_code="A", active=True),
        "destination_secondary": AcademicClass(academic_year_id=destination_year.id, grade_id=secondary_grade.id, class_name="Destination 7A", section_code="A", active=True),
    }
    db.add_all(list(classes.values())); db.commit()

    def enroll(name: str, class_key: str, *, device_id: int | None = None):
        student = StudentMaster(full_name=name, normalized_name=name.casefold(), student_status="active", created_by="test", updated_by="test")
        db.add(student); db.flush()
        academic_class = classes[class_key]
        grade = db.get(AcademicGrade, academic_class.grade_id)
        enrollment = StudentEnrollment(
            student_id=device_id,
            student_master_id=student.id,
            academic_year_id=source_year.id,
            jenjang_id=grade.jenjang_id,
            academic_class_id=academic_class.id,
            class_name=academic_class.class_name,
            class_assigned=True,
            effective_from=source_year.start_date,
            lifecycle_state="ACTIVE",
            lifecycle_effective_date=source_year.start_date,
        )
        db.add(enrollment); db.flush()
        db.add(StudentEnrollmentClassHistory(enrollment_id=enrollment.id, class_name=enrollment.class_name, effective_from=source_year.start_date, changed_by="test", source="synthetic"))
        db.commit()
        return student, enrollment

    yield db, source_year, destination_year, closed_year, primary, secondary, primary_program, secondary_program, grade_one, grade_two, secondary_grade, classes, enroll
    db.close(); Base.metadata.drop_all(engine)


def test_preview_is_deterministic_non_mutating_and_device_optional(progression_db):
    db, source, destination, _closed, *_rest, enroll = progression_db
    _student_one, first = enroll("Promotion Student", "source_one")
    _student_two, terminal = enroll("Graduation Student", "source_two")
    before = [(row.id, row.lifecycle_state, row.academic_year_id) for row in db.query(StudentEnrollment).order_by(StudentEnrollment.id)]
    rows_one = build_progression_rows(db, source.id, destination.id)
    rows_two = build_progression_rows(db, source.id, destination.id)
    assert rows_one == rows_two
    assert [row["source_enrollment_id"] for row in rows_one] == [first.id, terminal.id]
    assert {row["proposed_outcome"] for row in rows_one} == {"PROMOTE", "GRADUATE"}
    assert all(row["device_linked"] is False for row in rows_one)
    batch = create_progression_preview(db, source.id, destination.id, [], "admin")
    assert batch.summary["total"] == 2 and batch.preview_version == 1
    assert before == [(row.id, row.lifecycle_state, row.academic_year_id) for row in db.query(StudentEnrollment).order_by(StudentEnrollment.id)]


def test_year_mapping_conflicts_and_manual_review(progression_db):
    db, source, destination, closed, primary, secondary, primary_program, secondary_program, grade_one, _grade_two, secondary_grade, classes, enroll = progression_db
    _student, enrollment = enroll("Mapping Student", "source_one")
    with pytest.raises(HTTPException) as same_year:
        build_progression_rows(db, source.id, source.id)
    assert same_year.value.detail["code"] == "ACADEMIC_YEARS_MUST_DIFFER"
    with pytest.raises(HTTPException) as closed_year:
        build_progression_rows(db, source.id, closed.id)
    assert closed_year.value.detail["code"] == "DESTINATION_YEAR_CLOSED"
    db.add(StudentProgressionMappingRule(
        source_jenjang_id=primary.id, destination_jenjang_id=secondary.id,
        source_program_id=primary_program.id, destination_program_id=secondary_program.id,
        source_grade_id=grade_one.id, destination_grade_id=secondary_grade.id,
        outcome="CROSS_JENJANG", active=True, created_by="admin", approved_by="admin",
    )); db.commit()
    row = build_progression_rows(db, source.id, destination.id)[0]
    assert row["proposed_outcome"] == "CROSS_JENJANG"
    assert row["mapping_source"] == "SAVED_RULE"
    assert row["destination_class_id"] == classes["destination_secondary"].id
    enrollment.academic_class_id = None; db.commit()
    manual = build_progression_rows(db, source.id, destination.id)[0]
    assert manual["validation_result"] == "MANUAL_REVIEW"


def test_preview_detects_duplicate_existing_missing_archived_and_invalid_graduation(progression_db):
    db, source, destination, _closed, primary, _secondary, primary_program, _secondary_program, grade_one, grade_two, _secondary_grade, classes, enroll = progression_db
    student, enrollment = enroll("Conflict Student", "source_one")
    with pytest.raises(HTTPException) as duplicate:
        build_progression_rows(db, source.id, destination.id, source_enrollment_ids=[enrollment.id, enrollment.id])
    assert duplicate.value.detail["code"] == "DUPLICATE_SOURCE_ENROLLMENT"

    extra_class = AcademicClass(
        academic_year_id=destination.id,
        grade_id=grade_two.id,
        class_name="Destination 2B",
        section_code="B",
        active=True,
    )
    db.add(extra_class); db.commit()
    missing = build_progression_rows(db, source.id, destination.id)[0]
    assert "DESTINATION_CLASS_REQUIRED" in missing["conflict_codes"]

    classes["destination_one"].active = False; db.commit()
    archived = build_progression_rows(db, source.id, destination.id, [{
        "source_enrollment_id": enrollment.id,
        "outcome": "RETAIN",
        "destination_jenjang_id": primary.id,
        "destination_program_id": primary_program.id,
        "destination_grade_id": grade_one.id,
        "destination_class_id": classes["destination_one"].id,
        "reason_code": "RETENTION_APPROVED",
        "reason": "Reviewed retention",
    }])[0]
    assert "CONFIGURATION_ARCHIVED" in archived["conflict_codes"]
    invalid_graduation = build_progression_rows(db, source.id, destination.id, [{
        "source_enrollment_id": enrollment.id,
        "outcome": "GRADUATE",
        "reason_code": "GRADUATION_REVIEWED",
        "reason": "Reviewed graduation",
    }])[0]
    assert "GRADUATION_NOT_ALLOWED" in invalid_graduation["conflict_codes"]

    classes["destination_one"].active = True; db.add(StudentEnrollment(
        student_master_id=student.id,
        academic_year_id=destination.id,
        jenjang_id=primary.id,
        academic_class_id=classes["destination_one"].id,
        class_name=classes["destination_one"].class_name,
        class_assigned=True,
        effective_from=destination.start_date,
        lifecycle_state="ACTIVE",
        lifecycle_effective_date=destination.start_date,
    )); db.commit()
    existing = build_progression_rows(db, source.id, destination.id)[0]
    assert "DESTINATION_ENROLLMENT_EXISTS" in existing["conflict_codes"]


def test_versioned_override_stale_detection_and_retention_reason(progression_db):
    db, source, destination, _closed, primary, _secondary, primary_program, _secondary_program, grade_one, *_tail = progression_db
    classes, enroll = progression_db[-2], progression_db[-1]
    _student, _enrollment = enroll("Retained Student", "source_one")
    batch = create_progression_preview(db, source.id, destination.id, [], "admin")
    patched = patch_progression_row(db, batch, 1, 1, {
        "outcome": "RETAIN",
        "destination_jenjang_id": primary.id,
        "destination_program_id": primary_program.id,
        "destination_grade_id": grade_one.id,
        "destination_class_id": classes["destination_one"].id,
    })
    assert patched.preview_version == 2
    assert patched.rows[0]["conflict_codes"] == ["RETENTION_REASON_REQUIRED"]
    with pytest.raises(HTTPException) as stale:
        patch_progression_row(db, batch, 1, 1, {"reason_code": "RETAINED_BY_REVIEW"})
    assert stale.value.detail["code"] == "PROGRESSION_PREVIEW_STALE"
    patched = patch_progression_row(db, batch, 1, 2, {"reason_code": "RETAINED_BY_REVIEW", "reason": "Academic support plan"})
    assert patched.rows[0]["validation_result"] == "VALID"
    revalidated = revalidate_progression_preview(db, batch, 3)
    assert revalidated.preview_version == 4


def test_atomic_commit_preserves_source_history_and_is_idempotent(progression_db):
    db, source, destination, _closed, *_rest, enroll = progression_db
    student_one, source_one = enroll("Promotion Student", "source_one")
    student_two, source_two = enroll("Graduation Student", "source_two")
    source_history_ids = [row.id for row in db.query(StudentEnrollmentClassHistory).order_by(StudentEnrollmentClassHistory.id)]
    batch = create_progression_preview(db, source.id, destination.id, [], "admin")
    result = commit_progression_batch(db, batch, 1, destination.start_date, GRADUATION_CONFIRMATION, "admin")
    assert result["destination_enrollments_created"] == 1
    assert result["graduated"] == 1
    assert db.get(StudentEnrollment, source_one.id).lifecycle_state == "ENDED"
    assert db.get(StudentEnrollment, source_two.id).lifecycle_state == "GRADUATED"
    destination_enrollment = db.query(StudentEnrollment).filter_by(student_master_id=student_one.id, academic_year_id=destination.id).one()
    assert destination_enrollment.id != source_one.id
    assert db.query(StudentEnrollment).filter_by(student_master_id=student_two.id, academic_year_id=destination.id).count() == 0
    assert source_history_ids == [row.id for row in db.query(StudentEnrollmentClassHistory).filter(StudentEnrollmentClassHistory.enrollment_id.in_((source_one.id, source_two.id))).order_by(StudentEnrollmentClassHistory.id)]
    assert db.query(StudentEnrollmentLifecycleAudit).count() == 2
    assert db.query(StudentProgressionAudit).count() == 2
    enrollment_count = db.query(StudentEnrollment).count()
    assert commit_progression_batch(db, batch, 1, destination.start_date, "IGNORED_ON_IDEMPOTENT_REPEAT", "admin") == result
    assert db.query(StudentEnrollment).count() == enrollment_count


def test_cross_jenjang_override_and_stronger_confirmation(progression_db):
    db, source, destination, _closed, _primary, secondary, _primary_program, secondary_program, _grade_one, _grade_two, secondary_grade, classes, enroll = progression_db
    student, source_enrollment = enroll("Cross Jenjang Student", "source_two")
    override = [{
        "source_enrollment_id": source_enrollment.id,
        "outcome": "CROSS_JENJANG",
        "destination_jenjang_id": secondary.id,
        "destination_program_id": secondary_program.id,
        "destination_grade_id": secondary_grade.id,
        "destination_class_id": classes["destination_secondary"].id,
        "reason_code": "APPROVED_TRANSITION",
        "reason": "Reviewed transition",
    }]
    batch = create_progression_preview(db, source.id, destination.id, override, "admin")
    with pytest.raises(HTTPException) as confirmation:
        commit_progression_batch(db, batch, 1, destination.start_date, STANDARD_CONFIRMATION, "admin")
    assert confirmation.value.detail["code"] == "CONFIRMATION_REQUIRED"
    result = commit_progression_batch(db, batch, 1, destination.start_date, CROSS_JENJANG_CONFIRMATION, "admin")
    target = db.query(StudentEnrollment).filter_by(student_master_id=student.id, academic_year_id=destination.id).one()
    assert result["cross_jenjang"] == 1 and target.jenjang_id == secondary.id


def test_commit_rolls_back_every_row_on_injected_failure(progression_db, monkeypatch):
    db, source, destination, _closed, *_rest, enroll = progression_db
    _student_one, first = enroll("Rollback One", "source_one")
    _student_two, second = enroll("Rollback Two", "source_one")
    batch = create_progression_preview(db, source.id, destination.id, [], "admin")
    calls = {"count": 0}

    def fail_second(_row):
        calls["count"] += 1
        if calls["count"] == 2:
            raise RuntimeError("synthetic write failure")

    monkeypatch.setitem(commit_progression_batch.__globals__, "_before_progression_write", fail_second)
    with pytest.raises(HTTPException) as failed:
        commit_progression_batch(db, batch, 1, destination.start_date, STANDARD_CONFIRMATION, "admin")
    assert failed.value.detail["code"] == "PROGRESSION_TRANSACTION_FAILED"
    assert db.query(StudentEnrollment).filter_by(academic_year_id=destination.id).count() == 0
    assert db.get(StudentEnrollment, first.id).lifecycle_state == "ACTIVE"
    assert db.get(StudentEnrollment, second.id).lifecycle_state == "ACTIVE"
    assert db.query(StudentProgressionAudit).count() == 0


def test_commit_revalidates_archived_destination_inside_transaction(progression_db):
    db, source, destination, _closed, *_rest, enroll = progression_db
    _student, source_enrollment = enroll("Configuration Race Student", "source_one")
    batch = create_progression_preview(db, source.id, destination.id, [], "admin")
    destination_class = db.get(AcademicClass, batch.rows[0]["destination_class_id"])
    destination_class.active = False; db.commit()
    with pytest.raises(HTTPException) as conflict:
        commit_progression_batch(db, batch, 1, destination.start_date, STANDARD_CONFIRMATION, "admin")
    assert conflict.value.detail["code"] == "PROGRESSION_CONFLICT_UNRESOLVED"
    assert db.get(StudentEnrollment, source_enrollment.id).lifecycle_state == "ACTIVE"
    assert db.query(StudentEnrollment).filter_by(academic_year_id=destination.id).count() == 0
    assert db.query(StudentProgressionAudit).count() == 0


def test_progression_api_preview_filter_commit_and_result(progression_db):
    db, source, destination, _closed, *_rest, enroll = progression_db
    enroll("API Promotion Student", "source_one")
    enroll("API Graduation Student", "source_two")
    app = FastAPI()
    app.include_router(progression_router, prefix="/api/student-progression")
    user = User(id=1, username="admin", role="admin", password_hash="unused", is_active=True)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    created = client.post("/api/student-progression/previews", json={
        "source_academic_year_id": source.id,
        "destination_academic_year_id": destination.id,
        "overrides": [],
    })
    assert created.status_code == 201
    payload = created.json()
    assert payload["summary"]["outcomes"] == {"GRADUATE": 1, "PROMOTE": 1}
    batch_id = payload["batch_id"]
    filtered = client.get(f"/api/student-progression/previews/{batch_id}?outcome=GRADUATE")
    assert filtered.status_code == 200 and filtered.json()["filtered_total"] == 1
    committed = client.post(f"/api/student-progression/previews/{batch_id}/commit", json={
        "preview_version": 1,
        "effective_date": destination.start_date.isoformat(),
        "confirmation": GRADUATION_CONFIRMATION,
    })
    assert committed.status_code == 200 and committed.json()["applied"] == 2
    result = client.get(f"/api/student-progression/batches/{batch_id}/result")
    assert result.status_code == 200 and result.json() == committed.json()
    client.close()
