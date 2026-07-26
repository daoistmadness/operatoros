import json
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, StrictStr

from core.config import settings
from core.database import SessionLocal, engine
from models.backup_operation import BackupExecutionHistory
from models.user import User
from security.audit import audit_auth_event
from security.dependencies import require_role
from security.password import verify_password
from security.sessions import SESSION_COOKIE_NAME, session_digest, validate_session
from services.backup_scheduler import append_operations_audit, backup_scheduler, calculate_next_run, execute_backup, get_or_create_config
from services.backup_service import DESTRUCTIVE_OPERATION_LOCK, BackupError, create_backup, delete_backup, resolve_backup_directory, resolve_sqlite_database_path, resolve_verified_backup_for_download
from services.recovery_contract import RecoveryContractError, derive_backup_health, read_sanitized_history, restore_preflight
from services.restore_service import RestoreError, restore_backup


class SanitizedValidationRoute(APIRoute):
    def get_route_handler(self):
        route_handler = super().get_route_handler()

        async def sanitized_route_handler(request: Request):
            try:
                return await route_handler(request)
            except RequestValidationError as exc:
                errors = []
                for error in exc.errors():
                    sanitized = {
                        key: value
                        for key, value in error.items()
                        if key not in {"input", "ctx"}
                    }
                    errors.append(sanitized)
                return JSONResponse(status_code=422, content={"detail": errors})

        return sanitized_route_handler


router = APIRouter(route_class=SanitizedValidationRoute)


def require_restore_admin(
    request: Request,
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    with SessionLocal() as db:
        validated = validate_session(db, token)
        if validated is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        user = validated.user
        identity = User(id=user.id, username=user.username, password_hash=user.password_hash, role=user.role, is_active=user.is_active)
    if identity.role != "admin":
        audit_auth_event(
            backup_dir=settings.BACKUP_DIR,
            event="authorization_denied",
            user_id=identity.id,
            username=identity.username,
            session_id_hash=None,
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
            resource=request.url.path,
            reason="requires_admin",
            metadata={},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return identity


class RestoreRequest(BaseModel):
    current_password: StrictStr = Field(min_length=1, max_length=1024)
    confirmation_filename: StrictStr = Field(min_length=1, max_length=255)
    confirmation_phrase: StrictStr = Field(min_length=1, max_length=64)
    acknowledge_complete_replacement: bool
    acknowledge_session_revocation: bool
    acknowledge_restart_required: bool
    acknowledge_safety_backup: bool
    expected_source_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    expected_active_sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")


_REAUTH_LOCK = threading.Lock()
_REAUTH_FAILURES: dict[int, list[float]] = {}
_REAUTH_WINDOW_SECONDS = 300
_REAUTH_MAX_FAILURES = 5


def _reauthenticate(user: User, password: str) -> bool:
    now = time.monotonic()
    with _REAUTH_LOCK:
        failures = [
            value
            for value in _REAUTH_FAILURES.get(user.id, [])
            if now - value < _REAUTH_WINDOW_SECONDS
        ]
        if len(failures) >= _REAUTH_MAX_FAILURES:
            _REAUTH_FAILURES[user.id] = failures
            return False
    verified = verify_password(user.password_hash, password)
    with _REAUTH_LOCK:
        if verified:
            _REAUTH_FAILURES.pop(user.id, None)
        else:
            failures.append(now)
            _REAUTH_FAILURES[user.id] = failures
    return verified


def _restore_error(status_code: int, code: str, message: str, **details):
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, **details},
    )


class SchedulerConfigRequest(BaseModel):
    enabled: bool
    schedule_type: str = Field(pattern="^(daily|weekly|interval)$")
    interval_minutes: int = Field(ge=1, le=525600)
    hour_utc: int = Field(ge=0, le=23)
    minute_utc: int = Field(ge=0, le=59)
    weekday_utc: int = Field(ge=0, le=6)
    keep_daily: int = Field(ge=0, le=365)
    keep_weekly: int = Field(ge=0, le=260)
    keep_monthly: int = Field(ge=0, le=120)


def _config_payload(config):
    return {
        key: getattr(config, key)
        for key in (
            "enabled",
            "schedule_type",
            "interval_minutes",
            "hour_utc",
            "minute_utc",
            "weekday_utc",
            "keep_daily",
            "keep_weekly",
            "keep_monthly",
            "next_run_at",
            "updated_at",
        )
    }


def _history_payload(row: BackupExecutionHistory):
    return {
        "id": row.id,
        "backup_filename": row.backup_filename,
        "started_at": row.started_at,
        "completed_at": row.completed_at,
        "duration_seconds": row.duration_seconds,
        "status": row.status,
        "error_message": row.error_message,
        "trigger_type": row.trigger_type,
        "size_bytes": row.size_bytes,
        "checksum": row.checksum,
        "integrity_verified": row.integrity_verified,
        "removed_backups": json.loads(row.removed_backups_json or "[]"),
    }


def _backup_dir() -> Path:
    return resolve_backup_directory(settings.BACKUP_DIR)


def _json_error(status_code: int, code: str, message: str):
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


@router.get("/status")
def backup_status(_user: User = Depends(require_role("admin"))):
    try:
        return derive_backup_health(database_url=settings.database_url, backup_dir=settings.BACKUP_DIR)
    except RecoveryContractError as exc:
        _json_error(exc.status_code, exc.reason.upper(), str(exc))
    except BackupError:
        _json_error(500, "BACKUP_STATUS_UNAVAILABLE", "Backup status is unavailable.")


@router.get("")
def list_backups(_user: User = Depends(require_role("admin"))):
    directory = _backup_dir()
    if not directory.exists():
        return []
    entries = []
    for metadata_path in directory.glob("backup_*.sqlite3.meta.json"):
        database_path = Path(str(metadata_path)[: -len(".meta.json")])
        if not database_path.is_file():
            continue
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            entry = {
                "filename": database_path.name,
                "created_at": metadata["created_at"],
                "trigger": metadata["trigger"],
                "size": int(metadata["sqlite_file_size_bytes"]),
                "checksum": metadata["sha256"],
                "schema_version": metadata["schema_version"],
            }
            try:
                preflight = restore_preflight(
                    filename=database_path.name,
                    database_url=settings.database_url,
                    backup_dir=settings.BACKUP_DIR,
                )
                source = preflight["source"]
                entry.update(
                    {
                        "age_seconds": source["age_seconds"],
                        "checksum_status": (
                            "verified"
                            if source["checksum_matches_manifest"]
                            else "mismatch"
                        ),
                        "integrity_status": source["integrity_check"],
                        "verification_state": (
                            "verified"
                            if source["checksum_matches_manifest"]
                            and source["integrity_check"] == "ok"
                            and source["quick_check"] == "ok"
                            else "failed"
                        ),
                        "restore_eligible": source["restore_eligible"],
                        "incompatibility_reasons": source["blocking_reasons"],
                    }
                )
            except (BackupError, OSError, ValueError):
                entry.update(
                    {
                        "checksum_status": "unavailable",
                        "integrity_status": "unavailable",
                        "verification_state": "failed",
                        "restore_eligible": False,
                        "incompatibility_reasons": ["preflight_unavailable"],
                    }
                )
            entries.append(entry)
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            continue
    return sorted(entries, key=lambda item: (item["created_at"], item["filename"]), reverse=True)


@router.post("")
def post_backup(_user: User = Depends(require_role("admin"))):
    if DESTRUCTIVE_OPERATION_LOCK.locked():
        _restore_error(
            409,
            "SYSTEM_MAINTENANCE_OPERATION_ACTIVE",
            "Another maintenance operation is active.",
        )
    execution = execute_backup("MANUAL")
    if execution.status != "SUCCESS" or not execution.backup_filename:
        raise HTTPException(status_code=409 if "already active" in (execution.error_message or "") else 400, detail=execution.error_message or "Backup failed")
    entries = {entry["filename"]: entry for entry in list_backups(_user)}
    entry = entries[execution.backup_filename]
    return {**entry, "sha256": entry["checksum"]}


@router.get("/scheduler")
def get_scheduler_config(_user: User = Depends(require_role("admin"))):
    with SessionLocal() as db:
        return _config_payload(get_or_create_config(db))


@router.put("/scheduler")
def update_scheduler_config(body: SchedulerConfigRequest, user: User = Depends(require_role("admin"))):
    with SessionLocal() as db:
        config = get_or_create_config(db)
        for key, value in body.model_dump().items():
            setattr(config, key, value)
        config.next_run_at = calculate_next_run(config) if config.enabled else None
        from datetime import UTC, datetime
        config.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(config)
        append_operations_audit("scheduler_config_updated", {"user_id": user.id, "enabled": config.enabled, "schedule_type": config.schedule_type})
        return _config_payload(config)


@router.get("/recovery-history")
def recovery_history(_user: User = Depends(require_role("admin"))):
    return read_sanitized_history(backup_dir=settings.BACKUP_DIR)


@router.get("/history")
def backup_history(limit: int = 50, _user: User = Depends(require_role("admin"))):
    safe_limit = min(max(limit, 1), 200)
    with SessionLocal() as db:
        rows = (
            db.query(BackupExecutionHistory)
            .order_by(
                BackupExecutionHistory.started_at.desc(),
                BackupExecutionHistory.id.desc(),
            )
            .limit(safe_limit)
            .all()
        )
        return [_history_payload(row) for row in rows]


@router.post("/{filename}/restore-preflight")
def post_restore_preflight(filename: str, _user: User = Depends(require_restore_admin)):
    try:
        return restore_preflight(filename=filename, database_url=settings.database_url, backup_dir=settings.BACKUP_DIR)
    except RecoveryContractError as exc:
        _json_error(exc.status_code, exc.reason.upper(), str(exc))
    except BackupError as exc:
        _json_error(400, "BACKUP_METADATA_INVALID", str(exc))


@router.post("/{filename}/restore")
def post_restore(
    filename: str,
    body: RestoreRequest,
    request: Request,
    response: Response,
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    user: User = Depends(require_restore_admin),
):
    operation_id = uuid.uuid4().hex
    password = body.current_password
    try:
        if not settings.ENABLE_DESTRUCTIVE_OPERATIONS:
            _restore_error(
                403,
                "RESTORE_DISABLED",
                "Destructive operations are disabled.",
            )
        if not _reauthenticate(user, password):
            _restore_error(
                401,
                "RESTORE_REAUTHENTICATION_FAILED",
                "Restore authorization failed.",
            )
        password = ""
        if body.confirmation_filename != filename:
            _restore_error(
                400,
                "RESTORE_CONFIRMATION_FILENAME_MISMATCH",
                "The confirmation filename does not match.",
            )
        if body.confirmation_phrase != "RESTORE_DATABASE":
            _restore_error(
                400,
                "RESTORE_CONFIRMATION_PHRASE_INVALID",
                "The restore confirmation phrase is invalid.",
            )
        if not all(
            (
                body.acknowledge_complete_replacement,
                body.acknowledge_session_revocation,
                body.acknowledge_restart_required,
                body.acknowledge_safety_backup,
            )
        ):
            _restore_error(
                400,
                "RESTORE_ACKNOWLEDGEMENT_REQUIRED",
                "Every restore safety acknowledgement is required.",
            )
        if DESTRUCTIVE_OPERATION_LOCK.locked():
            _restore_error(
                409,
                "SYSTEM_MAINTENANCE_OPERATION_ACTIVE",
                "Another maintenance operation is active.",
            )
        try:
            preflight = restore_preflight(
                filename=filename,
                database_url=settings.database_url,
                backup_dir=settings.BACKUP_DIR,
            )
        except RecoveryContractError:
            _restore_error(
                409,
                "RESTORE_SOURCE_INVALID",
                "The selected backup no longer passes restore validation.",
            )
        source = preflight["source"]
        active = preflight["active"]
        if source["sha256"] != body.expected_source_sha256:
            _restore_error(
                409,
                "RESTORE_SOURCE_CHANGED",
                "The selected backup changed after verification.",
            )
        if active["active_sha256"] != body.expected_active_sha256:
            _restore_error(
                409,
                "RESTORE_ACTIVE_DATABASE_CHANGED",
                "The active database changed after verification.",
            )
        classification = preflight["impact_classification"]
        if classification == "NO_CHANGE":
            _restore_error(
                409,
                "RESTORE_SOURCE_IDENTICAL",
                "The selected backup is identical to the active database.",
            )
        if classification == "SCHEMA_INCOMPATIBLE":
            _restore_error(
                409,
                "RESTORE_SOURCE_INCOMPATIBLE",
                "The selected backup is not compatible with this application.",
            )
        if not source["restore_eligible"]:
            _restore_error(
                409,
                "RESTORE_SOURCE_INVALID",
                "The selected backup is not eligible for restore.",
            )
        active_path = resolve_sqlite_database_path(settings.database_url)
        backup_root = resolve_backup_directory(settings.BACKUP_DIR)
        reserve_bytes = settings.BACKUP_MIN_FREE_MB * 1024 * 1024
        if (
            shutil.disk_usage(backup_root).free
            < active_path.stat().st_size + reserve_bytes
            or shutil.disk_usage(active_path.parent).free
            < int(source["size_bytes"]) + reserve_bytes
        ):
            _restore_error(
                409,
                "RESTORE_INSUFFICIENT_SPACE",
                "There is not enough free disk space for a protected restore.",
            )
        backup_scheduler.stop()
        try:
            result = restore_backup(
                filename=filename,
                confirmation=body.confirmation_filename,
                database_url=settings.database_url,
                backup_dir=settings.BACKUP_DIR,
                retention_count=settings.BACKUP_RETENTION_COUNT,
                min_free_mb=settings.BACKUP_MIN_FREE_MB,
                destructive_enabled=settings.ENABLE_DESTRUCTIVE_OPERATIONS,
                engine=engine,
                actor={
                    "user_id": user.id,
                    "username": user.username,
                    "role": user.role,
                    "session_digest": session_digest(token or "", settings.require_auth_cookie_secret()) if token else None,
                },
                request_context={
                    "operation_id": operation_id,
                    "ip_address": request.client.host if request.client else None,
                    "user_agent": (request.headers.get("user-agent") or "")[:1024] or None,
                },
                worker_count=settings.BACKEND_WORKERS,
                single_worker_required=settings.RESTORE_SINGLE_WORKER_REQUIRED,
            )
        finally:
            backup_scheduler.start()
        response.delete_cookie(key=SESSION_COOKIE_NAME, path="/", secure=settings.COOKIE_SECURE, httponly=True, samesite="lax")
        restored_path = resolve_sqlite_database_path(settings.database_url)
        with sqlite3.connect(
            f"file:{restored_path}?mode=ro&immutable=1", uri=True
        ) as connection:
            quick = connection.execute("PRAGMA quick_check").fetchone()[0]
            fk_violations = len(
                connection.execute("PRAGMA foreign_key_check").fetchall()
            )
            counts = {
                "students": connection.execute(
                    "SELECT COUNT(*) FROM students"
                ).fetchone()[0],
                "attendance": connection.execute(
                    "SELECT COUNT(*) FROM attendance"
                ).fetchone()[0],
                "enrollments": connection.execute(
                    "SELECT COUNT(*) FROM student_enrollments"
                ).fetchone()[0],
            }
        return {
            "operation_id": operation_id,
            "status": "COMPLETED",
            "restored_backup_filename": result["restored_filename"],
            "completed_at": result["completed_at"],
            "safety_backup_filename": result["pre_restore_snapshot_filename"],
            "post_restore_integrity": "ok",
            "post_restore_quick_check": quick,
            "post_restore_foreign_key_violations": fk_violations,
            "post_restore_students": counts["students"],
            "post_restore_attendance": counts["attendance"],
            "post_restore_enrollments": counts["enrollments"],
            "sessions_revoked": True,
            "restart_required": True,
            "rollback_attempted": False,
            "safe_message": (
                "Restore completed. Close and reopen OperatorOS, then sign in again."
            ),
        }
    except RestoreError as exc:
        payload = {
            "operation_id": operation_id,
            "status": exc.operation_status,
            "requested_backup_filename": filename,
            "safety_backup_filename": exc.safety_backup_filename,
            "rollback_attempted": exc.rollback_attempted,
            "rollback_succeeded": exc.rollback_succeeded,
            "active_data_restored": exc.active_data_restored,
            "restart_required": True,
            "high_severity": (
                exc.operation_status == "FAILED" and exc.rollback_attempted
            ),
            "safe_reason_code": exc.reason.upper(),
            "safe_message": (
                "Restore failed and the prior active database was restored and verified."
                if exc.operation_status == "ROLLED_BACK"
                else "Restore failed. Active database safety could not be confirmed."
            ),
            "safe_next_action": (
                "Close OperatorOS and contact support before another restore attempt."
            ),
            "support_reference": exc.support_reference or operation_id,
        }
        raise HTTPException(status_code=exc.status_code, detail=payload) from exc
    except BackupError:
        _restore_error(
            400,
            "RESTORE_SOURCE_INVALID",
            "The selected backup could not be restored.",
        )
    finally:
        password = ""


@router.delete("/{filename}")
def delete_backup_endpoint(filename: str, user: User = Depends(require_role("admin"))):
    try:
        delete_backup(settings.BACKUP_DIR, filename)
        append_operations_audit("backup_deleted", {"user_id": user.id, "filename": filename})
        return {"status": "success"}
    except BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete backup.") from exc


@router.get("/{filename}/download")
def download_backup(filename: str, user: User = Depends(require_role("admin"))):
    try:
        path = resolve_verified_backup_for_download(settings.BACKUP_DIR, filename)
        return FileResponse(
            path=path,
            filename=filename,
            media_type="application/vnd.sqlite3",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, private",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except BackupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to read backup.") from exc
