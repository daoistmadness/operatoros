from pathlib import Path

from core.config import Settings, managed_development_database_url


def test_managed_development_uses_canonical_persistent_path(monkeypatch, tmp_path):
    inherited = f"sqlite:///{tmp_path / 'ambient.db'}"
    monkeypatch.setenv("OPERATOROS_MANAGED_DEV_SETUP", "true")
    monkeypatch.setenv("OPERATOROS_DEV_DATA_DIR", str(tmp_path / "managed-data"))

    configuration = Settings(
        DATABASE_URL=inherited,
        OPERATOROS_MANAGED_DEV_SETUP=True,
        AUTH_COOKIE_SECRET="managed-development-test-secret-32-chars",
    )

    expected = tmp_path / "managed-data" / "operatoros-development.db"
    assert configuration.database_url == f"sqlite:///{expected}"
    assert managed_development_database_url() == f"sqlite:///{expected}"
    assert configuration.database_url != inherited


def test_managed_development_ignores_backend_env_style_database_value(monkeypatch, tmp_path):
    monkeypatch.setenv("OPERATOROS_MANAGED_DEV_SETUP", "true")
    monkeypatch.setenv("OPERATOROS_DEV_DATA_DIR", str(tmp_path / "managed-data"))
    configuration = Settings(
        DATABASE_URL="sqlite:///backend-env-value.db",
        OPERATOROS_MANAGED_DEV_SETUP=True,
    )

    assert configuration.database_url.endswith("/managed-data/operatoros-development.db")
    assert "backend-env-value.db" not in configuration.database_url


def test_non_managed_configuration_retains_explicit_database_url(tmp_path):
    database_url = f"sqlite:///{Path(tmp_path / 'non-managed.db')}"
    configuration = Settings(DATABASE_URL=database_url, OPERATOROS_MANAGED_DEV_SETUP=False)

    assert configuration.database_url == database_url
