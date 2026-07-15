from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from services.academic_roster import commit_roster_preview, create_roster_preview
from services.academic_master_preview import create_academic_master_preview


router = APIRouter(dependencies=[Depends(get_current_user)])


class EnrollmentPopulationPreviewRequest(BaseModel):
    academic_year_id: int = Field(gt=0)
    legacy_student_ids: list[int] | None = None
    effective_start_date: date


class EnrollmentPopulationCommitRequest(BaseModel):
    preview_id: str
    selected_legacy_student_ids: list[int] = Field(min_length=1)
    confirmation: str


class AcademicRosterCommitRequest(BaseModel):
    preview_id: str
    selected_row_ids: list[int] = Field(min_length=1)
    confirmation: str


class JenjangMasterProposal(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    level: int = Field(gt=0)
    active: bool = True


class ProgramMasterProposal(BaseModel):
    jenjang_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    active: bool = True


class ClassMasterProposal(BaseModel):
    academic_year: str = Field(min_length=1, max_length=32)
    jenjang_code: str = Field(min_length=1, max_length=32)
    program: str = Field(min_length=1, max_length=255)
    class_name: str = Field(min_length=1, max_length=255)
    active: bool = True


class AcademicMasterPreviewRequest(BaseModel):
    source_owner: str = Field(min_length=2, max_length=255)
    jenjangs: list[JenjangMasterProposal] = Field(default_factory=list)
    programs: list[ProgramMasterProposal] = Field(default_factory=list)
    classes: list[ClassMasterProposal] = Field(default_factory=list)


@router.post("/academic-master-preview")
def preview_academic_masters(
    body: AcademicMasterPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    preview = create_academic_master_preview(
        db, body.model_dump(), body.source_owner.strip(), user.username
    )
    return {
        "preview_id": preview.id, "status": preview.status,
        **preview.validation_result,
    }


@router.post("/roster-preview")
async def preview_academic_roster(
    file: UploadFile = File(...),
    source_owner: str = Form(..., min_length=2),
    date_received: date = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Academic roster must be an .xlsx workbook")
    try:
        batch = create_roster_preview(
            db, await file.read(), file.filename or "roster.xlsx",
            source_owner.strip(), date_received, user.username,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "preview_id": batch.id, "checksum": batch.checksum, "status": batch.status,
        "summary": batch.summary, "rows": batch.rows,
    }


@router.post("/roster-commit")
def commit_academic_roster(
    body: AcademicRosterCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return commit_roster_preview(
        db, body.preview_id, body.selected_row_ids, body.confirmation, user.username
    )


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
