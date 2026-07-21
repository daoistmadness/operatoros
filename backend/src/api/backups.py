import json
import shutil
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictStr

from core.config import settings
from core.database import SessionLocal, engine
from models.user import User
from security.dependencies import require_role
from security.audit import audit_auth_event
from security.sessions import SESSION_COOKIE_NAME, session_digest, validate_session
from services.backup_service import BackupError, create_backup, resolve_backup_directory, resolve_sqlite_database_path, delete_backup, resolve_verified_backup_for_download
from services.restore_service import AUDIT_FILENAME, RestoreError, restore_backup
from models.backup_operation import BackupExecutionHistory
from services.backup_scheduler import backup_scheduler, append_operations_audit, calculate_next_run, execute_backup, get_or_create_config


router = APIRouter()


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
        identity = User(id=user.id, username=user.username, password_hash="", role=user.role, is_active=user.is_active)
    if identity.role != "admin":
        audit_auth_event(
            backup_dir=settings.BACKUP_DIR, event="authorization_denied", user_id=identity.id,
            username=identity.username, session_id_hash=None, user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None, resource=request.url.path,
            reason="requires_admin", metadata={},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return identity


class RestoreRequest(BaseModel):
    confirmation: StrictStr


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
    return {key: getattr(config, key) for key in (
        "enabled", "schedule_type", "interval_minutes", "hour_utc", "minute_utc", "weekday_utc",
        "keep_daily", "keep_weekly", "keep_monthly", "next_run_at", "updated_at",
    )}


def _history_payload(row: BackupExecutionHistory):
    return {
        "id": row.id, "backup_filename": row.backup_filename, "started_at": row.started_at,
        "completed_at": row.completed_at, "duration_seconds": row.duration_seconds, "status": row.status,
        "error_message": row.error_message, "trigger_type": row.trigger_type, "size_bytes": row.size_bytes,
        "checksum": row.checksum, "integrity_verified": row.integrity_verified,
        "removed_backups": json.loads(row.removed_backups_json or "[]"),
    }


def _backup_dir() -> Path:
    return resolve_backup_directory(settings.BACKUP_DIR)


def _list_entries() -> list[dict]:
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
            entries.append({
                "filename": database_path.name,
                "created_at": metadata["created_at"],
                "trigger": metadata["trigger"],
                "size": int(metadata["sqlite_file_size_bytes"]),
                "checksum": metadata["sha256"],
                "schema_version": metadata["schema_version"],
            })
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            continue
    return sorted(entries, key=lambda item: (item["created_at"], item["filename"]), reverse=True)


def _latest_audit_outcome(directory: Path) -> str | None:
    path = directory / AUDIT_FILENAME
    if not path.is_file():
        return None
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        return json.loads(lines[-1])["outcome"] if lines else None
    except (OSError, KeyError, json.JSONDecodeError):
        return "audit_unavailable"


@router.get("/status")
def backup_status(_user: User = Depends(require_role("admin"))):
    try:
        database_path = resolve_sqlite_database_path(settings.database_url)
        directory = _backup_dir()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        entries = _list_entries()
        connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
        try:
            journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            connection.close()
        return {
            "latest_backup_timestamp": entries[0]["created_at"] if entries else None,
            "latest_backup_outcome": _latest_audit_outcome(directory),
            "backup_count": len(entries),
            "retention_limit": settings.BACKUP_RETENTION_COUNT,
            "free_disk_space_bytes": shutil.disk_usage(directory).free,
            "database_basename": database_path.name,
            "sqlite_journal_mode": journal_mode,
            "destructive_operations_enabled": settings.ENABLE_DESTRUCTIVE_OPERATIONS,
            "authentication_available": True,
            "restore_support_mode": "single_process_only",
            "restore_requires_admin": True,
            "restore_requires_reauthentication": True,
            "restore_multi_worker_safe": False,
        }
    except (BackupError, OSError, sqlite3.Error) as exc:
        raise HTTPException(status_code=500, detail="Backup status is unavailable.") from exc


@router.get("")
def list_backups(_user: User = Depends(require_role("admin"))):
    return _list_entries()


@router.post("")
def post_backup(_user: User = Depends(require_role("admin"))):
    execution = execute_backup("MANUAL")
    if execution.status != "SUCCESS" or not execution.backup_filename:
        raise HTTPException(status_code=409 if "already active" in (execution.error_message or "") else 400, detail=execution.error_message or "Backup failed")
    entries = {entry["filename"]: entry for entry in _list_entries()}
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


@router.get("/history")
def backup_history(limit: int = 50, _user: User = Depends(require_role("admin"))):
    safe_limit = min(max(limit, 1), 200)
    with SessionLocal() as db:
        rows = db.query(BackupExecutionHistory).order_by(BackupExecutionHistory.started_at.desc(), BackupExecutionHistory.id.desc()).limit(safe_limit).all()
        return [_history_payload(row) for row in rows]


@router.post("/{filename}/restore")
def post_restore(
    filename: str,
    body: RestoreRequest,
    request: Request,
    response: Response,
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    user: User = Depends(require_restore_admin),
):
    try:
        # Windows cannot atomically replace an open SQLite file. Suspend the
        # scheduler so it cannot acquire a new connection during the guarded
        # checkpoint/dispose/replace sequence, then always restore ownership.
        backup_scheduler.stop()
        try:
            result = restore_backup(
                filename=filename,
                confirmation=body.confirmation,
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
                    "ip_address": request.client.host if request.client else None,
                    "user_agent": (request.headers.get("user-agent") or "")[:1024] or None,
                },
                worker_count=settings.BACKEND_WORKERS,
                single_worker_required=settings.RESTORE_SINGLE_WORKER_REQUIRED,
            )
        finally:
            backup_scheduler.start()
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/",
            secure=settings.COOKIE_SECURE,
            httponly=True,
            samesite="lax",
        )
        return result
    except RestoreError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except BackupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to read backup.") from exc
