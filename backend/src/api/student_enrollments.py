from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_role
from services.enrollment_population import (
    commit_enrollment_preview,
    create_enrollment_preview,
    enrollment_summary,
)
from services.academic_mapping import build_academic_mapping_preview


router = APIRouter(dependencies=[Depends(get_current_user)])


class EnrollmentPopulationPreviewRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    legacy_student_ids: list[int] | None = None
    effective_start_date: date


class EnrollmentPopulationCommitRequest(BaseModel):
    preview_id: str
    selected_legacy_student_ids: list[int] = Field(min_length=1)
    confirmation: str


@router.post("/mapping-preview")
def preview_academic_mappings(
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    """Return reviewed academic mappings without mutating students or enrollments."""
    return build_academic_mapping_preview(db)


@router.post("/populate/preview")
def preview_enrollment_population(
    body: EnrollmentPopulationPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    batch = create_enrollment_preview(
        db, body.academic_year_id, body.effective_start_date,
        body.legacy_student_ids, user.username,
    )
    return {
        "preview_id": batch.id,
        "snapshot_checksum": batch.snapshot_checksum,
        "summary": enrollment_summary(batch.rows),
        "rows": batch.rows,
    }


@router.post("/populate/commit")
def commit_enrollment_population(
    body: EnrollmentPopulationCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return commit_enrollment_preview(
        db, body.preview_id, body.selected_legacy_student_ids,
        body.confirmation, user.username,
    )
