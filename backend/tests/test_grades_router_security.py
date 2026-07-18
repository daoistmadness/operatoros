import importlib
import sqlite3
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "20260713_identity_schema_sqlite.sql"
TEST_SECRET = "grades-security-test-secret-must-be-at-least-32-chars"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))


def _unload():
    for name in list(sys.modules):
        if name == "src" or name.startswith(("src.", "api.", "core.", "models.", "security.", "services.")):
            sys.modules.pop(name, None)


@pytest.fixture
def grades_security_app(monkeypatch, tmp_path):
    _unload()
    database = tmp_path / "grades-security.db"
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(MIGRATION.read_text(encoding="utf-8"))
    connection.close()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("AUTH_COOKIE_SECRET", TEST_SECRET)
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setenv("BACKUP_MIN_FREE_MB", "0")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "false")
    module = importlib.import_module("src.main")
    from core.database import SessionLocal
    from models.user import User
    from security.password import hash_password

    db = SessionLocal()
    db.add_all(
        [
            User(username="admin", password_hash=hash_password("admin grades pass"), role="admin"),
            User(username="staff", password_hash=hash_password("staff grades pass"), role="staff"),
        ]
    )
    db.commit()
    db.close()
    yield module, tmp_path
    if hasattr(module, "engine"):
        module.engine.dispose()
    _unload()


def _client(module, username=None, password=None):
    client = TestClient(module.app)
    if username:
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        assert response.status_code == 200, "Login should succeed for test users"
    return client


# ---------------------------------------------------------------------------
# Parametrized blanket coverage for all /api/grades routes
# ---------------------------------------------------------------------------

GRADES_ROUTES_WITH_GET = [
    "/api/grades/ledger",
    "/api/grades/enrollment/candidates",
    "/api/grades/enrollment/source-classes",
    "/api/grades/enrollment",
    "/api/grades/analytics",
    "/api/grades/academic-years",
    "/api/grades/subjects",
    "/api/grades/jenjangs",
    "/api/grades/components",
]

GRADES_ROUTES_WITH_POST = [
    "/api/grades/enrollment/bulk",
    "/api/grades/save",
    "/api/grades/academic-years",
    "/api/grades/subjects",
]

GRADES_ROUTES_WITH_DELETE = [
    "/api/grades/enrollment/1",
]

ALL_GRADES_ROUTES = (
    [("get", p) for p in GRADES_ROUTES_WITH_GET]
    + [("post", p) for p in GRADES_ROUTES_WITH_POST]
    + [("delete", p) for p in GRADES_ROUTES_WITH_DELETE]
)


@pytest.mark.parametrize("method,path", ALL_GRADES_ROUTES)
def test_grades_router_requires_authentication(grades_security_app, method, path):
    module, _ = grades_security_app
    client = _client(module)
    response = getattr(client, method)(path)
    assert response.status_code == 401, f"{method.upper()} {path} should return 401 for anonymous user"


@pytest.mark.parametrize("method,path", ALL_GRADES_ROUTES)
def test_grades_router_rejects_staff(grades_security_app, method, path):
    module, _ = grades_security_app
    client = _client(module, username="staff", password="staff grades pass")
    response = getattr(client, method)(path)
    assert response.status_code == 403, f"{method.upper()} {path} should return 403 for staff user"


# ---------------------------------------------------------------------------
# Admin — verify each endpoint returns its expected domain response (not 401/403)
# ---------------------------------------------------------------------------

def _seed_academic_year(db, label="2026/2027"):
    from models.academic_year import AcademicYear
    from models.jenjang import Jenjang
    ay = db.query(AcademicYear).filter(AcademicYear.label == label).first()
    if not ay:
        ay = AcademicYear(label=label, start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), status="active", is_default=False)
        db.add(ay)
        db.commit()
        db.refresh(ay)
    j = db.query(Jenjang).filter(Jenjang.name == "Primary").first()
    if not j:
        j = Jenjang(name="Primary", code="primary", level="sd")
        db.add(j)
        db.commit()
        db.refresh(j)
    return ay, j


def test_grades_ledger_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, _ = _seed_academic_year(db)
    ay_id = ay.id
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/ledger", params={"academic_year_id": ay_id})
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_enrollment_candidates_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, j = _seed_academic_year(db)
    ay_id, j_id = ay.id, j.id
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get(
        "/api/grades/enrollment/candidates",
        params={"academic_year_id": ay_id, "jenjang_id": j_id},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_enrollment_source_classes_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, j = _seed_academic_year(db)
    ay_id, j_id = ay.id, j.id
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get(
        "/api/grades/enrollment/source-classes",
        params={"academic_year_id": ay_id, "jenjang_id": j_id},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_enrollment_list_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, j = _seed_academic_year(db)
    ay_id, j_id = ay.id, j.id
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get(
        "/api/grades/enrollment",
        params={"academic_year_id": ay_id, "jenjang_id": j_id},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_enrollment_bulk_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, _ = _seed_academic_year(db)
    ay_id = ay.id

    from models.jenjang import Jenjang
    j_id = db.query(Jenjang.id).scalar()

    from models.academic_master import AcademicProgram, AcademicGrade, AcademicClass

    program = AcademicProgram(jenjang_id=j_id, name="Test Program", active=True)
    db.add(program)
    db.commit()
    db.refresh(program)
    grade = AcademicGrade(jenjang_id=j_id, program_id=program.id, name="Test Grade", sequence_number=1, active=True)
    db.add(grade)
    db.commit()
    db.refresh(grade)
    cls = AcademicClass(academic_year_id=ay_id, grade_id=grade.id, class_name="TA", active=True)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    cls_id = cls.id
    db.close()

    client = _client(module, username="admin", password="admin grades pass")
    response = client.post(
        "/api/grades/enrollment/bulk",
        json={"academic_year_id": ay_id, "academic_class_id": cls_id, "student_master_ids": []},
    )
    assert response.status_code not in (401, 403), f"Should not be auth blocked, got {response.status_code}"


def test_academic_years_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    _seed_academic_year(db)
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/academic-years")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_create_academic_year_admin_succeeds(grades_security_app):
    module, tmp_path = grades_security_app
    client = _client(module, username="admin", password="admin grades pass")
    response = client.post(
        "/api/grades/academic-years",
        json={"label": "2027/2028", "start_date": "2027-07-01", "end_date": "2028-06-30"},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "2027/2028"


def test_subjects_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, j = _seed_academic_year(db)
    j_id = j.id

    from models.subject import Subject
    sub = Subject(name="Mathematics", jenjang_id=j_id, supports_sumatif=True, supports_formatif=True)
    db.add(sub)
    db.commit()
    db.close()

    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/subjects", params={"jenjang_id": j_id})
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_create_subject_admin_succeeds(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    _, j = _seed_academic_year(db)
    j_id = j.id
    db.close()

    client = _client(module, username="admin", password="admin grades pass")
    response = client.post(
        "/api/grades/subjects",
        json={"name": "Science", "jenjang_id": j_id, "supports_sumatif": True, "supports_formatif": True},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Science"


def test_jenjangs_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    _seed_academic_year(db)
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/jenjangs")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_analytics_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    db = SessionLocal()
    ay, _ = _seed_academic_year(db)
    ay_id = ay.id
    db.close()
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/analytics", params={"academic_year_id": ay_id})
    assert response.status_code == 200
    data = response.json()
    assert "grade_count" in data
    assert "average_score" in data


def test_components_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    client = _client(module, username="admin", password="admin grades pass")
    response = client.get("/api/grades/components")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


# ---------------------------------------------------------------------------
# Expired session handling
# ---------------------------------------------------------------------------

def test_expired_session_returns_401(grades_security_app):
    module, tmp_path = grades_security_app
    from core.database import SessionLocal
    from models.user import User
    from models.user_session import UserSession
    from security.sessions import SESSION_COOKIE_NAME, session_digest

    db = SessionLocal()
    admin_user = db.query(User).filter(User.username == "admin").first()

    import hmac
    import hashlib
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    raw_token = "expired-test-token-value"
    token_hash = hmac.new(TEST_SECRET.encode(), raw_token.encode(), hashlib.sha256).hexdigest()
    expired = UserSession(
        user_id=admin_user.id,
        token_hash=token_hash,
        created_at=now - timedelta(hours=2),
        expires_at=now - timedelta(hours=1),
        absolute_expires_at=now + timedelta(hours=12),
    )
    db.add(expired)
    db.commit()
    db.close()

    client = TestClient(module.app)
    client.cookies.set(SESSION_COOKIE_NAME, raw_token)
    response = client.get("/api/grades/academic-years")
    assert response.status_code == 401, "Expired session should be rejected"


# ---------------------------------------------------------------------------
# Enrollment delete endpoint
# ---------------------------------------------------------------------------

def test_enrollment_delete_admin_gets_domain_response(grades_security_app):
    module, tmp_path = grades_security_app
    client = _client(module, username="admin", password="admin grades pass")
    response = client.delete("/api/grades/enrollment/999999")
    # Non-existent enrollment returns 404, not 401/403
    assert response.status_code not in (401, 403), "Admin should not be auth-blocked"
    assert response.status_code == 404


@pytest.mark.parametrize("method,path", [
    ("get", "/api/grades/enrollment/1"),
    ("post", "/api/grades/enrollment/1"),
    ("put", "/api/grades/enrollment/1"),
    ("patch", "/api/grades/enrollment/1"),
])
def test_enrollment_id_get_post_put_patch_returns_405(grades_security_app, method, path):
    module, _ = grades_security_app
    client = _client(module, username="admin", password="admin grades pass")
    response = getattr(client, method)(path)
    # 405 is expected for non-implemented methods on existing route prefix
    # 404 is also acceptable since /enrollment/{id} only responds to GET (list) and DELETE
    assert response.status_code in (404, 405), f"{method.upper()} {path} returned {response.status_code}"
