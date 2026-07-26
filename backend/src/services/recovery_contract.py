"""Backend-authoritative backup health and read-only restore preflight."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote

from core.config import settings
from services.backup_scheduler import EXECUTION_LOCK, OPERATIONS_AUDIT_FILENAME
from services.backup_service import (
    DESTRUCTIVE_OPERATION_LOCK,
    BackupError,
    calculate_sha256,
    resolve_backup_directory,
    resolve_sqlite_database_path,
)
from services.restore_service import (
    AUDIT_FILENAME,
    BACKUP_FILENAME,
    REQUIRED_SESSION_COLUMNS,
    REQUIRED_USER_COLUMNS,
)


HEALTH_STATES = frozenset(
    {
        "HEALTHY",
        "AGING",
        "STALE",
        "NO_BACKUP",
        "LAST_BACKUP_FAILED",
        "DESTINATION_UNAVAILABLE",
        "LOW_DISK_SPACE",
        "BACKUP_IN_PROGRESS",
        "RESTORE_IN_PROGRESS",
        "UNKNOWN",
    }
)
IMPACT_CLASSIFICATIONS = frozenset(
    {
        "NO_CHANGE",
        "LOW_IMPACT",
        "DATA_REDUCTION",
        "DATA_INCREASE",
        "HIGH_RISK",
        "SCHEMA_INCOMPATIBLE",
        "INVALID_BACKUP",
        "UNKNOWN",
    }
)
OPERATIONAL_COUNT_TABLES = {
    "students": "students",
    "attendance": "attendance",
    "enrollments": "student_enrollments",
}
HIGH_RISK_REDUCTION_RATIO = 0.25
HIGH_RISK_AGE_DAYS = 30


class RecoveryContractError(BackupError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        reason: str = "recovery_contract_invalid",
    ):
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _aware(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise RecoveryContractError(
            "Backup timestamp is invalid.", reason="metadata_invalid"
        ) from exc
    if parsed.tzinfo is None:
        raise RecoveryContractError(
            "Backup timestamp must include a timezone.", reason="metadata_invalid"
        )
    return parsed.astimezone(UTC)


def _readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)


def _metadata_path(database_path: Path) -> Path:
    return Path(f"{database_path}.meta.json")


def _safe_directory_display(path: Path) -> str:
    return path.name or "backup-directory"


def _read_json_lines(path: Path) -> list[dict[str, Any]]:
    if not path.is_file() or path.is_symlink():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    for raw in lines:
        try:
            row = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _load_manifest(path: Path, filename: str) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink():
        raise RecoveryContractError(
            "Backup manifest is missing.", status_code=404, reason="manifest_missing"
        )
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RecoveryContractError(
            "Backup manifest is invalid.", reason="manifest_invalid"
        ) from exc
    required = {
        "created_at",
        "trigger",
        "schema_version",
        "sqlite_file_size_bytes",
        "sha256",
        "source_db_path",
        "backup_tool_version",
    }
    if not isinstance(metadata, dict) or not required <= metadata.keys():
        raise RecoveryContractError(
            "Backup manifest is invalid.", reason="manifest_invalid"
        )
    if metadata.get("filename") not in (None, filename):
        raise RecoveryContractError(
            "Backup manifest filename does not match.",
            reason="manifest_filename_mismatch",
        )
    if (
        not isinstance(metadata["sha256"], str)
        or len(metadata["sha256"]) != 64
        or not isinstance(metadata["sqlite_file_size_bytes"], int)
    ):
        raise RecoveryContractError(
            "Backup manifest is invalid.", reason="manifest_invalid"
        )
    _aware(metadata["created_at"])
    return metadata


def _validate_thresholds() -> tuple[int, int, float]:
    aging = settings.BACKUP_HEALTH_AGING_HOURS
    stale = settings.BACKUP_HEALTH_STALE_HOURS
    multiplier = settings.BACKUP_LOW_SPACE_MULTIPLIER
    if aging <= 0 or stale <= aging or multiplier <= 0:
        raise RecoveryContractError(
            "Backup health thresholds are invalid.",
            status_code=500,
            reason="backup_threshold_invalid",
        )
    return aging, stale, multiplier


def _operation_failure(backup_root: Path) -> tuple[str | None, str | None]:
    rows = _read_json_lines(backup_root / OPERATIONS_AUDIT_FILENAME)
    for row in reversed(rows):
        event = row.get("event")
        if event == "backup_failed":
            return str(row.get("timestamp") or "") or None, "BACKUP_FAILED"
        if event == "backup_succeeded":
            return None, None
    return None, None


def _legacy_status_fields(
    *,
    latest_at: str | None,
    latest_outcome: str | None,
    free_space: int | None,
    database_path: Path | None,
) -> dict[str, Any]:
    return {
        "latest_backup_timestamp": latest_at,
        "latest_backup_outcome": latest_outcome,
        "free_disk_space_bytes": free_space,
        "database_basename": database_path.name if database_path else None,
        "sqlite_journal_mode": "unknown",
        "destructive_operations_enabled": settings.ENABLE_DESTRUCTIVE_OPERATIONS,
        "authentication_available": True,
        "restore_support_mode": "single_process_only",
        "restore_requires_admin": True,
        "restore_requires_reauthentication": True,
        "restore_multi_worker_safe": False,
    }


def _empty_health(
    state: str,
    *,
    now: datetime,
    backup_root: Path | None,
    database_path: Path | None,
    available: bool,
    error_code: str | None = None,
) -> dict[str, Any]:
    payload = {
        "health_state": state,
        "last_successful_backup_at": None,
        "last_failed_backup_at": None,
        "last_failure_code": error_code,
        "last_failure_message": (
            "Backup status is unavailable." if error_code else None
        ),
        "latest_backup_filename": None,
        "latest_backup_type": None,
        "latest_backup_size_bytes": None,
        "latest_backup_checksum_status": None,
        "latest_backup_integrity_status": None,
        "latest_backup_schema_version": None,
        "backup_age_seconds": None,
        "next_scheduled_backup_at": None,
        "backup_count": 0,
        "retention_limit": settings.BACKUP_RETENTION_COUNT,
        "backup_directory_display": (
            _safe_directory_display(backup_root) if backup_root else "Unavailable"
        ),
        "backup_directory_available": available,
        "free_space_bytes": None,
        "minimum_required_space_bytes": None,
        "low_space": None,
        "backup_in_progress": EXECUTION_LOCK.locked(),
        "restore_in_progress": DESTRUCTIVE_OPERATION_LOCK.locked(),
        "generated_at_utc": now.isoformat().replace("+00:00", "Z"),
    }
    payload.update(
        _legacy_status_fields(
            latest_at=None,
            latest_outcome=None,
            free_space=None,
            database_path=database_path,
        )
    )
    if error_code:
        payload["error_code"] = error_code
    return payload


def derive_backup_health(
    *,
    database_url: str,
    backup_dir: str,
    now: datetime | None = None,
    disk_usage: Callable[[Path], Any] = shutil.disk_usage,
) -> dict[str, Any]:
    """Derive health without creating or modifying the backup destination."""
    aging_hours, stale_hours, multiplier = _validate_thresholds()
    generated_at = (now or _utc_now()).astimezone(UTC)
    try:
        database_path = resolve_sqlite_database_path(database_url)
        backup_root = resolve_backup_directory(backup_dir)
    except BackupError:
        return _empty_health(
            "UNKNOWN",
            now=generated_at,
            backup_root=None,
            database_path=None,
            available=False,
            error_code="BACKUP_STATUS_UNAVAILABLE",
        )

    restore_active = DESTRUCTIVE_OPERATION_LOCK.locked()
    backup_active = EXECUTION_LOCK.locked()
    if restore_active:
        return _empty_health(
            "RESTORE_IN_PROGRESS",
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=backup_root.is_dir(),
        )
    if backup_active:
        return _empty_health(
            "BACKUP_IN_PROGRESS",
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=backup_root.is_dir(),
        )

    if backup_root.exists() and (
        not backup_root.is_dir() or backup_root.is_symlink()
    ):
        return _empty_health(
            "DESTINATION_UNAVAILABLE",
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=False,
            error_code="BACKUP_DESTINATION_UNAVAILABLE",
        )
    if not backup_root.exists():
        parent = backup_root.parent
        available = parent.is_dir() and not parent.is_symlink()
        return _empty_health(
            "NO_BACKUP" if available else "DESTINATION_UNAVAILABLE",
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=available,
            error_code=None if available else "BACKUP_DESTINATION_UNAVAILABLE",
        )

    try:
        free_space = int(disk_usage(backup_root).free)
        source_size = database_path.stat().st_size
        filenames = sorted(
            path.name
            for path in backup_root.glob("backup_*.sqlite3")
            if path.is_file() and not path.is_symlink()
        )
    except (OSError, ValueError):
        return _empty_health(
            "DESTINATION_UNAVAILABLE",
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=False,
            error_code="BACKUP_DESTINATION_UNAVAILABLE",
        )

    records: list[tuple[datetime, Path, dict[str, Any]]] = []
    invalid_present = False
    for filename in filenames:
        path = backup_root / filename
        try:
            metadata = _load_manifest(_metadata_path(path), filename)
            records.append((_aware(metadata["created_at"]), path, metadata))  # type: ignore[arg-type]
        except RecoveryContractError:
            invalid_present = True
    records.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    failed_at, failure_code = _operation_failure(backup_root)
    minimum_required = max(1, int(source_size * multiplier))
    low_space = free_space < minimum_required

    if not records:
        state = "LAST_BACKUP_FAILED" if invalid_present or failure_code else "NO_BACKUP"
        payload = _empty_health(
            state,
            now=generated_at,
            backup_root=backup_root,
            database_path=database_path,
            available=True,
        )
        payload.update(
            {
                "last_failed_backup_at": failed_at,
                "last_failure_code": failure_code or (
                    "BACKUP_MANIFEST_INVALID" if invalid_present else None
                ),
                "last_failure_message": (
                    "The latest backup could not be verified."
                    if invalid_present or failure_code
                    else None
                ),
                "free_space_bytes": free_space,
                "free_disk_space_bytes": free_space,
                "minimum_required_space_bytes": minimum_required,
                "low_space": low_space,
            }
        )
        return payload

    created_at, latest_path, metadata = records[0]
    age_seconds = max(0, int((generated_at - created_at).total_seconds()))
    try:
        checksum_status = (
            "verified"
            if calculate_sha256(latest_path) == metadata["sha256"]
            else "mismatch"
        )
        with _readonly(latest_path) as connection:
            integrity_status = (
                "ok"
                if connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                else "failed"
            )
    except (OSError, sqlite3.Error):
        checksum_status = "unavailable"
        integrity_status = "failed"

    if checksum_status != "verified" or integrity_status != "ok" or invalid_present:
        state = "LAST_BACKUP_FAILED"
    elif low_space:
        state = "LOW_DISK_SPACE"
    elif age_seconds >= stale_hours * 3600:
        state = "STALE"
    elif age_seconds >= aging_hours * 3600:
        state = "AGING"
    else:
        state = "HEALTHY"

    payload = {
        "health_state": state,
        "last_successful_backup_at": metadata["created_at"],
        "last_failed_backup_at": failed_at,
        "last_failure_code": failure_code,
        "last_failure_message": (
            "The most recent backup attempt failed." if failure_code else None
        ),
        "latest_backup_filename": latest_path.name,
        "latest_backup_type": str(metadata["trigger"]),
        "latest_backup_size_bytes": int(metadata["sqlite_file_size_bytes"]),
        "latest_backup_checksum_status": checksum_status,
        "latest_backup_integrity_status": integrity_status,
        "latest_backup_schema_version": metadata["schema_version"],
        "backup_age_seconds": age_seconds,
        "next_scheduled_backup_at": None,
        "backup_count": len(records),
        "retention_limit": settings.BACKUP_RETENTION_COUNT,
        "backup_directory_display": _safe_directory_display(backup_root),
        "backup_directory_available": True,
        "free_space_bytes": free_space,
        "minimum_required_space_bytes": minimum_required,
        "low_space": low_space,
        "backup_in_progress": False,
        "restore_in_progress": False,
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
    }
    payload.update(
        _legacy_status_fields(
            latest_at=metadata["created_at"],
            latest_outcome="failed" if state == "LAST_BACKUP_FAILED" else "success",
            free_space=free_space,
            database_path=database_path,
        )
    )
    return payload


def _validate_filename(filename: str) -> None:
    decoded = unquote(filename)
    if (
        decoded != filename
        or Path(filename).name != filename
        or not BACKUP_FILENAME.fullmatch(filename)
    ):
        raise RecoveryContractError(
            "Invalid backup filename.", reason="invalid_filename"
        )


def _inspect_database(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "integrity_check": "failed",
        "quick_check": "failed",
        "foreign_key_violation_count": None,
        "schema_version": None,
        "counts": None,
        "identity_compatible": False,
        "identity_reasons": [],
    }
    try:
        with _readonly(path) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            quick = connection.execute("PRAGMA quick_check").fetchone()
            result["integrity_check"] = (
                "ok" if integrity and integrity[0] == "ok" else "failed"
            )
            result["quick_check"] = "ok" if quick and quick[0] == "ok" else "failed"
            result["foreign_key_violation_count"] = len(
                connection.execute("PRAGMA foreign_key_check").fetchall()
            )
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            required = set(OPERATIONAL_COUNT_TABLES.values()) | {
                "users",
                "sessions",
                "operatoros_schema_migrations",
            }
            missing = sorted(required - tables)
            if missing:
                result["identity_reasons"].append("required_tables_missing")
                return result
            result["counts"] = {
                key: int(
                    connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[
                        0
                    ]
                )
                for key, table in OPERATIONAL_COUNT_TABLES.items()
            }
            row = connection.execute(
                "SELECT version FROM operatoros_schema_migrations "
                "ORDER BY applied_at DESC, version DESC LIMIT 1"
            ).fetchone()
            result["schema_version"] = row[0] if row else None
            user_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(users)")
            }
            session_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(sessions)")
            }
            if not REQUIRED_USER_COLUMNS <= user_columns:
                result["identity_reasons"].append("identity_columns_incomplete")
            if not REQUIRED_SESSION_COLUMNS <= session_columns:
                result["identity_reasons"].append("session_columns_incomplete")
            if not result["identity_reasons"]:
                admin = connection.execute(
                    "SELECT 1 FROM users WHERE role='admin' AND is_active=1 LIMIT 1"
                ).fetchone()
                if admin is None:
                    result["identity_reasons"].append("no_active_admin")
            result["identity_compatible"] = not result["identity_reasons"]
    except sqlite3.Error:
        result["identity_reasons"] = ["invalid_sqlite"]
    return result


def classify_impact(
    *,
    same_checksum: bool,
    checksum_matches: bool,
    integrity_status: str,
    quick_status: str,
    fk_violations: int | None,
    source_schema: str | None,
    active_schema: str | None,
    source_is_older: bool,
    possible_data_loss: bool,
    count_delta: dict[str, int],
    identity_compatible: bool,
    major_reduction: bool = False,
    source_substantially_older: bool = False,
) -> str:
    if same_checksum:
        return "NO_CHANGE"
    if (
        not checksum_matches
        or integrity_status != "ok"
        or quick_status != "ok"
        or fk_violations is None
        or fk_violations > 0
    ):
        return "INVALID_BACKUP"
    if (
        not identity_compatible
        or not source_schema
        or not active_schema
        or source_schema != active_schema
    ):
        return "SCHEMA_INCOMPATIBLE"
    if major_reduction or source_substantially_older:
        return "HIGH_RISK"
    if any(value < 0 for value in count_delta.values()):
        return "DATA_REDUCTION"
    if any(value > 0 for value in count_delta.values()):
        return "DATA_INCREASE"
    if possible_data_loss or source_is_older:
        return "LOW_IMPACT"
    return "LOW_IMPACT"


def restore_preflight(
    *, filename: str, database_url: str, backup_dir: str
) -> dict[str, Any]:
    """Validate and compare a restore source without mutating either database."""
    _validate_filename(filename)
    backup_root = resolve_backup_directory(backup_dir)
    backup_path = backup_root / filename
    manifest_path = _metadata_path(backup_path)
    if backup_path.is_symlink() or manifest_path.is_symlink():
        raise RecoveryContractError(
            "Symbolic links are not valid restore sources.", reason="symlink_rejected"
        )
    if not backup_path.is_file():
        raise RecoveryContractError(
            "Backup source was not found.", status_code=404, reason="source_missing"
        )
    metadata = _load_manifest(manifest_path, filename)
    active_path = resolve_sqlite_database_path(database_url)
    source_checksum = calculate_sha256(backup_path)
    checksum_matches = source_checksum == metadata["sha256"]
    same_checksum = (
        calculate_sha256(active_path) == source_checksum
        if active_path.is_file()
        else False
    )
    source = _inspect_database(backup_path)
    active = _inspect_database(active_path)
    source_counts = source["counts"] or {
        "students": 0,
        "attendance": 0,
        "enrollments": 0,
    }
    active_counts = active["counts"] or {
        "students": 0,
        "attendance": 0,
        "enrollments": 0,
    }
    deltas = {
        "student_delta": source_counts["students"] - active_counts["students"],
        "attendance_delta": source_counts["attendance"]
        - active_counts["attendance"],
        "enrollment_delta": source_counts["enrollments"]
        - active_counts["enrollments"],
    }
    source_created = _aware(metadata["created_at"])
    age_seconds = max(0, int((_utc_now() - source_created).total_seconds()))
    source_is_older = bool(
        source["schema_version"]
        and active["schema_version"]
        and source["schema_version"] < active["schema_version"]
    )
    major_reduction = any(
        active_counts[key] > 0
        and source_counts[key]
        <= active_counts[key] * (1 - HIGH_RISK_REDUCTION_RATIO)
        for key in active_counts
    )
    source_substantially_older = age_seconds >= HIGH_RISK_AGE_DAYS * 86400
    possible_data_loss = any(value < 0 for value in deltas.values())
    classification = classify_impact(
        same_checksum=same_checksum,
        checksum_matches=checksum_matches,
        integrity_status=source["integrity_check"],
        quick_status=source["quick_check"],
        fk_violations=source["foreign_key_violation_count"],
        source_schema=source["schema_version"],
        active_schema=active["schema_version"],
        source_is_older=source_is_older,
        possible_data_loss=possible_data_loss,
        count_delta=deltas,
        identity_compatible=source["identity_compatible"],
        major_reduction=major_reduction,
        source_substantially_older=source_substantially_older,
    )
    blockers: list[str] = []
    if not checksum_matches:
        blockers.append("checksum_mismatch")
    if source["integrity_check"] != "ok":
        blockers.append("integrity_failed")
    if source["quick_check"] != "ok":
        blockers.append("quick_check_failed")
    if source["foreign_key_violation_count"]:
        blockers.append("foreign_key_violations")
    blockers.extend(source["identity_reasons"])
    if classification == "NO_CHANGE":
        blockers.append("source_identical_to_active")
    if classification == "SCHEMA_INCOMPATIBLE":
        blockers.append("schema_incompatible")
    warnings = []
    if source_is_older:
        warnings.append("source_is_older")
    if possible_data_loss:
        warnings.append("possible_data_loss")
    if classification == "HIGH_RISK":
        warnings.append("high_risk")
    eligible = classification not in {
        "NO_CHANGE",
        "SCHEMA_INCOMPATIBLE",
        "INVALID_BACKUP",
        "UNKNOWN",
    }
    return {
        "source": {
            "filename": filename,
            "backup_type": metadata["trigger"],
            "created_at": metadata["created_at"],
            "age_seconds": age_seconds,
            "size_bytes": metadata["sqlite_file_size_bytes"],
            "checksum_matches_manifest": checksum_matches,
            "integrity_check": source["integrity_check"],
            "quick_check": source["quick_check"],
            "foreign_key_violation_count": source[
                "foreign_key_violation_count"
            ],
            "schema_version": source["schema_version"],
            "identity_compatible": source["identity_compatible"],
            "application_compatible": (
                source["schema_version"] == active["schema_version"]
            ),
            "restore_eligible": eligible,
            "blocking_reasons": sorted(set(blockers)),
            "warning_reasons": sorted(set(warnings)),
        },
        "active": {
            "active_schema_version": active["schema_version"],
            "active_students": active_counts["students"],
            "active_attendance": active_counts["attendance"],
            "active_enrollments": active_counts["enrollments"],
            "source_students": source_counts["students"],
            "source_attendance": source_counts["attendance"],
            "source_enrollments": source_counts["enrollments"],
            **deltas,
            "same_database_content": same_checksum,
            "source_is_older": source_is_older,
            "possible_data_loss": possible_data_loss,
            "sessions_will_be_revoked": True,
            "restart_required": True,
            "pre_restore_backup_will_be_created": True,
        },
        "impact_classification": classification,
    }


def _safe_filename(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value if BACKUP_FILENAME.fullmatch(value) else None


def _safe_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = "".join(
        char for char in value.upper() if char.isalnum() or char == "_"
    )[:80]
    return candidate or None


def _safe_reference(value: Any) -> str | None:
    if not isinstance(value, (str, int)):
        return None
    candidate = "".join(
        char for char in str(value) if char.isalnum() or char in {"-", "_"}
    )[:100]
    return candidate or None


def read_sanitized_history(*, backup_dir: str) -> list[dict[str, Any]]:
    directory = resolve_backup_directory(backup_dir)
    history: list[dict[str, Any]] = []
    for row in _read_json_lines(directory / AUDIT_FILENAME):
        context = row.get("request_context")
        context = context if isinstance(context, dict) else {}
        actor = row.get("authenticated_username")
        if not isinstance(actor, str) or not actor.strip():
            user_id = row.get("authenticated_user_id")
            actor = f"user-{user_id}" if isinstance(user_id, int) else "unknown"
        history.append(
            {
                "timestamp": (
                    row.get("timestamp")
                    if isinstance(row.get("timestamp"), str)
                    else None
                ),
                "filename": _safe_filename(row.get("target_filename")),
                "event": _safe_code(row.get("event")),
                "actor_display": actor[:100],
                "result": _safe_code(row.get("outcome")),
                "safe_reason_code": _safe_code(row.get("reason")),
                "operation_reference_id": _safe_reference(
                    context.get("operation_id") or context.get("request_id")
                ),
                "safety_backup_filename": _safe_filename(
                    row.get("pre_restore_snapshot_filename")
                ),
            }
        )
    return history
