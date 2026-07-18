from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import (
    EnrollmentPopulationPreviewBatch,
    StudentDeviceIdentity,
    StudentEnrollmentClassHistory,
    StudentMaster,
)
from services.student_linking import snapshot_checksum
from services.student_normalization import normalize_name
from services.academic_mapping import approved_rule_map, resolve_class, resolve_jenjang
from models.academic_master import AcademicClass, AcademicGrade


ENROLLMENT_CONFIRMATION = "POPULATE_STUDENT_ENROLLMENTS"


def build_enrollment_rows(
    db: Session,
    academic_year_id: int,
    effective_start_date: date,
    selected_legacy_ids: list[int] | None = None,
) -> list[dict]:
    academic_year = db.get(AcademicYear, academic_year_id)
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")
    if effective_start_date < academic_year.start_date or effective_start_date > academic_year.end_date:
        raise HTTPException(status_code=400, detail="Effective start date is outside the academic year")

    query = db.query(Student)
    if selected_legacy_ids is not None:
        query = query.filter(Student.id.in_(selected_legacy_ids))
    students = query.order_by(Student.id.asc()).all()
    jenjangs = db.query(Jenjang).order_by(Jenjang.id.asc()).all()
    exact_jenjang = {row.name: row for row in jenjangs}
    normalized_jenjang = {}
    for row in jenjangs:
        normalized_jenjang.setdefault(normalize_name(row.name), []).append(row)
    jenjang_rules = approved_rule_map(db, "jenjang")
    class_rules = approved_rule_map(db, "class")

    rows = []
    for student in students:
        warnings = []
        mappings = (
            db.query(StudentDeviceIdentity)
            .filter(
                StudentDeviceIdentity.legacy_student_id == student.id,
                StudentDeviceIdentity.is_active.is_(True),
            )
            .order_by(StudentDeviceIdentity.id.asc())
            .all()
        )
        master_ids = {mapping.student_master_id for mapping in mappings}
        master_id = next(iter(master_ids)) if len(master_ids) == 1 else None
        canonical_jenjang, _jenjang_state, jenjang_match = resolve_jenjang(
            student.jenjang, exact_jenjang, normalized_jenjang, jenjang_rules
        )
        proposed_class, _class_state, class_match = resolve_class(student.class_name, class_rules)
        academic_class = (
            db.query(AcademicClass)
            .join(AcademicGrade, AcademicGrade.id == AcademicClass.grade_id)
            .filter(
                AcademicClass.academic_year_id == academic_year_id,
                AcademicClass.class_name == proposed_class,
                AcademicClass.active.is_(True),
                AcademicGrade.jenjang_id == canonical_jenjang.id,
                AcademicGrade.active.is_(True),
            ).first()
        ) if canonical_jenjang and proposed_class else None

        existing = (
            db.query(StudentEnrollment)
            .filter(StudentEnrollment.student_id == student.id, StudentEnrollment.academic_year_id == academic_year_id)
            .first()
        )
        if len(master_ids) != 1:
            action = "CROSS_JENJANG_CONFLICT" if len(master_ids) > 1 else "MISSING_MASTER_LINK"
            if len(master_ids) > 1:
                warnings.append("Multiple active canonical mappings exist")
        elif canonical_jenjang is None:
            action = "MISSING_JENJANG"
            warnings.append("Legacy jenjang has no canonical mapping")
        elif existing and existing.student_master_id and existing.student_master_id != master_id:
            action = "CROSS_JENJANG_CONFLICT"
            warnings.append("Existing enrollment points to a different canonical master")
        elif existing and existing.jenjang_id != canonical_jenjang.id:
            action = "CROSS_JENJANG_CONFLICT"
            warnings.append("Existing enrollment jenjang differs from the legacy proposal")
        elif proposed_class is None or academic_class is None:
            action = "MISSING_CLASS"
            warnings.append("Class is blank or lacks active approved class master data")
        elif existing:
            if existing.class_name != proposed_class:
                action = "UPDATE_CLASS"
                warnings.append("Class changes require reviewed effective-dated transfer handling")
            else:
                action = "ALREADY_ENROLLED"
        else:
            master_enrollment = (
                db.query(StudentEnrollment)
                .filter(
                    StudentEnrollment.student_master_id == master_id,
                    StudentEnrollment.academic_year_id == academic_year_id,
                )
                .first()
            )
            if master_enrollment:
                action = "CROSS_JENJANG_CONFLICT"
                warnings.append("Canonical master already has an enrollment for this academic year")
            else:
                action = "CREATE_ENROLLMENT"

        rows.append({
            "legacy_student_id": student.id,
            "legacy_name": student.name,
            "student_master_id": master_id,
            "academic_year_id": academic_year_id,
            "canonical_jenjang_id": canonical_jenjang.id if canonical_jenjang else None,
            "canonical_jenjang": canonical_jenjang.name if canonical_jenjang else None,
            "jenjang_match": jenjang_match,
            "legacy_jenjang": student.jenjang,
            "proposed_class": proposed_class,
            "academic_class_id": academic_class.id if academic_class else None,
            "class_match": class_match,
            "legacy_class": student.class_name,
            "effective_start_date": effective_start_date.isoformat(),
            "proposed_action": action,
            "warnings": warnings,
        })
    return rows


def enrollment_summary(rows: list[dict]) -> dict:
    actions = (
        "CREATE_ENROLLMENT", "ALREADY_ENROLLED", "UPDATE_CLASS", "MISSING_MASTER_LINK",
        "MISSING_JENJANG", "MISSING_CLASS", "CROSS_JENJANG_CONFLICT", "INVALID",
    )
    return {"total": len(rows), **{action.casefold(): sum(row["proposed_action"] == action for row in rows) for action in actions}}


def create_enrollment_preview(
    db: Session, academic_year_id: int, effective_start_date: date,
    selected_legacy_ids: list[int] | None, username: str,
) -> EnrollmentPopulationPreviewBatch:
    rows = build_enrollment_rows(db, academic_year_id, effective_start_date, selected_legacy_ids)
    batch = EnrollmentPopulationPreviewBatch(
        academic_year_id=academic_year_id,
        effective_start_date=effective_start_date,
        snapshot_checksum=snapshot_checksum(rows),
        rows=rows,
        created_by=username,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def commit_enrollment_preview(
    db: Session, preview_id: str, selected_ids: list[int], confirmation: str, username: str
) -> dict:
    if confirmation != ENROLLMENT_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    batch = db.get(EnrollmentPopulationPreviewBatch, preview_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Enrollment preview not found")
    preview_by_id = {row["legacy_student_id"]: row for row in batch.rows}
    if not selected_ids or any(student_id not in preview_by_id for student_id in selected_ids):
        raise HTTPException(status_code=400, detail="Selected rows are not part of this preview")
    current_rows = build_enrollment_rows(
        db, batch.academic_year_id, batch.effective_start_date, selected_ids
    )
    current_by_id = {row["legacy_student_id"]: row for row in current_rows}
    created = skipped = 0
    try:
        for student_id in dict.fromkeys(selected_ids):
            row = current_by_id.get(student_id)
            if row is None:
                raise HTTPException(status_code=409, detail=f"Legacy student {student_id} no longer exists")
            if row["proposed_action"] == "ALREADY_ENROLLED":
                skipped += 1
                continue
            if row["proposed_action"] != "CREATE_ENROLLMENT":
                raise HTTPException(status_code=409, detail=f"Enrollment for {student_id} is not safe to create")
            enrollment = StudentEnrollment(
                student_id=student_id,
                student_master_id=row["student_master_id"],
                academic_year_id=batch.academic_year_id,
                jenjang_id=row["canonical_jenjang_id"],
                academic_class_id=row["academic_class_id"],
                class_name=row["proposed_class"],
                class_assigned=True,
                effective_from=batch.effective_start_date,
            )
            db.add(enrollment)
            db.flush()
            db.add(StudentEnrollmentClassHistory(
                enrollment_id=enrollment.id,
                class_name=enrollment.class_name,
                effective_from=batch.effective_start_date,
                changed_by=username,
                source="enrollment_population",
            ))
            created += 1
        batch.committed_at = datetime.now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"created": created, "skipped_existing": skipped}
