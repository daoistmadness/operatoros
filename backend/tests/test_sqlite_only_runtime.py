from pathlib import Path

import pytest

from core.config import Settings


ROOT = Path(__file__).resolve().parents[2]


def test_sqlite_database_url_is_supported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'runtime.db'}")

    assert Settings(_env_file=None).database_url.startswith("sqlite:///")


@pytest.mark.parametrize(
    "scheme",
    ["postgres", "postgresql", "postgresql+asyncpg", "postgresql+psycopg", "mysql+pymysql"],
)
def test_postgresql_database_urls_are_rejected_safely(
    scheme: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret_url = f"{scheme}://operator:do-not-leak@example.invalid/operatoros"
    monkeypatch.setenv("DATABASE_URL", secret_url)

    with pytest.raises(ValueError) as exc_info:
        _ = Settings(_env_file=None).database_url

    message = str(exc_info.value)
    assert "OperatorOS desktop supports SQLite databases only." in message
    assert "do-not-leak" not in message
    assert "operator:" not in message


def test_runtime_has_no_postgresql_driver_or_container_contract() -> None:
    requirements = (ROOT / "backend" / "requirements.txt").read_text(encoding="utf-8")
    sidecar = (ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    assert "asyncpg" not in requirements
    assert "asyncpg" not in sidecar
    assert "docker compose" not in workflow.lower()
    assert not (ROOT / "docker-compose.yml").exists()
    assert not (ROOT / "backend" / "Dockerfile").exists()
    assert not (ROOT / "frontend" / "Dockerfile").exists()


def test_startup_does_not_import_asyncpg(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    _ = Settings(_env_file=None).database_url

    import sys

    assert "asyncpg" not in sys.modules
