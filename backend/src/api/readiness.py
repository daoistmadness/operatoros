from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from api.error_responses import raise_internal_error
from models.user import User
from security.dependencies import get_current_user
from services.setup_readiness import build_setup_readiness

router = APIRouter()


class ReadinessStepResponse(BaseModel):
    code: str
    name: str
    status: str
    requirement: str
    reason: str
    destination: str | None
    can_manage: bool
    responsibility: str | None


class ReadinessResponse(BaseModel):
    overall_status: str
    steps: list[ReadinessStepResponse]


@router.get("", response_model=ReadinessResponse)
def get_readiness(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        overall, steps = build_setup_readiness(db, role=user.role)
        return ReadinessResponse(overall_status=overall, steps=[ReadinessStepResponse(**step.__dict__) for step in steps])
    except SQLAlchemyError as exc:
        raise_internal_error("Setup readiness could not be checked. Retry or contact the system administrator.", exc)
