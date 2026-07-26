from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.operator_work_queue_service import build_operator_work_queue

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/work-queue")
def get_operator_work_queue(
    db: Session = Depends(get_db),
    user: User = Depends(require_capability("view_attendance_followups")),
) -> List[Dict[str, Any]]:
    return build_operator_work_queue(db, user)
