import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
MIGRATIONS = BACKEND / "migrations"
SOURCE_ROOT = BACKEND / "src"
SQLITE_UP = MIGRATIONS / "20260713_identity_schema_sqlite.sql"
SQLITE_DOWN = MIGRATIONS / "20260713_identity_schema_rollback_sqlite.sql"
POSTGRES_UP = MIGRATIONS / "20260713_identity_schema_postgresql.sql"
POSTGRES_DOWN = MIGRATIONS / "20260713_identity_schema_rollback_postgresql.sql"

if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _apply(connection: sqlite3.Connection, path: Path) -> None:
    connection.executescript(path.read_text(encoding="utf-8"))


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_sqlite_fresh_install_creates_identity_schema(tmp_path):
    connection = _connect(tmp_path / "fresh.db")
    try:
        _apply(connection, SQLITE_UP)
        assert {"users", "sessions"} <= _tables(connection)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        connection.close()


def test_users_constraints_and_timestamp_defaults(tmp_path):
    connection = _connect(tmp_path / "users.db")
    try:
        _apply(connection, SQLITE_UP)
        connection.execute(
            "INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)",
            ("admin", "$argon2id$placeholder", "admin"),
        )
        row = connection.execute(
            "SELECT is_active, created_at, updated_at, failed_login_attempts FROM users WHERE username='admin'"
        ).fetchone()
        assert row[0] == 1 and row[1] and row[2] and row[3] == 0
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO users(username, password_hash, role) VALUES ('admin', 'different', 'staff')"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO users(username, password_hash, role) VALUES ('teacher', 'hash', 'teacher')"
            )
    finally:
        connection.close()


def test_sessions_foreign_key_fields_and_indexes(tmp_path):
    connection = _connect(tmp_path / "sessions.db")
    try:
        _apply(connection, SQLITE_UP)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        assert {"token_hash", "expires_at", "absolute_expires_at", "revoked_at"} <= columns
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(sessions)")}
        assert {
            "idx_sessions_token_hash",
            "idx_sessions_user_id",
            "idx_sessions_expires_at",
        } <= indexes
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO sessions(user_id, token_hash, expires_at, absolute_expires_at) "
                "VALUES (999, 'digest', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
    finally:
        connection.close()


def test_sqlite_rollback_preserves_existing_database(tmp_path):
    connection = _connect(tmp_path / "rollback.db")
    try:
        connection.execute("CREATE TABLE attendance (id INTEGER PRIMARY KEY, status TEXT NOT NULL)")
        connection.execute("INSERT INTO attendance(status) VALUES ('hadir')")
        connection.commit()
        _apply(connection, SQLITE_UP)
        _apply(connection, SQLITE_DOWN)
        assert "users" not in _tables(connection) and "sessions" not in _tables(connection)
        assert connection.execute("SELECT status FROM attendance").fetchone() == ("hadir",)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        connection.close()


def test_existing_phase6_database_can_be_backed_up_migrated_and_started(tmp_path):
    database = tmp_path / "upgrade.db"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = f"sqlite:///{database}"
    environment["PYTHONPATH"] = os.pathsep.join((str(BACKEND), str(SOURCE_ROOT)))
    command = [str(BACKEND / ".venv" / "bin" / "python"), "-c", "import src.main"]
    initial_start = subprocess.run(
        command, cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30, check=False
    )
    assert initial_start.returncode == 0, initial_start.stderr

    from services.backup_service import create_backup

    backup = create_backup(
        database_url=f"sqlite:///{database}",
        backup_dir=str(tmp_path / "backups"),
        min_free_mb=0,
    )
    assert (tmp_path / "backups" / backup["filename"]).is_file()

    connection = _connect(database)
    try:
        _apply(connection, SQLITE_UP)
    finally:
        connection.close()

    result = subprocess.run(
        command,
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    connection = _connect(database)
    try:
        assert {"users", "sessions"} <= _tables(connection)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        connection.close()


def test_postgresql_migration_and_rollback_contracts():
    up = POSTGRES_UP.read_text(encoding="utf-8")
    down = POSTGRES_DOWN.read_text(encoding="utf-8")
    required = [
        "BEGIN;", "BIGSERIAL", "TIMESTAMPTZ", "BOOLEAN NOT NULL DEFAULT TRUE",
        "CHECK (role IN ('admin', 'staff'))", "REFERENCES users(id) ON DELETE RESTRICT",
        "CREATE INDEX idx_sessions_token_hash", "CREATE INDEX idx_sessions_user_id",
        "CREATE INDEX idx_sessions_expires_at", "COMMIT;",
    ]
    assert all(fragment in up for fragment in required)
    assert up.index("CREATE TABLE users") < up.index("CREATE TABLE sessions")
    assert down.index("DROP TABLE IF EXISTS sessions") < down.index("DROP TABLE IF EXISTS users")
    assert down.startswith("--") and "BEGIN;" in down and down.rstrip().endswith("COMMIT;")


def test_identity_schema_has_no_plaintext_or_secret_columns():
    sql = SQLITE_UP.read_text(encoding="utf-8").lower()
    connection = sqlite3.connect(":memory:")
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.executescript(sql)
        user_columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        session_columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
    finally:
        connection.close()
    assert "password_hash" in user_columns and "password" not in user_columns
    assert "token_hash" in session_columns and "token" not in session_columns
    assert not ({"auth_cookie_secret", "cookie_secret", "session_secret"} & (user_columns | session_columns))


def test_existing_attribution_models_remain_string_fields():
    expected = {
        "attendance_review.py": ["reviewed_by = Column(String"],
        "absence_reason.py": ["entered_by = Column(String"],
        "absence_reason_class_entry.py": ["entered_by = Column(String"],
        "heb_override.py": ["set_by = Column(String"],
        "upload_log.py": ["uploaded_by = Column(String"],
    }
    for filename, fragments in expected.items():
        source = (SOURCE_ROOT / "models" / filename).read_text(encoding="utf-8")
        assert all(fragment in source for fragment in fragments)


def test_identity_models_are_not_imported_by_startup_create_all():
    database_source = (SOURCE_ROOT / "core" / "database.py").read_text(encoding="utf-8")
    init_source = database_source[database_source.index("def init_db():"):]
    assert "models.user import" not in init_source
    assert "models.user_session import" not in init_source
    assert 'table.name not in {"users", "sessions"}' in init_source


def test_identity_configuration_defaults_and_validation(monkeypatch):
    from core.config import Settings

    monkeypatch.delenv("AUTH_COOKIE_SECRET", raising=False)
    settings = Settings(DATABASE_URL="sqlite:///test.db")
    assert settings.AUTH_COOKIE_SECRET is None
    assert settings.COOKIE_SECURE is False
    assert settings.SESSION_IDLE_TIMEOUT_HOURS == 6
    assert settings.SESSION_ABSOLUTE_TIMEOUT_HOURS == 24
    assert settings.MAX_FAILED_LOGIN_ATTEMPTS == 5
    assert settings.ACCOUNT_LOCK_MINUTES == 30
    with pytest.raises(ValidationError):
        Settings(
            DATABASE_URL="sqlite:///test.db",
            SESSION_IDLE_TIMEOUT_HOURS=12,
            SESSION_ABSOLUTE_TIMEOUT_HOURS=8,
        )
