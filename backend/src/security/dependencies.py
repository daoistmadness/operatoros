from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import settings
from models.user import User
from security.audit import audit_auth_event
from security.sessions import SESSION_COOKIE_NAME, validate_session
from security.capabilities import STUDENT_CAPABILITIES, capabilities_for_role


def get_optional_user(
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    db: Session = Depends(get_db),
) -> User | None:
    if not token:
        return None
    validated = validate_session(db, token)
    return validated.user if validated else None


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return user


def require_role(role: str):
    if role not in {"admin", "staff"}:
        raise ValueError("Unsupported authorization role")

    def role_dependency(request: Request, user: User = Depends(get_current_user)) -> User:
        if user.role != role:
            audit_auth_event(
                backup_dir=settings.BACKUP_DIR,
                event="authorization_denied",
                user_id=user.id,
                username=user.username,
                session_id_hash=None,
                user_agent=request.headers.get("user-agent"),
                ip_address=request.client.host if request.client else None,
                resource=request.url.path,
                reason=f"requires_{role}",
                metadata={},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return role_dependency


def require_capability(capability: str):
    if capability not in STUDENT_CAPABILITIES:
        raise ValueError("Unsupported student-management capability")

    def capability_dependency(request: Request, user: User = Depends(get_current_user)) -> User:
        if capability not in capabilities_for_role(user.role):
            audit_auth_event(
                backup_dir=settings.BACKUP_DIR,
                event="authorization_denied",
                user_id=user.id,
                username=user.username,
                session_id_hash=None,
                user_agent=request.headers.get("user-agent"),
                ip_address=request.client.host if request.client else None,
                resource=request.url.path,
                reason="missing_capability",
                metadata={"capability": capability},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return capability_dependency


def get_authenticated_user_id(user: User) -> int:
    return user.id


def get_authenticated_username(user: User) -> str:
    return user.username
