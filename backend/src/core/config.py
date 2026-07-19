# config.py
# Application settings loaded from environment variables.
# Tech Stack: FastAPI / Python 3.12

import os
from sqlalchemy.engine import URL
from dotenv import load_dotenv
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

# Load .env from the backend root (two levels above this file: src/core/ -> src/ -> backend/)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


class Settings(BaseSettings):
    DATABASE_URL: str | None = Field(default=None, env="DATABASE_URL")
    POSTGRES_USER: str | None = Field(default=None, env="POSTGRES_USER")
    POSTGRES_PASSWORD: str | None = Field(default=None, env="POSTGRES_PASSWORD")
    POSTGRES_DB: str | None = Field(default=None, env="POSTGRES_DB")
    POSTGRES_HOST: str | None = Field(default=None, env="POSTGRES_HOST")
    POSTGRES_PORT: int | None = Field(default=None, env="POSTGRES_PORT")
    ALLOWED_ORIGINS: str = Field("http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173", env="ALLOWED_ORIGINS")
    HOST: str = Field("0.0.0.0", env="HOST")
    PORT: int = Field(8000, env="PORT")
    ENABLE_DESTRUCTIVE_OPERATIONS: bool = Field(False, env="ENABLE_DESTRUCTIVE_OPERATIONS")
    BACKUP_DIR: str = Field("./backups/", env="BACKUP_DIR")
    BACKUP_RETENTION_COUNT: int = Field(10, ge=1, env="BACKUP_RETENTION_COUNT")
    BACKUP_MIN_FREE_MB: int = Field(100, ge=0, env="BACKUP_MIN_FREE_MB")
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

    @model_validator(mode="after")
    def validate_session_lifetimes(self):
        if self.SESSION_ABSOLUTE_TIMEOUT_HOURS < self.SESSION_IDLE_TIMEOUT_HOURS:
            raise ValueError("SESSION_ABSOLUTE_TIMEOUT_HOURS must be at least SESSION_IDLE_TIMEOUT_HOURS")
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
        postgres_fields = (self.POSTGRES_USER, self.POSTGRES_PASSWORD, self.POSTGRES_DB, self.POSTGRES_HOST, self.POSTGRES_PORT)
        if any(value is not None for value in postgres_fields):
            missing = [
                name
                for name, value in (
                    ("POSTGRES_USER", self.POSTGRES_USER),
                    ("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD),
                    ("POSTGRES_DB", self.POSTGRES_DB),
                    ("POSTGRES_HOST", self.POSTGRES_HOST),
                    ("POSTGRES_PORT", self.POSTGRES_PORT),
                )
                if value in (None, "")
            ]
            if missing:
                raise ValueError(
                    "Missing PostgreSQL configuration values: " + ", ".join(missing)
                )

            return str(
                URL.create(
                    "postgresql+asyncpg",
                    username=self.POSTGRES_USER,
                    password=self.POSTGRES_PASSWORD,
                    host=self.POSTGRES_HOST,
                    port=self.POSTGRES_PORT,
                    database=self.POSTGRES_DB,
                )
            )

        if self.DATABASE_URL:
            return self.DATABASE_URL

        raise ValueError(
            "DATABASE_URL is required unless PostgreSQL connection fields are provided."
        )


settings = Settings()
