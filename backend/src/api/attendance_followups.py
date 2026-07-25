from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.attendance_followup import AttendanceFollowUpAudit
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.attendance_followup_service import (
    add_case_note,
    create_or_materialize_followup,
    discover_exception_candidates,
    get_followup_metrics,
    query_followup_cases,
    serialize_followup,
    update_case_workflow_state,
)

router = APIRouter(prefix="/api/attendance/followups", tags=["attendance-followups"])


class CreateFollowUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exception_key: str = Field(min_length=1)
    exception_kind: str = Field(min_length=1)
    student_master_id: Optional[int] = None
    student_enrollment_id: Optional[int] = None
    attendance_id: Optional[int] = None
    attendance_correction_request_id: Optional[int] = None
    early_departure_excuse_id: Optional[int] = None
    academic_class_id: Optional[int] = None
    academic_year_id: Optional[int] = None
    exception_date: Optional[date] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    source_snapshot: Optional[Dict[str, Any]] = None
    priority: str = Field(default="MEDIUM")
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None


class UpdateFollowUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Optional[int] = None
    priority: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None


class AssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assigned_to_user_id: int = Field(gt=0)
    version: Optional[int] = None


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolution_code: str = Field(min_length=1)
    resolution_note: Optional[str] = None
    version: Optional[int] = None


class DismissRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    explanation: str = Field(min_length=1)
    resolution_code: Optional[str] = Field(default="DISMISSED")
    version: Optional[int] = None


class ReopenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1)
    version: Optional[int] = None


class AddNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1)
    note_type: str = Field(default="INTERNAL_NOTE")


class BulkAssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follow_up_ids: List[int] = Field(min_length=1)
    assigned_to_user_id: int = Field(gt=0)


class BulkResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follow_up_ids: List[int] = Field(min_length=1)
    resolution_code: str = Field(min_length=1)
    resolution_note: Optional[str] = None


@router.get("/candidates")
def get_candidates(
    class_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followups")),
):
    candidates = discover_exception_candidates(
        db, user, class_id=class_id, status_filter=status_filter, date_from=date_from, date_to=date_to
    )
    return {"total": len(candidates), "items": candidates}


@router.get("")
def list_cases(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    exception_kind: Optional[str] = Query(None),
    assigned_to_user_id: Optional[int] = Query(None),
    academic_class_id: Optional[int] = Query(None),
    is_overdue: Optional[bool] = Query(None),
    unassigned_only: bool = Query(False),
    my_cases_only: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followups")),
):
    cases = query_followup_cases(
        db,
        user,
        status=status,
        priority=priority,
        exception_kind=exception_kind,
        assigned_to_user_id=assigned_to_user_id,
        academic_class_id=academic_class_id,
        is_overdue=is_overdue,
        unassigned_only=unassigned_only,
        my_cases_only=my_cases_only,
    )
    items = [serialize_followup(c, include_notes=False) for c in cases]
    return {"total": len(items), "items": items}


@router.get("/metrics/summary")
def get_metrics_summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followups")),
):
    return get_followup_metrics(db, user)


@router.post("")
def create_case(
    body: CreateFollowUpRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("create_attendance_followup")),
):
    case = create_or_materialize_followup(
        db,
        user,
        exception_key=body.exception_key,
        exception_kind=body.exception_kind,
        student_master_id=body.student_master_id,
        student_enrollment_id=body.student_enrollment_id,
        attendance_id=body.attendance_id,
        attendance_correction_request_id=body.attendance_correction_request_id,
        early_departure_excuse_id=body.early_departure_excuse_id,
        academic_class_id=body.academic_class_id,
        academic_year_id=body.academic_year_id,
        exception_date=body.exception_date,
        period_start=body.period_start,
        period_end=body.period_end,
        source_snapshot=body.source_snapshot,
        priority=body.priority,
        assigned_to_user_id=body.assigned_to_user_id,
        due_at=body.due_at,
    )
    return serialize_followup(case)


@router.get("/{id}")
def get_case_detail(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followups")),
):
    cases = query_followup_cases(db, user)
    matching = next((c for c in cases if c.id == id), None)
    if not matching:
        raise HTTPException(status_code=404, detail={"code": "ATTENDANCE_FOLLOWUP_NOT_FOUND", "message": f"Follow-up case #{id} not found."})
    return serialize_followup(matching, include_notes=True)


@router.patch("/{id}")
def update_case(
    id: int,
    body: UpdateFollowUpRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("update_attendance_followup")),
):
    cases = query_followup_cases(db, user)
    matching = next((c for c in cases if c.id == id), None)
    if not matching:
        raise HTTPException(status_code=404, detail={"code": "ATTENDANCE_FOLLOWUP_NOT_FOUND", "message": f"Follow-up case #{id} not found."})

    updated = update_case_workflow_state(
        db,
        user,
        id,
        target_status=matching.status,
        version=body.version,
        assigned_to_user_id=body.assigned_to_user_id,
        priority=body.priority,
        due_at=body.due_at,
    )
    return serialize_followup(updated)


@router.post("/{id}/assign")
def assign_case(
    id: int,
    body: AssignRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("assign_attendance_followup")),
):
    cases = query_followup_cases(db, user)
    matching = next((c for c in cases if c.id == id), None)
    if not matching:
        raise HTTPException(status_code=404, detail={"code": "ATTENDANCE_FOLLOWUP_NOT_FOUND", "message": f"Follow-up case #{id} not found."})

    updated = update_case_workflow_state(
        db,
        user,
        id,
        target_status=matching.status,
        version=body.version,
        assigned_to_user_id=body.assigned_to_user_id,
    )
    return serialize_followup(updated)


@router.post("/{id}/acknowledge")
def acknowledge_case(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("update_attendance_followup")),
):
    updated = update_case_workflow_state(db, user, id, target_status="ACKNOWLEDGED")
    return serialize_followup(updated)


@router.post("/{id}/start")
def start_case(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("update_attendance_followup")),
):
    updated = update_case_workflow_state(db, user, id, target_status="IN_PROGRESS")
    return serialize_followup(updated)


@router.post("/{id}/monitor")
def monitor_case(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("update_attendance_followup")),
):
    updated = update_case_workflow_state(db, user, id, target_status="MONITORING")
    return serialize_followup(updated)


@router.post("/{id}/resolve")
def resolve_case(
    id: int,
    body: ResolveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("resolve_attendance_followup")),
):
    updated = update_case_workflow_state(
        db,
        user,
        id,
        target_status="RESOLVED",
        version=body.version,
        resolution_code=body.resolution_code,
        resolution_note=body.resolution_note,
    )
    return serialize_followup(updated)


@router.post("/{id}/dismiss")
def dismiss_case(
    id: int,
    body: DismissRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("resolve_attendance_followup")),
):
    updated = update_case_workflow_state(
        db,
        user,
        id,
        target_status="DISMISSED",
        version=body.version,
        resolution_code=body.resolution_code,
        resolution_note=body.explanation,
    )
    return serialize_followup(updated)


@router.post("/{id}/reopen")
def reopen_case(
    id: int,
    body: ReopenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("reopen_attendance_followup")),
):
    updated = update_case_workflow_state(
        db,
        user,
        id,
        target_status="REOPENED",
        version=body.version,
        resolution_note=body.reason,
    )
    return serialize_followup(updated)


@router.post("/{id}/notes")
def add_note(
    id: int,
    body: AddNoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("update_attendance_followup")),
):
    note = add_case_note(db, user, id, body=body.body, note_type=body.note_type)
    return {
        "id": note.id,
        "follow_up_id": note.follow_up_id,
        "note_type": note.note_type,
        "body": note.body,
        "created_by_user_id": note.created_by_user_id,
        "created_at": note.created_at.isoformat() if note.created_at else None,
    }


@router.get("/{id}/history")
def get_case_history(
    id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followup_audit")),
):
    rows = (
        db.query(AttendanceFollowUpAudit)
        .filter(AttendanceFollowUpAudit.follow_up_id == id)
        .order_by(AttendanceFollowUpAudit.timestamp.asc())
        .all()
    )
    history = [
        {
            "id": r.id,
            "follow_up_id": r.follow_up_id,
            "actor": r.actor,
            "action": r.action,
            "before_summary": r.before_summary,
            "after_summary": r.after_summary,
            "metadata_payload": r.metadata_payload,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        }
        for r in rows
    ]
    return {"follow_up_id": id, "history": history}


@router.post("/bulk-assign")
def bulk_assign(
    body: BulkAssignRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("assign_attendance_followup")),
):
    try:
        updated_items = []
        for case_id in body.follow_up_ids:
            cases = query_followup_cases(db, user)
            matching = next((c for c in cases if c.id == case_id), None)
            if not matching:
                raise HTTPException(status_code=404, detail={"code": "ATTENDANCE_FOLLOWUP_NOT_FOUND", "message": f"Case #{case_id} not found."})
            up = update_case_workflow_state(
                db, user, case_id, target_status=matching.status, assigned_to_user_id=body.assigned_to_user_id
            )
            updated_items.append(serialize_followup(up, include_notes=False))
        return {"total_updated": len(updated_items), "items": updated_items}
    except Exception as exc:
        db.rollback()
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(
            status_code=400,
            detail={"code": "ATTENDANCE_FOLLOWUP_BULK_TRANSACTION_FAILED", "message": "Bulk assignment failed transactionally. Rolled back."},
        )


@router.post("/bulk-resolve")
def bulk_resolve(
    body: BulkResolveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("resolve_attendance_followup")),
):
    try:
        updated_items = []
        for case_id in body.follow_up_ids:
            up = update_case_workflow_state(
                db,
                user,
                case_id,
                target_status="RESOLVED",
                resolution_code=body.resolution_code,
                resolution_note=body.resolution_note,
            )
            updated_items.append(serialize_followup(up, include_notes=False))
        return {"total_updated": len(updated_items), "items": updated_items}
    except Exception as exc:
        db.rollback()
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(
            status_code=400,
            detail={"code": "ATTENDANCE_FOLLOWUP_BULK_TRANSACTION_FAILED", "message": "Bulk resolution failed transactionally. Rolled back."},
        )
