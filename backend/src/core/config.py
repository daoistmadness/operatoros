# config.py
# Application settings loaded from environment variables.
# Tech Stack: FastAPI / Python 3.12

import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

# Load .env from the backend root (two levels above this file: src/core/ -> src/ -> backend/).
# Managed development replaces only DATABASE_URL after dotenv loading so that a
# stale backend/.env assignment cannot select a different database while other
# non-database local settings retain their established behavior.
if not os.environ.get("PYTEST_CURRENT_TEST") and not os.environ.get("OPERATOROS_ISOLATED_TEST"):
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from core.development_database import (  # noqa: E402
    DevelopmentDatabaseResolutionError,
    resolve_database_path,
    sqlite_url,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def managed_development_database_url() -> str:
    try:
        return sqlite_url(resolve_database_path(REPOSITORY_ROOT))
    except DevelopmentDatabaseResolutionError as exc:
        raise ValueError(f"Managed development database resolution failed: {exc.code}") from exc


if os.environ.get("OPERATOROS_MANAGED_DEV_SETUP", "").strip().lower() in {"1", "true", "yes", "on"}:
    os.environ["DATABASE_URL"] = managed_development_database_url()


class Settings(BaseSettings):
    DATABASE_URL: str | None = Field(default=None, env="DATABASE_URL")
    ALLOWED_ORIGINS: str = Field("http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173", env="ALLOWED_ORIGINS")
    HOST: str = Field("0.0.0.0", env="HOST")
    PORT: int = Field(8000, env="PORT")
    ENABLE_DESTRUCTIVE_OPERATIONS: bool = Field(False, env="ENABLE_DESTRUCTIVE_OPERATIONS")
    BACKUP_DIR: str = Field("./backups/", env="BACKUP_DIR")
    BACKUP_RETENTION_COUNT: int = Field(10, ge=1, env="BACKUP_RETENTION_COUNT")
    BACKUP_MIN_FREE_MB: int = Field(100, ge=0, env="BACKUP_MIN_FREE_MB")
    BACKUP_HEALTH_AGING_HOURS: int = Field(24, ge=1, env="BACKUP_HEALTH_AGING_HOURS")
    BACKUP_HEALTH_STALE_HOURS: int = Field(72, ge=1, env="BACKUP_HEALTH_STALE_HOURS")
    BACKUP_LOW_SPACE_MULTIPLIER: float = Field(2.0, gt=0, env="BACKUP_LOW_SPACE_MULTIPLIER")
    # Phase 7 identity configuration contract. Runtime enforcement begins in Phase 7.2.
    AUTH_COOKIE_SECRET: str | None = Field(default=None, env="AUTH_COOKIE_SECRET")
    COOKIE_SECURE: bool = Field(False, env="COOKIE_SECURE")
    SESSION_IDLE_TIMEOUT_HOURS: int = Field(6, ge=1, le=24, env="SESSION_IDLE_TIMEOUT_HOURS")
    SESSION_ABSOLUTE_TIMEOUT_HOURS: int = Field(24, ge=1, le=168, env="SESSION_ABSOLUTE_TIMEOUT_HOURS")
    MAX_FAILED_LOGIN_ATTEMPTS: int = Field(5, ge=1, env="MAX_FAILED_LOGIN_ATTEMPTS")
    ACCOUNT_LOCK_MINUTES: int = Field(30, ge=1, env="ACCOUNT_LOCK_MINUTES")
    BACKEND_WORKERS: int = Field(1, ge=1, env="BACKEND_WORKERS")
    RESTORE_SINGLE_WORKER_REQUIRED: bool = Field(True, env="RESTORE_SINGLE_WORKER_REQUIRED")
    ASTRYX_SETUP_TOKEN: str | None = Field(default=None, env="ASTRYX_SETUP_TOKEN")
    OPERATOROS_MANAGED_DEV_SETUP: bool = Field(False, env="OPERATOROS_MANAGED_DEV_SETUP")
    OPERATOROS_DEPLOYMENT_MODE: str = Field("multi_user", env="OPERATOROS_DEPLOYMENT_MODE")

    @property
    def resolved_deployment_mode(self) -> str:
        mode = (self.OPERATOROS_DEPLOYMENT_MODE or "").strip().lower()
        if mode in ("single_user_offline", "single_user", "offline"):
            return "single_user_offline"
        return "multi_user"

    @model_validator(mode="after")
    def validate_session_lifetimes(self):
        if self.SESSION_ABSOLUTE_TIMEOUT_HOURS < self.SESSION_IDLE_TIMEOUT_HOURS:
            raise ValueError("SESSION_ABSOLUTE_TIMEOUT_HOURS must be at least SESSION_IDLE_TIMEOUT_HOURS")
        if self.BACKUP_HEALTH_STALE_HOURS <= self.BACKUP_HEALTH_AGING_HOURS:
            raise ValueError("BACKUP_HEALTH_STALE_HOURS must be greater than BACKUP_HEALTH_AGING_HOURS")
        return self

    def require_auth_cookie_secret(self) -> str:
        secret = self.AUTH_COOKIE_SECRET
        if secret is None or len(secret.strip()) < 32:
            raise ValueError("AUTH_COOKIE_SECRET must be configured with at least 32 characters")
        return secret

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    @property
    def database_url(self) -> str:
        if any(os.environ.get(name) for name in (
            "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_HOST", "POSTGRES_PORT"
        )):
            raise ValueError("OperatorOS desktop supports SQLite databases only.")

        if self.OPERATOROS_MANAGED_DEV_SETUP:
            return managed_development_database_url()

        if self.DATABASE_URL:
            # Enforce protected path guard on self.DATABASE_URL
            from pathlib import Path
            from sqlalchemy.engine import make_url
            url_obj = make_url(self.DATABASE_URL)
            if not url_obj.drivername.startswith("sqlite"):
                raise ValueError("OperatorOS desktop supports SQLite databases only.")
            if url_obj.database and url_obj.database != ":memory:":
                raw_database = Path(url_obj.database)
                resolved_db = raw_database.resolve()
                root = Path(__file__).resolve().parent.parent.parent.parent
                protected_paths = {
                    (root / "backend" / "attendance.db").resolve(),
                    (root / "attendance.db").resolve(),
                }
                is_relative_protected_name = (
                    not raw_database.is_absolute()
                    and raw_database.as_posix() in {"attendance.db", "backend/attendance.db"}
                )
                is_protected = is_relative_protected_name or resolved_db in protected_paths or (
                    resolved_db.name == "attendance.db" and resolved_db.parent == root
                )
                if is_protected:
                    from core.database_access_context import protected_path_is_permitted

                    if protected_path_is_permitted(resolved_db):
                        return self.DATABASE_URL
                    raise ValueError(f"PROTECTED_DATABASE_PATH_REJECTED: Direct access or fallbacks to protected database ({resolved_db}) are strictly prohibited.")
            return self.DATABASE_URL

        raise ValueError(
            "DATABASE_URL is required and must identify a SQLite database."
        )


settings = Settings()
