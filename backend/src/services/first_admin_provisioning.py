from __future__ import annotations

import hmac
import logging
import threading
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.config import Settings, settings
from models.first_admin_setup import FirstAdminSetupState
from models.user import User
from security.audit import AuthenticationAuditError, audit_auth_event
from security.password import hash_password
from security.sessions import utc_now


logger = logging.getLogger(__name__)
_PROCESS_PROVISIONING_LOCK = threading.Lock()


class ProvisioningError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class SetupStatus:
    setup_required: bool
    setup_token_required: bool


def get_setup_status(db: Session, *, configuration: Settings = settings) -> SetupStatus:
    has_user = db.query(User.id).first() is not None
    state = db.get(FirstAdminSetupState, 1)
    return SetupStatus(
        setup_required=not has_user and not bool(state and state.completed),
        setup_token_required=(
            not has_user
            and not bool(state and state.completed)
            and bool(configuration.ASTRYX_SETUP_TOKEN)
            and not configuration.OPERATOROS_MANAGED_DEV_SETUP
        ),
    )


def _validate_token(*, supplied: str | None, configuration: Settings, required_for_source: bool) -> None:
    configured = configuration.ASTRYX_SETUP_TOKEN
    if not required_for_source or not configured:
        return
    if not supplied:
        raise ProvisioningError("SETUP_TOKEN_REQUIRED", "A valid setup token is required.", 403)
    if not hmac.compare_digest(supplied, configured):
        raise ProvisioningError("SETUP_TOKEN_INVALID", "A valid setup token is required.", 403)


def _begin_locked_transaction(db: Session) -> str:
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
    else:
        db.begin()
    db.execute(
        text(
            "INSERT INTO first_admin_setup_state (id, completed) "
            "VALUES (1, :completed) ON CONFLICT (id) DO NOTHING"
        ),
        {"completed": False},
    )
    return dialect


def provision_first_admin(
    db: Session,
    *,
    username: str,
    password: str,
    setup_token: str | None,
    provisioning_source: str,
    require_setup_token: bool,
    user_agent: str | None = None,
    ip_address: str | None = None,
    configuration: Settings = settings,
) -> User:
    normalized_username = username.strip()
    if not normalized_username or len(normalized_username) > 255:
        raise ProvisioningError("INVALID_ADMIN_USERNAME", "A valid administrator username is required.", 400)
    _validate_token(supplied=setup_token, configuration=configuration, required_for_source=require_setup_token)

    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        raise ProvisioningError("PASSWORD_POLICY_FAILED", str(exc), 400) from exc

    created_user: User | None = None
    setup_already_completed = False
    with _PROCESS_PROVISIONING_LOCK:
        try:
            dialect = _begin_locked_transaction(db)
            state_query = db.query(FirstAdminSetupState).filter(FirstAdminSetupState.id == 1)
            if dialect == "postgresql":
                state_query = state_query.with_for_update()
            state = state_query.one()
            existing_user = db.query(User).order_by(User.id).first()
            if state.completed or existing_user is not None:
                if not state.completed:
                    state.completed = True
                    state.completed_at = utc_now()
                    state.created_user_id = existing_user.id if existing_user else None
                    state.normalized_username = existing_user.username if existing_user else None
                    state.provisioning_source = "LEGACY_EXISTING_USER"
                db.commit()
                setup_already_completed = True
            else:
                created_user = User(
                    username=normalized_username,
                    password_hash=password_hash,
                    role="admin",
                    is_active=True,
                )
                db.add(created_user)
                db.flush()
                state.completed = True
                state.completed_at = utc_now()
                state.created_user_id = created_user.id
                state.normalized_username = normalized_username
                state.provisioning_source = provisioning_source[:32]
                db.commit()
                db.refresh(created_user)
        except ProvisioningError:
            db.rollback()
            raise
        except SQLAlchemyError as exc:
            db.rollback()
            logger.exception("First administrator database transaction failed")
            raise ProvisioningError("PROVISIONING_FAILED", "Administrator provisioning could not be completed.", 500) from exc
        except Exception:
            db.rollback()
            raise

    if setup_already_completed:
        raise ProvisioningError("SETUP_ALREADY_COMPLETED", "Initial administrator setup has already been completed.", 409)
    assert created_user is not None
    try:
        audit_auth_event(
            backup_dir=configuration.BACKUP_DIR,
            event="FIRST_ADMIN_PROVISIONED",
            user_id=created_user.id,
            username=created_user.username,
            session_id_hash=None,
            user_agent=user_agent,
            ip_address=ip_address,
            metadata={"provisioning_source": provisioning_source[:32]},
        )
    except AuthenticationAuditError:
        logger.exception("First administrator JSONL audit mirror could not be persisted")
    return created_user
