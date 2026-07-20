from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.capabilities import capabilities_for_role
from security.dependencies import get_current_user, require_capability
from services.student_export_service import execute_student_export, generate_export_preview


router = APIRouter(prefix="/api/student-exports", tags=["student-exports"])


class ExportPreviewRequest(BaseModel):
    scope: str = Field(..., description="Approved scope: SELECTED_STUDENTS, FILTERED_RESULTS, ACADEMIC_CLASS, ACADEMIC_YEAR, ALL_PERMITTED_STUDENTS")
    field_profile: str = Field(..., description="Approved field profile: STANDARD_OPERATIONAL, SENSITIVE_IDENTIFIERS, CONTACT_AND_GUARDIAN")
    filters: Optional[Dict[str, Any]] = Field(default=None)
    selected_student_ids: Optional[List[str]] = Field(default=None)


class ExportDownloadRequest(BaseModel):
    scope: str = Field(..., description="Approved scope")
    field_profile: str = Field(..., description="Approved field profile")
    filters: Optional[Dict[str, Any]] = Field(default=None)
    selected_student_ids: Optional[List[str]] = Field(default=None)
    preview_checksum: Optional[str] = Field(default=None)


@router.post("/preview")
def preview_export(
    req: ExportPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("export_student_data")),
) -> Dict[str, Any]:
    actor_caps = set(capabilities_for_role(user.role))
    return generate_export_preview(
        db,
        scope=req.scope,
        field_profile=req.field_profile,
        filters=req.filters,
        selected_student_ids=req.selected_student_ids,
        actor=user.username,
        actor_capabilities=actor_caps,
    )


@router.post("/download")
def download_export(
    req: ExportDownloadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("export_student_data")),
):
    actor_caps = set(capabilities_for_role(user.role))
    res = execute_student_export(
        db,
        scope=req.scope,
        field_profile=req.field_profile,
        filters=req.filters,
        selected_student_ids=req.selected_student_ids,
        preview_checksum=req.preview_checksum,
        actor=user.username,
        actor_capabilities=actor_caps,
    )
    db.commit()
    return res
