from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.upload_conflicts import (
    LINK_CONFIRMATION,
    ROSTER_CONFIRMATION,
    commit_attendance_retry,
    get_upload_conflict,
    link_attendance_device,
    list_upload_conflicts,
    resolve_roster_link,
    retry_attendance_preview,
    roster_comparison,
    student_candidates,
)


router = APIRouter(dependencies=[Depends(get_current_user)])


class LinkDeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_source_checksum: str = Field(min_length=64, max_length=64)
    expected_device_identifier: str = Field(min_length=1, max_length=255)
    student_master_id: str = Field(min_length=36, max_length=36)
    expected_student_version: str = Field(min_length=64, max_length=64)
    confirmation: Literal[LINK_CONFIRMATION]


class ResolveRosterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_source_checksum: str = Field(min_length=64, max_length=64)
    student_master_id: str = Field(min_length=36, max_length=36)
    expected_student_version: str = Field(min_length=64, max_length=64)
    resolution_plan: Literal["LINK_ROW_TO_EXISTING_STUDENT"]
    confirmation: Literal[ROSTER_CONFIRMATION]


class RetryPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_session_id: str = Field(min_length=36, max_length=36)
    source_checksum: str = Field(min_length=64, max_length=64)
    resolution_item_ids: list[str] = Field(min_length=1, max_length=500)
    expected_classification: Literal["CONFLICT"]
    retry_mode: Literal["PREVIEW_ONLY"]


class RetryCommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_session_id: str = Field(min_length=36, max_length=36)
    source_checksum: str = Field(min_length=64, max_length=64)
    resolution_item_ids: list[str] = Field(min_length=1, max_length=500)
    retry_batch_id: str = Field(min_length=36, max_length=36)
    retry_checksum: str = Field(min_length=64, max_length=64)
    selected_retry_row_ids: list[int] = Field(min_length=1, max_length=500)
    confirmation: Literal["COMMIT_ATTENDANCE_IMPORT"]


@router.get("")
def unresolved_queue(
    workflow_type: Literal["ATTENDANCE", "ROSTER"] | None = None,
    technical_code: str | None = Query(default=None, max_length=64),
    resolution_status: Literal[
        "UNRESOLVED",
        "RESOLVED_PENDING_RETRY",
        "RETRIED_COMMITTED",
        "RETRIED_STILL_BLOCKED",
    ]
    | None = None,
    source_session_id: str | None = Query(default=None, max_length=36),
    retry_eligible: bool | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("import_attendance")),
):
    return list_upload_conflicts(
        db,
        workflow_type=workflow_type,
        technical_code=technical_code,
        resolution_status=resolution_status,
        source_session_id=source_session_id,
        retry_eligible=retry_eligible,
        created_from=created_from,
        created_to=created_to,
        page=page,
        page_size=page_size,
    )


@router.get("/{resolution_item_id}")
def conflict_detail(
    resolution_item_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("import_attendance")),
):
    return get_upload_conflict(db, resolution_item_id)


@router.get("/{resolution_item_id}/student-candidates")
def conflict_student_candidates(
    resolution_item_id: str,
    query: str = Query(min_length=2, max_length=255),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student")),
):
    return {"items": student_candidates(db, resolution_item_id, query, limit)}


@router.post("/{resolution_item_id}/link-device")
def link_device(
    resolution_item_id: str,
    body: LinkDeviceRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("manage_device_identity")),
):
    return link_attendance_device(
        db,
        item_id=resolution_item_id,
        expected_checksum=body.expected_source_checksum,
        expected_device_identifier=body.expected_device_identifier,
        student_master_id=body.student_master_id,
        expected_student_version=body.expected_student_version,
        confirmation=body.confirmation,
        actor_id=user.username,
        actor_role=user.role,
    )


@router.get("/{resolution_item_id}/roster-comparison")
def compare_roster_conflict(
    resolution_item_id: str,
    student_master_id: str | None = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("import_student_roster")),
):
    return roster_comparison(db, resolution_item_id, student_master_id)


@router.post("/{resolution_item_id}/resolve-roster")
def resolve_roster(
    resolution_item_id: str,
    body: ResolveRosterRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("resolve_student_duplicates")),
):
    return resolve_roster_link(
        db,
        item_id=resolution_item_id,
        expected_checksum=body.expected_source_checksum,
        student_master_id=body.student_master_id,
        expected_student_version=body.expected_student_version,
        confirmation=body.confirmation,
        actor_id=user.username,
        actor_role=user.role,
    )


@router.post("/retry-preview")
def retry_preview(
    body: RetryPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("import_attendance")),
):
    result = retry_attendance_preview(
        db,
        item_ids=body.resolution_item_ids,
        expected_source_session_id=body.source_session_id,
        expected_source_checksum=body.source_checksum,
        actor_id=user.username,
        actor_role=user.role,
    )
    return result


@router.post("/retry-commit")
def retry_commit(
    body: RetryCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("import_attendance")),
):
    return commit_attendance_retry(
        db,
        item_ids=body.resolution_item_ids,
        source_session_id=body.source_session_id,
        source_checksum=body.source_checksum,
        retry_batch_id=body.retry_batch_id,
        retry_checksum=body.retry_checksum,
        selected_retry_row_ids=body.selected_retry_row_ids,
        confirmation=body.confirmation,
        actor_id=user.username,
        actor_role=user.role,
    )
