from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from core.config import Settings, settings
from models.user import User
from models.user_session import UserSession


SESSION_COOKIE_NAME = "astyx_session"


@dataclass(frozen=True)
class ValidatedSession:
    session: UserSession
    user: User


def utc_now() -> datetime:
    # Existing ORM columns use timezone-naive UTC DateTime values.
    return datetime.now(UTC).replace(tzinfo=None)


def session_digest(token: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session(
    db: Session,
    user: User,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
    configuration: Settings = settings,
    now: datetime | None = None,
) -> tuple[str, UserSession]:
    created_at = now or utc_now()
    token = secrets.token_urlsafe(32)
    digest = session_digest(token, configuration.require_auth_cookie_secret())
    absolute_expires_at = created_at + timedelta(hours=configuration.SESSION_ABSOLUTE_TIMEOUT_HOURS)
    expires_at = min(
        created_at + timedelta(hours=configuration.SESSION_IDLE_TIMEOUT_HOURS),
        absolute_expires_at,
    )
    session = UserSession(
        user_id=user.id,
        token_hash=digest,
        created_at=created_at,
        last_used_at=created_at,
        expires_at=expires_at,
        absolute_expires_at=absolute_expires_at,
        user_agent=(user_agent or "")[:1024] or None,
        ip_address=(ip_address or "")[:45] or None,
    )
    db.add(session)
    db.flush()
    return token, session


def update_session_activity(
    session: UserSession,
    *,
    configuration: Settings = settings,
    now: datetime | None = None,
) -> None:
    current = now or utc_now()
    session.last_used_at = current
    session.expires_at = min(
        current + timedelta(hours=configuration.SESSION_IDLE_TIMEOUT_HOURS),
        session.absolute_expires_at,
    )


def expire_session(session: UserSession, *, now: datetime | None = None) -> None:
    if session.revoked_at is None:
        session.revoked_at = now or utc_now()


def revoke_session(session: UserSession, *, now: datetime | None = None) -> None:
    expire_session(session, now=now)


def find_session(
    db: Session,
    token: str,
    *,
    configuration: Settings = settings,
) -> UserSession | None:
    if not token:
        return None
    digest = session_digest(token, configuration.require_auth_cookie_secret())
    return db.query(UserSession).filter(UserSession.token_hash == digest).first()


def validate_session(
    db: Session,
    token: str,
    *,
    configuration: Settings = settings,
    now: datetime | None = None,
    refresh_activity: bool = True,
) -> ValidatedSession | None:
    session = find_session(db, token, configuration=configuration)
    if session is None:
        return None
    current = now or utc_now()
    if session.revoked_at is not None:
        return None
    if current >= session.expires_at or current >= session.absolute_expires_at:
        expire_session(session, now=current)
        db.commit()
        return None
    user = db.query(User).filter(User.id == session.user_id).first()
    if user is None or not user.is_active:
        return None
    if refresh_activity:
        update_session_activity(session, configuration=configuration, now=current)
        db.commit()
    return ValidatedSession(session=session, user=user)
