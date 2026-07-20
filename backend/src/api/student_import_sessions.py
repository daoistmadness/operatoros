from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.student_rollback_service import execute_compensating_rollback, generate_rollback_preview


router = APIRouter(prefix="/api/student-import-sessions", tags=["student-import-sessions"])


class RollbackCommitRequest(BaseModel):
    preview_checksum: str = Field(..., description="Preview checksum obtained from rollback-preview")
    mode: str = Field(default="WHOLE_SESSION", description="WHOLE_SESSION or SELECTED_ACTIONS")
    selected_action_ids: Optional[List[int]] = Field(default=None, description="Action IDs to compensate if mode is SELECTED_ACTIONS")
    reason: str = Field(..., min_length=5, description="Reason for performing compensating rollback")
    confirmation_value: str = Field(..., description="Descriptive confirmation token matching ROLLBACK_SESSION_<UUID_8>")
    idempotency_token: str = Field(..., min_length=8, description="Unique client-supplied idempotency key")


@router.post("/{session_id}/rollback-preview")
def preview_rollback(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("rollback_import_session")),
) -> Dict[str, Any]:
    return generate_rollback_preview(db, session_id, actor=user.username)


@router.post("/{session_id}/rollback")
def commit_rollback(
    session_id: str,
    req: RollbackCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("rollback_import_session")),
) -> Dict[str, Any]:
    res = execute_compensating_rollback(
        db,
        session_id,
        preview_checksum=req.preview_checksum,
        mode=req.mode,
        selected_action_ids=req.selected_action_ids,
        reason=req.reason,
        confirmation_value=req.confirmation_value,
        idempotency_token=req.idempotency_token,
        actor=user.username,
    )
    db.commit()
    return res
