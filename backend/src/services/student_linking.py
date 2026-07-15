import hashlib
import json
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.student import Student
from models.student_master import (
    LegacyLinkPreviewBatch,
    LegacyLinkResolution,
    StudentDeviceIdentity,
    StudentMaster,
    StudentMasterChangeHistory,
)
from services.student_normalization import normalize_name


LEGACY_LINK_CONFIRMATION = "LINK_LEGACY_STUDENTS_TO_MASTERS"
LEGACY_DEVICE_SOURCE = "legacy_students"


def snapshot_checksum(rows: list[dict]) -> str:
    payload = json.dumps(rows, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_legacy_link_rows(db: Session, selected_ids: list[int] | None = None) -> list[dict]:
    query = db.query(Student)
    if selected_ids is not None:
        query = query.filter(Student.id.in_(selected_ids))
    students = query.order_by(Student.id.asc()).all()

    normalized_counts = {}
    for (name,) in db.query(Student.name).all():
        key = normalize_name(name) if name and name.strip() else ""
        normalized_counts[key] = normalized_counts.get(key, 0) + 1

    rows = []
    for student in students:
        warnings: list[str] = []
        if not student.name or not student.name.strip():
            action, match_rule, confidence, matched = "INVALID", "missing_name", "none", None
        else:
            active_mappings = (
                db.query(StudentDeviceIdentity)
                .filter(
                    StudentDeviceIdentity.legacy_student_id == student.id,
                    StudentDeviceIdentity.is_active.is_(True),
                )
                .order_by(StudentDeviceIdentity.id.asc())
                .all()
            )
            mapped_master_ids = {mapping.student_master_id for mapping in active_mappings}
            if len(mapped_master_ids) > 1:
                action, match_rule, confidence, matched = "CONFLICT", "multiple_active_legacy_mappings", "none", None
                warnings.append("Legacy student is mapped to multiple canonical masters")
            elif len(mapped_master_ids) == 1:
                action, match_rule, confidence, matched = "SAFE_AUTO_LINK", "existing_active_device_identity", "high", next(iter(mapped_master_ids))
            else:
                normalized = normalize_name(student.name)
                candidates = (
                    db.query(StudentMaster)
                    .filter(StudentMaster.normalized_name == normalized)
                    .order_by(StudentMaster.id.asc())
                    .all()
                )
                if len(candidates) > 1 or normalized_counts.get(normalized, 0) > 1:
                    action, match_rule, confidence, matched = "REVIEW_REQUIRED", "ambiguous_normalized_name", "low", None
                    warnings.append("Normalized name is not globally unique")
                elif len(candidates) == 1:
                    action, match_rule, confidence, matched = "REVIEW_REQUIRED", "name_only_candidate", "medium", candidates[0].id
                    warnings.append("Name-only matches require administrator resolution")
                else:
                    action, match_rule, confidence, matched = "SAFE_AUTO_CREATE", "legacy_id_unlinked_unique_name", "high", None

        stats = (
            db.query(func.count(Attendance.id), func.min(Attendance.date), func.max(Attendance.date))
            .filter(Attendance.student_id == student.id)
            .one()
        )
        rows.append({
            "legacy_student_id": student.id,
            "legacy_name": student.name,
            "legacy_jenjang": student.jenjang,
            "legacy_class_name": student.class_name,
            "attendance_count": stats[0] or 0,
            "earliest_attendance_date": stats[1].isoformat() if stats[1] else None,
            "latest_attendance_date": stats[2].isoformat() if stats[2] else None,
            "proposed_action": action,
            "matched_student_master_id": matched,
            "match_rule": match_rule,
            "confidence": confidence,
            "warnings": warnings,
        })
    return rows


def summarize(rows: list[dict]) -> dict:
    summary = {"total": len(rows)}
    for action in ("SAFE_AUTO_LINK", "SAFE_AUTO_CREATE", "REVIEW_REQUIRED", "CONFLICT", "INVALID"):
        summary[action.casefold()] = sum(row["proposed_action"] == action for row in rows)
    return summary


def create_legacy_preview(db: Session, username: str) -> LegacyLinkPreviewBatch:
    rows = build_legacy_link_rows(db)
    batch = LegacyLinkPreviewBatch(
        snapshot_checksum=snapshot_checksum(rows), rows=rows, created_by=username
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def _create_mapping(db: Session, student: Student, master: StudentMaster, username: str) -> bool:
    existing = (
        db.query(StudentDeviceIdentity)
        .filter(
            StudentDeviceIdentity.legacy_student_id == student.id,
            StudentDeviceIdentity.student_master_id == master.id,
            StudentDeviceIdentity.is_active.is_(True),
        )
        .first()
    )
    if existing:
        return False
    first_date = db.query(func.min(Attendance.date)).filter(Attendance.student_id == student.id).scalar()
    db.add(StudentDeviceIdentity(
        student_master_id=master.id,
        legacy_student_id=student.id,
        device_identifier=str(student.id),
        device_source=LEGACY_DEVICE_SOURCE,
        effective_from=first_date or date.today(),
        is_active=True,
        created_by=username,
    ))
    return True


def commit_legacy_preview(
    db: Session, batch_id: str, selected_ids: list[int], confirmation: str, username: str
) -> dict:
    if confirmation != LEGACY_LINK_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    batch = db.get(LegacyLinkPreviewBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Legacy-link preview not found")
    preview_by_id = {row["legacy_student_id"]: row for row in batch.rows}
    if not selected_ids or any(student_id not in preview_by_id for student_id in selected_ids):
        raise HTTPException(status_code=400, detail="Selected rows are not part of this preview")

    current_by_id = {row["legacy_student_id"]: row for row in build_legacy_link_rows(db, selected_ids)}
    created_masters = created_mappings = skipped = 0
    try:
        for student_id in dict.fromkeys(selected_ids):
            preview_row = preview_by_id[student_id]
            current = current_by_id.get(student_id)
            if current is None:
                raise HTTPException(status_code=409, detail=f"Legacy student {student_id} no longer exists")
            if current["proposed_action"] not in {"SAFE_AUTO_CREATE", "SAFE_AUTO_LINK"}:
                raise HTTPException(status_code=409, detail=f"Legacy student {student_id} now requires review")
            student = db.get(Student, student_id)
            master = None
            if current["proposed_action"] == "SAFE_AUTO_LINK":
                master = db.get(StudentMaster, current["matched_student_master_id"])
            elif preview_row["proposed_action"] == "SAFE_AUTO_CREATE":
                master = StudentMaster(
                    full_name=student.name.strip(),
                    normalized_name=normalize_name(student.name),
                    student_status="pending_review",
                    created_by=username,
                    updated_by=username,
                )
                db.add(master)
                db.flush()
                created_masters += 1
            else:
                raise HTTPException(status_code=409, detail=f"Preview for {student_id} is stale")

            if master is None:
                raise HTTPException(status_code=409, detail=f"Canonical master for {student_id} is unavailable")
            if _create_mapping(db, student, master, username):
                created_mappings += 1
                db.add(StudentMasterChangeHistory(
                    student_master_id=master.id,
                    action="legacy_identity_linked",
                    field_name="legacy_student_id",
                    old_value=None,
                    new_value=str(student.id),
                    source="legacy_link_commit",
                    changed_by=username,
                ))
            else:
                skipped += 1
        batch.committed_at = datetime.now()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"created_masters": created_masters, "created_mappings": created_mappings, "skipped": skipped}


def resolve_legacy_student(
    db: Session,
    legacy_student_id: int,
    action: str,
    student_master_id: str | None,
    reason: str,
    confirmation: str,
    username: str,
) -> dict:
    if confirmation != LEGACY_LINK_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    student = db.get(Student, legacy_student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Legacy student not found")
    if action not in {"link_existing", "create_new", "defer", "mark_invalid"}:
        raise HTTPException(status_code=400, detail="Unsupported resolution action")
    if action in {"link_existing", "create_new"}:
        if action == "link_existing":
            if not student_master_id:
                raise HTTPException(status_code=400, detail="student_master_id is required")
            master = db.get(StudentMaster, student_master_id)
            if master is None:
                raise HTTPException(status_code=404, detail="Student master not found")
            resolution = "linked"
        else:
            master = StudentMaster(
                full_name=student.name.strip(), normalized_name=normalize_name(student.name),
                student_status="pending_review", created_by=username, updated_by=username,
            )
            db.add(master)
            db.flush()
            resolution = "created"
        _create_mapping(db, student, master, username)
        db.add(StudentMasterChangeHistory(
            student_master_id=master.id, action="manual_legacy_resolution",
            field_name="legacy_student_id", new_value=str(student.id), source="manual_resolution",
            changed_by=username,
        ))
    else:
        master = None
        resolution = "deferred" if action == "defer" else "invalid"
    db.add(LegacyLinkResolution(
        legacy_student_id=student.id, resolution=resolution,
        student_master_id=master.id if master else None, reason=reason,
        resolved_by=username,
    ))
    db.commit()
    return {"legacy_student_id": student.id, "resolution": resolution, "student_master_id": master.id if master else None}
