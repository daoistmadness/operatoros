import json
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from api.setup import router as setup_router
from core.config import Settings
from core.database import Base, get_db
from models.first_admin_setup import FirstAdminSetupState
from models.user import User
from security.password import verify_password
from services.first_admin_provisioning import ProvisioningError, get_setup_status, provision_first_admin


def database_factory(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'setup.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine, tables=[User.__table__, FirstAdminSetupState.__table__])
    return sessionmaker(bind=engine), engine


def configuration(tmp_path: Path, token: str | None = None) -> Settings:
    return Settings(
        DATABASE_URL=f"sqlite:///{tmp_path / 'config.db'}",
        AUTH_COOKIE_SECRET="first-admin-test-cookie-secret-32-characters",
        ASTRYX_SETUP_TOKEN=token,
        BACKUP_DIR=str(tmp_path / "backups"),
    )


def provision(session, tmp_path, **overrides):
    values = {
        "username": "  Admin  ",
        "password": "correct horse battery",
        "setup_token": None,
        "provisioning_source": "WEB_SETUP",
        "require_setup_token": True,
        "configuration": configuration(tmp_path),
    }
    values.update(overrides)
    return provision_first_admin(session, **values)


def test_setup_status_empty_then_closed_after_argon2_admin(tmp_path):
    factory, _ = database_factory(tmp_path)
    with factory() as db:
        assert get_setup_status(db, configuration=configuration(tmp_path)).setup_required is True
        user = provision(db, tmp_path)
        assert (user.username, user.role, user.is_active) == ("Admin", "admin", True)
        assert user.password_hash.startswith("$argon2id$")
        assert verify_password(user.password_hash, "correct horse battery")
        status = get_setup_status(db, configuration=configuration(tmp_path))
        assert status.setup_required is False
        state = db.get(FirstAdminSetupState, 1)
        assert state.completed and state.created_user_id == user.id
        assert state.normalized_username == "Admin"
        assert state.provisioning_source == "WEB_SETUP"
    audit = (tmp_path / "backups" / "authentication_audit.jsonl").read_text()
    payload = json.loads(audit)
    assert payload["event"] == "FIRST_ADMIN_PROVISIONED"
    assert payload["metadata"] == {"provisioning_source": "WEB_SETUP"}
    assert "password" not in audit and "setup_token" not in audit


def test_existing_user_closes_setup_without_disclosure(tmp_path):
    factory, _ = database_factory(tmp_path)
    with factory() as db:
        db.add(User(username="existing", password_hash="hash", role="admin"))
        db.commit()
        status = get_setup_status(db, configuration=configuration(tmp_path, "secret-token"))
        assert status.setup_required is False
        assert status.setup_token_required is False
        with pytest.raises(ProvisioningError, match="already been completed") as caught:
            provision(db, tmp_path)
        assert caught.value.code == "SETUP_ALREADY_COMPLETED"


@pytest.mark.parametrize(("supplied", "code"), [(None, "SETUP_TOKEN_REQUIRED"), ("wrong", "SETUP_TOKEN_INVALID")])
def test_setup_token_is_required_and_constant_contract_is_safe(tmp_path, supplied, code):
    factory, _ = database_factory(tmp_path)
    with factory() as db:
        with pytest.raises(ProvisioningError) as caught:
            provision(db, tmp_path, setup_token=supplied, configuration=configuration(tmp_path, "deployment-token"))
        assert caught.value.code == code
        assert str(caught.value) == "A valid setup token is required."
        assert db.query(User).count() == 0


def test_password_policy_rolls_back_without_state_or_audit(tmp_path):
    factory, _ = database_factory(tmp_path)
    with factory() as db:
        with pytest.raises(ProvisioningError) as caught:
            provision(db, tmp_path, password="short")
        assert caught.value.code == "PASSWORD_POLICY_FAILED"
        assert db.query(User).count() == 0
        assert db.query(FirstAdminSetupState).count() == 0
    assert not (tmp_path / "backups" / "authentication_audit.jsonl").exists()


def test_database_commit_failure_rolls_back_user_and_setup_state(tmp_path, monkeypatch):
    factory, _ = database_factory(tmp_path)
    with factory() as db:
        monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(SQLAlchemyError("forced")))
        with pytest.raises(ProvisioningError) as caught:
            provision(db, tmp_path)
        assert caught.value.code == "PROVISIONING_FAILED"
    with factory() as verification:
        assert verification.query(User).count() == 0
        assert verification.query(FirstAdminSetupState).count() == 0
    assert not (tmp_path / "backups" / "authentication_audit.jsonl").exists()


def test_two_simultaneous_sqlite_attempts_create_exactly_one_admin_and_audit(tmp_path):
    factory, _ = database_factory(tmp_path)
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(name):
        with factory() as db:
            barrier.wait()
            try:
                outcomes.append(("created", provision(db, tmp_path, username=name).username))
            except ProvisioningError as exc:
                outcomes.append(("error", exc.code))

    threads = [threading.Thread(target=attempt, args=(name,)) for name in ("first", "second")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
        assert not thread.is_alive()
    assert sorted(item[0] for item in outcomes) == ["created", "error"]
    assert ("error", "SETUP_ALREADY_COMPLETED") in outcomes
    with factory() as db:
        assert db.query(User).count() == 1
        assert db.query(FirstAdminSetupState).filter_by(completed=True).count() == 1
    audit_lines = (tmp_path / "backups" / "authentication_audit.jsonl").read_text().splitlines()
    assert len(audit_lines) == 1


def test_setup_api_contract_and_password_confirmation(tmp_path, monkeypatch):
    factory, _ = database_factory(tmp_path)
    app = FastAPI()
    app.include_router(setup_router, prefix="/api/setup")

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr("api.setup.get_setup_status", lambda db: get_setup_status(db, configuration=configuration(tmp_path)))
    original = provision_first_admin
    monkeypatch.setattr(
        "api.setup.provision_first_admin",
        lambda db, **kwargs: original(db, configuration=configuration(tmp_path), **kwargs),
    )
    client = TestClient(app)
    status_response = client.get("/api/setup/status")
    assert status_response.json() == {"setup_required": True, "setup_token_required": False}
    assert status_response.headers["cache-control"] == "no-store"
    mismatch = client.post("/api/setup/admin", json={"username": "admin", "password": "correct horse battery", "password_confirmation": "different password"})
    assert mismatch.status_code == 400
    assert mismatch.json()["detail"]["code"] == "PASSWORD_CONFIRMATION_MISMATCH"
    created = client.post("/api/setup/admin", json={"username": "admin", "password": "correct horse battery", "password_confirmation": "correct horse battery"})
    assert created.status_code == 201
    assert created.json()["role"] == "admin"
    completed = client.post("/api/setup/admin", json={"username": "second", "password": "correct horse battery", "password_confirmation": "correct horse battery"})
    assert completed.status_code == 409
    assert completed.json()["detail"]["code"] == "SETUP_ALREADY_COMPLETED"


def test_cli_uses_shared_service_and_never_prints_password(monkeypatch, capsys):
    import cli

    calls = []
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(cli.sys.stderr, "isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _prompt: "admin")
    answers = iter(["correct horse battery", "correct horse battery"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: next(answers))
    monkeypatch.setattr(cli, "SessionLocal", lambda: type("DB", (), {"close": lambda self: None})())
    monkeypatch.setattr(cli, "provision_first_admin", lambda db, **kwargs: calls.append(kwargs))
    assert cli.main(["create-admin"]) == 0
    output = capsys.readouterr()
    assert calls[0]["provisioning_source"] == "CLI_SETUP"
    assert calls[0]["require_setup_token"] is False
    assert "correct horse battery" not in output.out + output.err


def test_postgresql_migration_and_service_lock_contract_are_present():
    root = Path(__file__).resolve().parents[2]
    migration = (root / "backend/migrations/20260714_first_admin_setup_postgresql.sql").read_text()
    service = (root / "backend/src/services/first_admin_provisioning.py").read_text()
    assert "ON CONFLICT (id) DO NOTHING" in migration
    assert "ON DELETE RESTRICT" in migration
    assert "with_for_update()" in service


def test_sqlite_setup_migration_is_repeatable_after_identity_schema():
    import sqlite3

    root = Path(__file__).resolve().parents[2]
    identity = (root / "backend/migrations/20260713_identity_schema_sqlite.sql").read_text()
    setup = (root / "backend/migrations/20260714_first_admin_setup_sqlite.sql").read_text()
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(identity)
    connection.executescript(setup)
    connection.executescript(setup)
    assert connection.execute("SELECT completed FROM first_admin_setup_state WHERE id=1").fetchone() == (0,)
    connection.close()
