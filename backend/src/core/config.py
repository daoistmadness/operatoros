# config.py
# Application settings loaded from environment variables.
# Tech Stack: FastAPI / Python 3.12

import os
from sqlalchemy.engine import URL
from dotenv import load_dotenv
from pydantic import Field
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
    ALLOWED_ORIGINS: str = Field("http://localhost:3000", env="ALLOWED_ORIGINS")
    HOST: str = Field("0.0.0.0", env="HOST")
    PORT: int = Field(8000, env="PORT")
    ENABLE_DESTRUCTIVE_OPERATIONS: bool = Field(False, env="ENABLE_DESTRUCTIVE_OPERATIONS")

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
