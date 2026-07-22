from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from models.student_progression import StudentProgressionMappingRule, StudentProgressionPreviewBatch
from models.user import User
from schemas.student_progression import (
    ProgressionCommitRequest,
    ProgressionMappingRuleRequest,
    ProgressionPreviewRequest,
    ProgressionRevalidateRequest,
    ProgressionRowPatch,
)
from security.capabilities import capabilities_for_role
from security.dependencies import get_current_user, require_capability
from services.student_progression import (
    commit_progression_batch,
    create_progression_preview,
    patch_progression_row,
    revalidate_progression_preview,
    serialize_batch,
)


router = APIRouter(dependencies=[Depends(get_current_user)])


def _batch(db: Session, batch_id: str) -> StudentProgressionPreviewBatch:
    batch = db.get(StudentProgressionPreviewBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail={"code": "PROGRESSION_BATCH_NOT_FOUND", "message": "Progression batch was not found."})
    return batch


@router.post("/previews", status_code=201)
def create_preview(
    body: ProgressionPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("create_progression_preview")),
):
    batch = create_progression_preview(
        db,
        body.source_academic_year_id,
        body.destination_academic_year_id,
        [item.model_dump() for item in body.overrides],
        user.username,
        source_enrollment_ids=body.source_enrollment_ids,
    )
    return serialize_batch(batch)


@router.get("/previews")
def list_previews(
    status: str | None = None,
    source_academic_year_id: int | None = Query(default=None, gt=0),
    destination_academic_year_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_progression_preview")),
):
    query = db.query(StudentProgressionPreviewBatch)
    if status:
        query = query.filter(StudentProgressionPreviewBatch.status == status.upper())
    if source_academic_year_id:
        query = query.filter_by(source_academic_year_id=source_academic_year_id)
    if destination_academic_year_id:
        query = query.filter_by(destination_academic_year_id=destination_academic_year_id)
    total = query.count()
    batches = query.order_by(StudentProgressionPreviewBatch.created_at.desc(), StudentProgressionPreviewBatch.id).offset(offset).limit(limit).all()
    return {"total": total, "items": [serialize_batch(item, rows=[]) for item in batches]}


@router.get("/previews/{batch_id}")
def get_preview(
    batch_id: str,
    outcome: str | None = None,
    jenjang_id: int | None = Query(default=None, gt=0),
    grade_id: int | None = Query(default=None, gt=0),
    class_id: int | None = Query(default=None, gt=0),
    conflict: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_progression_preview")),
):
    batch = _batch(db, batch_id)
    rows = list(batch.rows)
    if outcome:
        rows = [row for row in rows if row["proposed_outcome"] == outcome.upper()]
    if jenjang_id:
        rows = [row for row in rows if row["source_jenjang_id"] == jenjang_id or row["destination_jenjang_id"] == jenjang_id]
    if grade_id:
        rows = [row for row in rows if row["source_grade_id"] == grade_id or row["destination_grade_id"] == grade_id]
    if class_id:
        rows = [row for row in rows if row["source_class_id"] == class_id or row["destination_class_id"] == class_id]
    if conflict:
        rows = [row for row in rows if conflict.upper() in row["conflict_codes"]]
    response = serialize_batch(batch, rows=rows[offset:offset + limit])
    response["filtered_total"] = len(rows)
    return response


@router.patch("/previews/{batch_id}/rows/{row_id}")
def patch_row(
    batch_id: str,
    row_id: int,
    body: ProgressionRowPatch,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("override_progression_mapping")),
):
    batch = patch_progression_row(db, _batch(db, batch_id), row_id, body.preview_version, body.model_dump(exclude={"preview_version"}, exclude_unset=True))
    return serialize_batch(batch)


@router.post("/previews/{batch_id}/revalidate")
def revalidate_preview(
    batch_id: str,
    body: ProgressionRevalidateRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("create_progression_preview")),
):
    return serialize_batch(revalidate_progression_preview(db, _batch(db, batch_id), body.preview_version))


@router.post("/previews/{batch_id}/commit")
def commit_preview(
    batch_id: str,
    body: ProgressionCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("commit_progression_batch")),
):
    batch = _batch(db, batch_id)
    outcomes = {row["proposed_outcome"] for row in batch.rows}
    capabilities = capabilities_for_role(user.role)
    if "GRADUATE" in outcomes and "graduate_students" not in capabilities:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if "RETAIN" in outcomes and "retain_students" not in capabilities:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if "CROSS_JENJANG" in outcomes and "execute_cross_jenjang_transition" not in capabilities:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return commit_progression_batch(db, batch, body.preview_version, body.effective_date, body.confirmation, user.username)


@router.get("/batches/{batch_id}/result")
def get_result(
    batch_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_progression_preview")),
):
    batch = _batch(db, batch_id)
    if batch.status != "COMMITTED":
        raise HTTPException(status_code=409, detail={"code": "PROGRESSION_BATCH_NOT_COMMITTED", "message": "Progression result is not available yet."})
    return batch.commit_result


@router.get("/mapping-rules")
def list_mapping_rules(
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_progression_preview")),
):
    return db.query(StudentProgressionMappingRule).order_by(StudentProgressionMappingRule.source_jenjang_id, StudentProgressionMappingRule.source_program_id, StudentProgressionMappingRule.source_grade_id, StudentProgressionMappingRule.id).all()


@router.post("/mapping-rules", status_code=201)
def create_mapping_rule(
    body: ProgressionMappingRuleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("override_progression_mapping")),
):
    row = StudentProgressionMappingRule(**body.model_dump(), created_by=user.username, approved_by=user.username, active=True)
    db.add(row)
    try:
        db.commit(); db.refresh(row); return row
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "PROGRESSION_MAPPING_CONFLICT", "message": "An equivalent progression mapping already exists."}) from exc
