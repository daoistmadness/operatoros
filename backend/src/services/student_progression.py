from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment, StudentEnrollmentLifecycleAudit
from models.student_master import StudentEnrollmentClassHistory, StudentMaster
from models.student_progression import (
    StudentProgressionAudit,
    StudentProgressionMappingRule,
    StudentProgressionPreviewBatch,
)


STANDARD_CONFIRMATION = "COMMIT_STUDENT_PROGRESSION"
GRADUATION_CONFIRMATION = "COMMIT_GRADUATION_PROGRESSION"
CROSS_JENJANG_CONFIRMATION = "COMMIT_CROSS_JENJANG_PROGRESSION"
DESTINATION_OUTCOMES = {"PROMOTE", "RETAIN", "CROSS_JENJANG"}
BLOCKING_OUTCOMES = {"MANUAL_REVIEW"}


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _checksum(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _source_fingerprint(enrollment: StudentEnrollment) -> str:
    return _checksum({
        "id": enrollment.id,
        "student_master_id": enrollment.student_master_id,
        "academic_year_id": enrollment.academic_year_id,
        "jenjang_id": enrollment.jenjang_id,
        "academic_class_id": enrollment.academic_class_id,
        "lifecycle_state": enrollment.lifecycle_state,
        "effective_from": enrollment.effective_from,
        "effective_to": enrollment.effective_to,
    })


def _summary(rows: list[dict]) -> dict:
    outcomes = Counter(row["proposed_outcome"] for row in rows)
    conflicts = Counter(code for row in rows for code in row["conflict_codes"])
    return {
        "total": len(rows),
        "valid": sum(row["validation_result"] == "VALID" for row in rows),
        "manual_review": sum(row["validation_result"] == "MANUAL_REVIEW" for row in rows),
        "conflict": sum(row["validation_result"] == "CONFLICT" for row in rows),
        "outcomes": dict(sorted(outcomes.items())),
        "conflicts_by_code": dict(sorted(conflicts.items())),
    }


def _year_pair(db: Session, source_id: int, destination_id: int) -> tuple[AcademicYear, AcademicYear]:
    if source_id == destination_id:
        raise _error(422, "ACADEMIC_YEARS_MUST_DIFFER", "Source and destination academic years must be distinct.")
    source = db.get(AcademicYear, source_id)
    destination = db.get(AcademicYear, destination_id)
    if source is None or destination is None:
        raise _error(404, "ACADEMIC_YEAR_NOT_FOUND", "Source or destination academic year was not found.")
    if destination.status == "closed":
        raise _error(409, "DESTINATION_YEAR_CLOSED", "Closed academic years cannot receive progression enrollments.")
    if destination.start_date <= source.start_date:
        raise _error(422, "INVALID_ACADEMIC_YEAR_SEQUENCE", "Destination academic year must follow the source year.")
    return source, destination


def _class_context(db: Session, class_id: int | None):
    if class_id is None:
        return None
    return (
        db.query(AcademicClass, AcademicGrade, AcademicProgram, Jenjang)
        .join(AcademicGrade, AcademicGrade.id == AcademicClass.grade_id)
        .join(AcademicProgram, AcademicProgram.id == AcademicGrade.program_id)
        .join(Jenjang, Jenjang.id == AcademicGrade.jenjang_id)
        .filter(AcademicClass.id == class_id)
        .first()
    )


def _validate_destination(db: Session, row: dict, destination_year: AcademicYear) -> dict:
    row["warning_codes"] = list(dict.fromkeys(row.get("warning_codes", [])))
    row["conflict_codes"] = []
    outcome = row["proposed_outcome"]
    if outcome == "MANUAL_REVIEW":
        row["validation_result"] = "MANUAL_REVIEW"
        return row
    if outcome in {"GRADUATE", "WITHDRAW", "EXCLUDE"}:
        for field in ("destination_jenjang_id", "destination_program_id", "destination_grade_id", "destination_class_id"):
            row[field] = None
        if outcome == "GRADUATE" and not row.get("terminal_grade"):
            row["conflict_codes"].append("GRADUATION_NOT_ALLOWED")
        row["validation_result"] = "CONFLICT" if row["conflict_codes"] else "VALID"
        return row

    class_context = _class_context(db, row.get("destination_class_id"))
    if class_context is None:
        row["conflict_codes"].append("DESTINATION_CLASS_REQUIRED")
    else:
        academic_class, grade, program, jenjang = class_context
        if academic_class.academic_year_id != destination_year.id:
            row["conflict_codes"].append("DESTINATION_CLASS_WRONG_YEAR")
        if not academic_class.active or not grade.active or not program.active or not jenjang.active:
            row["conflict_codes"].append("CONFIGURATION_ARCHIVED")
        expected = (row.get("destination_grade_id"), row.get("destination_program_id"), row.get("destination_jenjang_id"))
        actual = (grade.id, program.id, jenjang.id)
        if expected != actual:
            row["conflict_codes"].append("INCOMPATIBLE_DESTINATION_MAPPING")
        if outcome == "RETAIN" and grade.id != row.get("source_grade_id"):
            row["conflict_codes"].append("INVALID_GRADE_PROGRESSION")
        if outcome == "CROSS_JENJANG" and jenjang.id == row.get("source_jenjang_id"):
            row["conflict_codes"].append("CROSS_JENJANG_MAPPING_REQUIRED")
        if outcome == "PROMOTE" and jenjang.id != row.get("source_jenjang_id"):
            row["conflict_codes"].append("CROSS_JENJANG_MAPPING_REQUIRED")
    if outcome == "RETAIN" and not row.get("reason_code"):
        row["conflict_codes"].append("RETENTION_REASON_REQUIRED")
    row["conflict_codes"] = list(dict.fromkeys(row["conflict_codes"]))
    row["validation_result"] = "CONFLICT" if row["conflict_codes"] else "VALID"
    return row


def _choose_class(db: Session, destination_year_id: int, grade_id: int | None) -> tuple[int | None, list[str]]:
    if grade_id is None:
        return None, []
    classes = (
        db.query(AcademicClass)
        .filter_by(academic_year_id=destination_year_id, grade_id=grade_id, active=True)
        .order_by(AcademicClass.class_name, AcademicClass.id)
        .all()
    )
    if len(classes) == 1:
        return classes[0].id, []
    if not classes:
        return None, ["DESTINATION_CLASS_REQUIRED"]
    return None, ["MULTIPLE_DESTINATION_CLASSES"]


def _base_row(db: Session, enrollment: StudentEnrollment, destination: AcademicYear, override: dict | None) -> dict:
    context = _class_context(db, enrollment.academic_class_id)
    student = db.get(StudentMaster, enrollment.student_master_id) if enrollment.student_master_id else None
    row = {
        "preview_row_id": 0,
        "source_enrollment_id": enrollment.id,
        "student_master_id": enrollment.student_master_id,
        "student_name": student.full_name if student else "Unknown student",
        "source_jenjang_id": enrollment.jenjang_id,
        "source_program_id": None,
        "source_grade_id": None,
        "source_class_id": enrollment.academic_class_id,
        "source_class_name": enrollment.class_name,
        "proposed_outcome": "MANUAL_REVIEW",
        "destination_jenjang_id": None,
        "destination_program_id": None,
        "destination_grade_id": None,
        "destination_class_id": None,
        "mapping_source": "MANUAL_REVIEW",
        "operator_override": bool(override),
        "reason_code": None,
        "reason": None,
        "terminal_grade": False,
        "warning_codes": [],
        "conflict_codes": [],
        "validation_result": "MANUAL_REVIEW",
        "source_fingerprint": _source_fingerprint(enrollment),
        "device_linked": enrollment.student_id is not None,
    }
    if context is None:
        row["warning_codes"].append("SOURCE_CLASS_CONTEXT_MISSING")
        return row
    _source_class, grade, program, jenjang = context
    row.update(source_jenjang_id=jenjang.id, source_program_id=program.id, source_grade_id=grade.id)
    max_sequence = db.query(AcademicGrade.sequence_number).filter_by(program_id=program.id, active=True).order_by(AcademicGrade.sequence_number.desc()).first()
    row["terminal_grade"] = bool(max_sequence and grade.sequence_number == max_sequence[0])

    if override:
        row.update({
            "proposed_outcome": override["outcome"],
            "destination_jenjang_id": override.get("destination_jenjang_id"),
            "destination_program_id": override.get("destination_program_id"),
            "destination_grade_id": override.get("destination_grade_id"),
            "destination_class_id": override.get("destination_class_id"),
            "reason_code": override.get("reason_code"),
            "reason": override.get("reason"),
            "mapping_source": "OPERATOR_OVERRIDE",
        })
        return _validate_destination(db, row, destination)

    rule = (
        db.query(StudentProgressionMappingRule)
        .filter_by(source_jenjang_id=jenjang.id, source_program_id=program.id, source_grade_id=grade.id, active=True)
        .order_by(StudentProgressionMappingRule.id)
        .first()
    )
    if rule:
        row.update({
            "proposed_outcome": rule.outcome,
            "destination_jenjang_id": rule.destination_jenjang_id,
            "destination_program_id": rule.destination_program_id,
            "destination_grade_id": rule.destination_grade_id,
            "mapping_source": "SAVED_RULE",
        })
        row["destination_class_id"], warnings = _choose_class(db, destination.id, rule.destination_grade_id)
        row["warning_codes"].extend(warnings)
        return _validate_destination(db, row, destination)

    next_grade = (
        db.query(AcademicGrade)
        .filter_by(program_id=program.id, jenjang_id=jenjang.id, sequence_number=grade.sequence_number + 1, active=True)
        .first()
    )
    if next_grade:
        row.update({
            "proposed_outcome": "PROMOTE",
            "destination_jenjang_id": jenjang.id,
            "destination_program_id": program.id,
            "destination_grade_id": next_grade.id,
            "mapping_source": "GRADE_SEQUENCE",
        })
        row["destination_class_id"], warnings = _choose_class(db, destination.id, next_grade.id)
        row["warning_codes"].extend(warnings)
    elif row["terminal_grade"]:
        row.update(proposed_outcome="GRADUATE", mapping_source="TERMINAL_GRADE")
    return _validate_destination(db, row, destination)


def build_progression_rows(db: Session, source_year_id: int, destination_year_id: int, overrides: list[dict] | None = None, source_enrollment_ids: list[int] | None = None) -> list[dict]:
    _source, destination = _year_pair(db, source_year_id, destination_year_id)
    override_by_enrollment = {item["source_enrollment_id"]: item for item in (overrides or [])}
    if len(override_by_enrollment) != len(overrides or []):
        raise _error(422, "DUPLICATE_SOURCE_ENROLLMENT", "A source enrollment appears more than once in the preview request.")
    query = db.query(StudentEnrollment).filter_by(academic_year_id=source_year_id, lifecycle_state="ACTIVE")
    if source_enrollment_ids is not None:
        if len(set(source_enrollment_ids)) != len(source_enrollment_ids):
            raise _error(422, "DUPLICATE_SOURCE_ENROLLMENT", "A source enrollment appears more than once in the preview request.")
        query = query.filter(StudentEnrollment.id.in_(source_enrollment_ids))
    enrollments = query.order_by(StudentEnrollment.jenjang_id, StudentEnrollment.class_name, StudentEnrollment.student_master_id, StudentEnrollment.id).all()
    rows = []
    seen_students: set[str] = set()
    for enrollment in enrollments:
        row = _base_row(db, enrollment, destination, override_by_enrollment.get(enrollment.id))
        row["preview_row_id"] = len(rows) + 1
        if not enrollment.student_master_id or enrollment.student_master_id in seen_students:
            row["conflict_codes"].append("DUPLICATE_STUDENT")
            row["validation_result"] = "CONFLICT"
        elif db.query(StudentEnrollment.id).filter_by(student_master_id=enrollment.student_master_id, academic_year_id=destination_year_id).first():
            row["conflict_codes"].append("DESTINATION_ENROLLMENT_EXISTS")
            row["validation_result"] = "CONFLICT"
        seen_students.add(enrollment.student_master_id)
        rows.append(row)
    unknown = sorted(set(override_by_enrollment) - {row["source_enrollment_id"] for row in rows})
    if unknown:
        raise _error(422, "SOURCE_ENROLLMENT_NOT_ELIGIBLE", "One or more overrides reference an ineligible source enrollment.")
    if source_enrollment_ids is not None and set(source_enrollment_ids) != {row["source_enrollment_id"] for row in rows}:
        raise _error(422, "SOURCE_ENROLLMENT_NOT_ELIGIBLE", "One or more selected source enrollments are not active in the source year.")
    return rows


def create_progression_preview(db: Session, source_year_id: int, destination_year_id: int, overrides: list[dict], actor: str, *, source_enrollment_ids: list[int] | None = None):
    rows = build_progression_rows(db, source_year_id, destination_year_id, overrides, source_enrollment_ids)
    batch = StudentProgressionPreviewBatch(
        source_academic_year_id=source_year_id,
        destination_academic_year_id=destination_year_id,
        rows=rows,
        summary=_summary(rows),
        snapshot_checksum=_checksum(rows),
        created_by=actor,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def serialize_batch(batch: StudentProgressionPreviewBatch, *, rows: list[dict] | None = None) -> dict:
    selected_rows = rows if rows is not None else batch.rows
    return {
        "batch_id": batch.id,
        "source_academic_year_id": batch.source_academic_year_id,
        "destination_academic_year_id": batch.destination_academic_year_id,
        "status": batch.status,
        "preview_version": batch.preview_version,
        "snapshot_checksum": batch.snapshot_checksum,
        "summary": batch.summary,
        "created_by": batch.created_by,
        "created_at": batch.created_at,
        "committed_by": batch.committed_by,
        "committed_at": batch.committed_at,
        "result": batch.commit_result,
        "rows": selected_rows,
    }


def patch_progression_row(db: Session, batch: StudentProgressionPreviewBatch, row_id: int, version: int, changes: dict):
    if batch.status != "PREVIEW":
        raise _error(409, "PROGRESSION_PREVIEW_NOT_EDITABLE", "Only an open preview can be edited.")
    if version != batch.preview_version:
        raise _error(409, "PROGRESSION_PREVIEW_STALE", "The preview changed; reload before editing.")
    rows = copy.deepcopy(batch.rows)
    row = next((item for item in rows if item["preview_row_id"] == row_id), None)
    if row is None:
        raise _error(404, "PROGRESSION_ROW_NOT_FOUND", "Progression preview row was not found.")
    field_map = {
        "outcome": "proposed_outcome",
        "destination_jenjang_id": "destination_jenjang_id",
        "destination_program_id": "destination_program_id",
        "destination_grade_id": "destination_grade_id",
        "destination_class_id": "destination_class_id",
        "reason_code": "reason_code",
        "reason": "reason",
    }
    for source, target in field_map.items():
        if source in changes and changes[source] is not None:
            row[target] = changes[source]
    row["operator_override"] = True
    row["mapping_source"] = "OPERATOR_OVERRIDE"
    destination = db.get(AcademicYear, batch.destination_academic_year_id)
    _validate_destination(db, row, destination)
    batch.rows = rows
    batch.preview_version += 1
    batch.snapshot_checksum = _checksum(rows)
    batch.summary = _summary(rows)
    batch.updated_at = datetime.now()
    db.commit(); db.refresh(batch)
    return batch


def revalidate_progression_preview(db: Session, batch: StudentProgressionPreviewBatch, version: int):
    if batch.status != "PREVIEW" or version != batch.preview_version:
        raise _error(409, "PROGRESSION_PREVIEW_STALE", "The preview changed; reload before revalidation.")
    destination = db.get(AcademicYear, batch.destination_academic_year_id)
    rows = copy.deepcopy(batch.rows)
    for row in rows:
        source = db.get(StudentEnrollment, row["source_enrollment_id"])
        if source is None or _source_fingerprint(source) != row["source_fingerprint"]:
            row["conflict_codes"] = ["PROGRESSION_PREVIEW_STALE"]
            row["validation_result"] = "CONFLICT"
        elif db.query(StudentEnrollment.id).filter_by(student_master_id=row["student_master_id"], academic_year_id=batch.destination_academic_year_id).first():
            row["conflict_codes"] = ["DESTINATION_ENROLLMENT_EXISTS"]
            row["validation_result"] = "CONFLICT"
        else:
            _validate_destination(db, row, destination)
    batch.rows = rows
    batch.preview_version += 1
    batch.snapshot_checksum = _checksum(rows)
    batch.summary = _summary(rows)
    batch.updated_at = datetime.now()
    db.commit(); db.refresh(batch)
    return batch


def required_confirmation(rows: list[dict]) -> str:
    outcomes = {row["proposed_outcome"] for row in rows}
    if "CROSS_JENJANG" in outcomes:
        return CROSS_JENJANG_CONFIRMATION
    if "GRADUATE" in outcomes:
        return GRADUATION_CONFIRMATION
    return STANDARD_CONFIRMATION


def _before_progression_write(_row: dict) -> None:
    """Test seam for proving that the enclosing batch transaction rolls back."""


def commit_progression_batch(db: Session, batch: StudentProgressionPreviewBatch, version: int, effective_date: date, confirmation: str, actor: str) -> dict:
    if batch.status == "COMMITTED":
        return batch.commit_result
    if batch.status != "PREVIEW" or version != batch.preview_version:
        raise _error(409, "PROGRESSION_PREVIEW_STALE", "The preview changed; regenerate or revalidate before commit.")
    source_year, destination_year = _year_pair(db, batch.source_academic_year_id, batch.destination_academic_year_id)
    if effective_date != destination_year.start_date:
        raise _error(422, "INVALID_PROGRESSION_EFFECTIVE_DATE", "Progression effective date must equal the destination year start date.")
    if confirmation != required_confirmation(batch.rows):
        raise _error(400, "CONFIRMATION_REQUIRED", "The progression confirmation token is invalid for this batch.")
    blocking = [row for row in batch.rows if row["validation_result"] != "VALID" or row["proposed_outcome"] in BLOCKING_OUTCOMES]
    if blocking:
        raise _error(409, "PROGRESSION_CONFLICT_UNRESOLVED", "Every progression conflict must be resolved before commit.")
    rows = copy.deepcopy(batch.rows)
    created = graduated = retained = crossed = withdrawn = excluded = 0
    try:
        batch.status = "COMMITTING"
        student_ids = [row["student_master_id"] for row in rows]
        existing = (
            db.query(StudentEnrollment)
            .filter(StudentEnrollment.student_master_id.in_(student_ids), StudentEnrollment.academic_year_id == destination_year.id)
            .with_for_update()
            .all()
        )
        if existing:
            raise _error(409, "DESTINATION_ENROLLMENT_EXISTS", "A destination enrollment was created after preview.")
        for row in rows:
            source = db.query(StudentEnrollment).filter_by(id=row["source_enrollment_id"]).with_for_update().one_or_none()
            if source is None or _source_fingerprint(source) != row["source_fingerprint"]:
                raise _error(409, "PROGRESSION_PREVIEW_STALE", "A source enrollment changed after preview.")
            _validate_destination(db, row, destination_year)
            if row["validation_result"] != "VALID" or row["proposed_outcome"] in BLOCKING_OUTCOMES:
                raise _error(409, "PROGRESSION_CONFLICT_UNRESOLVED", "A progression mapping became invalid during commit revalidation.")
            _before_progression_write(row)
            outcome = row["proposed_outcome"]
            destination_enrollment = None
            if outcome in DESTINATION_OUTCOMES:
                destination_context = _class_context(db, row["destination_class_id"])
                if destination_context is None:
                    raise _error(409, "DESTINATION_CLASS_REQUIRED", "Destination class is required.")
                academic_class, _grade, _program, jenjang = destination_context
                destination_enrollment = StudentEnrollment(
                    student_id=source.student_id,
                    student_master_id=source.student_master_id,
                    academic_year_id=destination_year.id,
                    jenjang_id=jenjang.id,
                    academic_class_id=academic_class.id,
                    class_name=academic_class.class_name,
                    class_assigned=True,
                    effective_from=effective_date,
                    lifecycle_state="ACTIVE",
                    lifecycle_effective_date=effective_date,
                    lifecycle_reason_code=f"PROGRESSION_{outcome}",
                    lifecycle_reason=row.get("reason"),
                )
                db.add(destination_enrollment); db.flush()
                db.add(StudentEnrollmentClassHistory(
                    enrollment_id=destination_enrollment.id,
                    class_name=destination_enrollment.class_name,
                    effective_from=effective_date,
                    changed_by=actor,
                    source="student_progression",
                ))
                created += 1
                retained += outcome == "RETAIN"
                crossed += outcome == "CROSS_JENJANG"

            if outcome not in {"EXCLUDE"}:
                prior = source.lifecycle_state
                target = "GRADUATED" if outcome == "GRADUATE" else "WITHDRAWN" if outcome == "WITHDRAW" else "ENDED"
                source.lifecycle_state = target
                source.lifecycle_effective_date = source_year.end_date
                source.lifecycle_reason_code = f"PROGRESSION_{outcome}"
                source.lifecycle_reason = row.get("reason")
                source.class_assigned = False
                source.effective_to = source_year.end_date
                open_history = db.query(StudentEnrollmentClassHistory).filter_by(enrollment_id=source.id, effective_to=None).order_by(StudentEnrollmentClassHistory.id.desc()).first()
                if open_history:
                    open_history.effective_to = source_year.end_date
                db.add(StudentEnrollmentLifecycleAudit(
                    enrollment_id=source.id,
                    prior_state=prior,
                    new_state=target,
                    effective_date=source_year.end_date,
                    actor=actor,
                    reason_code=f"PROGRESSION_{outcome}",
                    source_workflow="student_progression",
                ))
                graduated += outcome == "GRADUATE"
                withdrawn += outcome == "WITHDRAW"
            else:
                excluded += 1

            db.add(StudentProgressionAudit(
                batch_id=batch.id,
                preview_row_id=row["preview_row_id"],
                source_enrollment_id=source.id,
                destination_enrollment_id=destination_enrollment.id if destination_enrollment else None,
                student_master_id=source.student_master_id,
                outcome=outcome,
                reason_code=row.get("reason_code") or f"PROGRESSION_{outcome}",
                mapping_source=row["mapping_source"],
                source_context={key: row.get(key) for key in ("source_jenjang_id", "source_program_id", "source_grade_id", "source_class_id")},
                destination_context={key: row.get(key) for key in ("destination_jenjang_id", "destination_program_id", "destination_grade_id", "destination_class_id")} if destination_enrollment else None,
                actor=actor,
            ))
            if outcome == "GRADUATE":
                other_active = db.query(StudentEnrollment.id).filter(
                    StudentEnrollment.student_master_id == source.student_master_id,
                    StudentEnrollment.id != source.id,
                    StudentEnrollment.lifecycle_state == "ACTIVE",
                ).first()
                if not other_active:
                    student = db.get(StudentMaster, source.student_master_id)
                    if student:
                        student.student_status = "graduated"
                        student.updated_by = actor
                        student.updated_at = datetime.now()

        result = {
            "status": "COMMITTED",
            "batch_id": batch.id,
            "preview_version": batch.preview_version,
            "applied": len(rows),
            "destination_enrollments_created": created,
            "graduated": graduated,
            "retained": retained,
            "cross_jenjang": crossed,
            "withdrawn": withdrawn,
            "excluded": excluded,
            "skipped": excluded,
        }
        batch.status = "COMMITTED"
        batch.committed_by = actor
        batch.committed_at = datetime.now()
        batch.commit_result = result
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise _error(409, "PROGRESSION_TRANSACTION_FAILED", "The progression batch was rolled back without partial application.") from exc
