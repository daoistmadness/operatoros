from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.backup_service import resolve_backup_directory


AUTH_AUDIT_FILENAME = "authentication_audit.jsonl"


class AuthenticationAuditError(RuntimeError):
    pass


def append_auth_audit(backup_dir: str, entry: dict[str, Any]) -> None:
    directory = resolve_backup_directory(backup_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / AUTH_AUDIT_FILENAME
    payload = json.dumps(entry, sort_keys=True, ensure_ascii=True) + "\n"
    try:
        descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, payload.encode("utf-8"))
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(path, 0o600)
    except OSError as exc:
        raise AuthenticationAuditError("Authentication audit log could not be persisted.") from exc


def audit_auth_event(
    *,
    backup_dir: str,
    event: str,
    user_id: int | None,
    username: str | None,
    session_id_hash: str | None,
    user_agent: str | None,
    ip_address: str | None,
    metadata: dict[str, Any] | None = None,
    resource: str | None = None,
    reason: str | None = None,
) -> None:
    entry = {
            "timestamp": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "event": event,
            "user_id": user_id,
            "username": (username or "")[:255] or None,
            "session_id_hash": session_id_hash,
            "user_agent": (user_agent or "")[:1024] or None,
            "ip_address": (ip_address or "")[:45] or None,
            "metadata": metadata or {},
    }
    if resource is not None:
        entry["resource"] = resource[:512]
    if reason is not None:
        entry["reason"] = reason[:128]
    append_auth_audit(backup_dir, entry)
