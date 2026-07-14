from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from core.config import Settings, settings
from models.user import User
from models.user_session import UserSession
from security.audit import audit_auth_event
from security.password import hash_password, verify_password
from security.sessions import create_session, find_session, revoke_session, utc_now


GENERIC_LOGIN_ERROR = "Invalid username or password"
_DUMMY_PASSWORD_HASH = hash_password("astryx-dummy-password-not-an-account")


class AuthenticationFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class LoginResult:
    user: User
    session: UserSession
    token: str


def _audit_failure(
    *,
    configuration: Settings,
    user: User | None,
    submitted_username: str,
    user_agent: str | None,
    ip_address: str | None,
    reason: str,
) -> None:
    audit_auth_event(
        backup_dir=configuration.BACKUP_DIR,
        event="login_failed",
        user_id=user.id if user else None,
        username=user.username if user else submitted_username,
        session_id_hash=None,
        user_agent=user_agent,
        ip_address=ip_address,
        metadata={"reason": reason},
    )


def authenticate_user(
    db: Session,
    *,
    username: str,
    password: str,
    user_agent: str | None,
    ip_address: str | None,
    configuration: Settings = settings,
) -> LoginResult:
    normalized_username = username.strip()
    now = utc_now()
    user = db.query(User).filter(User.username == normalized_username).first()

    if user is None:
        verify_password(_DUMMY_PASSWORD_HASH, password)
        _audit_failure(
            configuration=configuration,
            user=None,
            submitted_username=normalized_username,
            user_agent=user_agent,
            ip_address=ip_address,
            reason="invalid_credentials",
        )
        raise AuthenticationFailure(GENERIC_LOGIN_ERROR)

    if not user.is_active:
        _audit_failure(
            configuration=configuration,
            user=user,
            submitted_username=normalized_username,
            user_agent=user_agent,
            ip_address=ip_address,
            reason="inactive_account",
        )
        raise AuthenticationFailure(GENERIC_LOGIN_ERROR)

    if user.locked_until is not None and user.locked_until > now:
        _audit_failure(
            configuration=configuration,
            user=user,
            submitted_username=normalized_username,
            user_agent=user_agent,
            ip_address=ip_address,
            reason="account_locked",
        )
        raise AuthenticationFailure(GENERIC_LOGIN_ERROR)

    if not verify_password(user.password_hash, password):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= configuration.MAX_FAILED_LOGIN_ATTEMPTS:
            user.locked_until = now + timedelta(minutes=configuration.ACCOUNT_LOCK_MINUTES)
        db.commit()
        _audit_failure(
            configuration=configuration,
            user=user,
            submitted_username=normalized_username,
            user_agent=user_agent,
            ip_address=ip_address,
            reason="invalid_credentials",
        )
        raise AuthenticationFailure(GENERIC_LOGIN_ERROR)

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    token, session = create_session(
        db,
        user,
        user_agent=user_agent,
        ip_address=ip_address,
        configuration=configuration,
        now=now,
    )
    db.commit()
    audit_auth_event(
        backup_dir=configuration.BACKUP_DIR,
        event="login_success",
        user_id=user.id,
        username=user.username,
        session_id_hash=session.token_hash,
        user_agent=user_agent,
        ip_address=ip_address,
        metadata={},
    )
    return LoginResult(user=user, session=session, token=token)


def logout_user(
    db: Session,
    *,
    token: str | None,
    user_agent: str | None,
    ip_address: str | None,
    configuration: Settings = settings,
) -> None:
    session = find_session(db, token or "", configuration=configuration)
    user = db.query(User).filter(User.id == session.user_id).first() if session else None
    if session is not None:
        revoke_session(session)
        db.commit()
    audit_auth_event(
        backup_dir=configuration.BACKUP_DIR,
        event="logout",
        user_id=user.id if user else None,
        username=user.username if user else None,
        session_id_hash=session.token_hash if session else None,
        user_agent=user_agent,
        ip_address=ip_address,
        metadata={"session_found": session is not None},
    )
