"""Environment settings retained by schema and migration tooling."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.engine import make_url


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    DATABASE_URL: str | None = os.environ.get("DATABASE_URL")
    BACKUP_DIR: str = os.environ.get("BACKUP_DIR", "./backups/")
    BACKUP_RETENTION_COUNT: int = int(os.environ.get("BACKUP_RETENTION_COUNT", "10"))
    BACKUP_MIN_FREE_MB: int = int(os.environ.get("BACKUP_MIN_FREE_MB", "100"))
    BACKUP_HEALTH_AGING_HOURS: int = int(os.environ.get("BACKUP_HEALTH_AGING_HOURS", "24"))
    BACKUP_HEALTH_STALE_HOURS: int = int(os.environ.get("BACKUP_HEALTH_STALE_HOURS", "72"))
    BACKUP_LOW_SPACE_MULTIPLIER: float = float(os.environ.get("BACKUP_LOW_SPACE_MULTIPLIER", "2.0"))
    ENABLE_DESTRUCTIVE_OPERATIONS: bool = _bool("ENABLE_DESTRUCTIVE_OPERATIONS", False)
    BACKEND_WORKERS: int = int(os.environ.get("BACKEND_WORKERS", "1"))
    OPERATOROS_DEPLOYMENT_MODE: str = os.environ.get("OPERATOROS_DEPLOYMENT_MODE", "multi_user")

    @property
    def resolved_deployment_mode(self) -> str:
        if self.OPERATOROS_DEPLOYMENT_MODE.strip().lower() in {"single_user_offline", "single_user", "offline"}:
            return "single_user_offline"
        return "multi_user"

    @property
    def database_url(self) -> str:
        if not self.DATABASE_URL:
            raise ValueError("DATABASE_URL is required and must identify a SQLite database.")
        url = make_url(self.DATABASE_URL)
        if not url.drivername.startswith("sqlite"):
            raise ValueError("OperatorOS supports SQLite databases only.")
        return self.DATABASE_URL


settings = Settings()
