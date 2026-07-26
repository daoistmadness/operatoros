"""FastAPI router for OperatorOS CSV Data Portability and Export Center."""

import io
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.operations_audit import OperationsAuditEvent
from models.user import User
from security.dependencies import get_current_user, require_role
from services.csv_contract import DATASET_CONTRACTS
from services.csv_export_service import execute_csv_export, generate_csv_template, generate_export_preview
from services.csv_import_adapter import execute_csv_import_commit, generate_import_error_file, process_csv_import_preview

router = APIRouter()


class ExportPreviewRequest(BaseModel):
    dataset: str
    filters: Optional[Dict[str, Any]] = None
    include_sensitive_fields: bool = False


class ExportRequest(BaseModel):
    dataset: str
    format_type: str = "csv"  # "csv" or "csv_bundle"
    filters: Optional[Dict[str, Any]] = None
    selected_ids: Optional[List[str]] = None
    include_sensitive_fields: bool = False


class ImportCommitRequest(BaseModel):
    batch_id: str
    confirmation: str


class ErrorFileRequest(BaseModel):
    errors: List[Dict[str, Any]]


def _get_user_capabilities(user: User) -> set[str]:
    # Admin gets full capabilities; staff gets standard capabilities
    if user.role == "admin":
        return {
            "export_student_data",
            "export_sensitive_student_fields",
            "import_student_data",
            "manage_device_identities",
            "view_operations_audit",
        }
    return {"export_student_data", "import_student_data"}


@router.get("/datasets")
def list_datasets(user: User = Depends(get_current_user)):
    caps = _get_user_capabilities(user)
    result = []
    for key, c in DATASET_CONTRACTS.items():
        sensitive_gated = c.requires_sensitive_capability
        result.append({
            "identifier": c.identifier,
            "format_version": c.format_version,
            "required_columns": c.required_columns,
            "optional_columns": c.optional_columns,
            "export_eligible": c.export_eligible,
            "import_eligible": c.import_eligible,
            "requires_sensitive_capability": sensitive_gated,
            "has_sensitive_access": "export_sensitive_student_fields" in caps if sensitive_gated else True,
            "update_policy": c.update_policy,
        })
    return result


@router.post("/exports/preview")
def post_export_preview(
    body: ExportPreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    caps = _get_user_capabilities(user)
    return generate_export_preview(
        db,
        dataset=body.dataset,
        filters=body.filters,
        include_sensitive_fields=body.include_sensitive_fields,
        actor=user.username,
        actor_capabilities=caps,
    )


@router.post("/exports")
def post_export(
    body: ExportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    caps = _get_user_capabilities(user)
    return execute_csv_export(
        db,
        dataset=body.dataset,
        format_type=body.format_type,
        filters=body.filters,
        selected_ids=body.selected_ids,
        include_sensitive_fields=body.include_sensitive_fields,
        actor=user.username,
        actor_capabilities=caps,
    )


@router.get("/templates/{dataset}")
def download_template(
    dataset: str,
    user: User = Depends(get_current_user),
):
    return generate_csv_template(dataset)


@router.post("/imports/preview")
async def post_import_preview(
    dataset: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    contents = await file.read()
    return process_csv_import_preview(
        db,
        dataset=dataset,
        file_bytes=contents,
        filename=file.filename or "upload.csv",
        actor=user.username,
    )


@router.post("/imports/commit")
def post_import_commit(
    body: ImportCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin")),
):
    return execute_csv_import_commit(
        db,
        batch_id=body.batch_id,
        confirmation=body.confirmation,
        actor=user.username,
    )


@router.post("/imports/error-file")
def post_error_file(
    body: ErrorFileRequest,
    user: User = Depends(get_current_user),
):
    csv_bytes = generate_import_error_file(body.errors)
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="import_errors.csv"'},
    )


@router.get("/history")
def get_history(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    safe_limit = min(max(limit, 1), 200)
    events = (
        db.query(OperationsAuditEvent)
        .filter(OperationsAuditEvent.entity_type.in_(["CSV_EXPORT", "CSV_IMPORT", "STUDENT_EXPORT"]))
        .order_by(OperationsAuditEvent.occurred_at.desc())
        .limit(safe_limit)
        .all()
    )
    result = []
    for e in events:
        meta = e.audit_metadata or {}
        result.append({
            "id": e.id,
            "timestamp": e.occurred_at.isoformat() if e.occurred_at else "-",
            "operation": e.operation,
            "entity_type": e.entity_type,
            "dataset": e.export_scope or meta.get("dataset") or "-",
            "actor": e.actor_id,
            "role": e.actor_role,
            "success": e.success,
            "failure_code": e.failure_code,
            "row_count": meta.get("row_count") or meta.get("total_rows") or 0,
            "sensitive": meta.get("sensitive", False),
            "format": meta.get("format") or "csv",
        })
    return result
