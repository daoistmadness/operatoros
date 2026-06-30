import importlib
import sys
from pathlib import Path
from datetime import date
import pytest
from fastapi.testclient import TestClient

MODULE_PREFIXES = ("src", "api", "core", "models", "services")
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"


def unload_app_modules() -> None:
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)


def prepare_source_imports(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(SOURCE_ROOT))


@pytest.fixture
def app_context(monkeypatch, tmp_path):
    db_path = tmp_path / "attendance-test.db"
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    unload_app_modules()

    main_module = importlib.import_module("src.main")
    db_module = importlib.import_module("core.database")
    student_module = importlib.import_module("models.student")
    enrollment_module = importlib.import_module("models.student_enrollment")
    upload_log_module = importlib.import_module("models.upload_log")
    academic_year_module = importlib.import_module("models.academic_year")
    jenjang_module = importlib.import_module("models.jenjang")

    db_module.init_db()

    return {
        "app": main_module.app,
        "db_module": db_module,
        "Student": student_module.Student,
        "StudentEnrollment": enrollment_module.StudentEnrollment,
        "UploadLog": upload_log_module.UploadLog,
        "AcademicYear": academic_year_module.AcademicYear,
        "Jenjang": jenjang_module.Jenjang,
    }


def test_create_manual_student_success(app_context):
    client = TestClient(app_context["app"])

    payload = {
        "id": 990001,
        "name": "Manual Student One",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response = client.post("/api/students", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 990001
    assert data["name"] == "Manual Student One"
    assert data["jenjang"] == "Primary"
    assert data["class_name"] == "P1A"

    payload_auto = {
        "name": "Manual Student Two",
        "jenjang": "Secondary",
        "class_name": "S1A"
    }
    response_auto = client.post("/api/students", json=payload_auto)
    assert response_auto.status_code == 200
    data_auto = response_auto.json()
    assert data_auto["id"] is not None
    assert data_auto["id"] != 990001
    assert data_auto["name"] == "Manual Student Two"


def test_create_manual_student_duplicate_id(app_context):
    client = TestClient(app_context["app"])
    payload1 = {
        "id": 990002,
        "name": "Student Unique 1",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response1 = client.post("/api/students", json=payload1)
    assert response1.status_code == 200

    payload2 = {
        "id": 990002,
        "name": "Student Unique 2",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response2 = client.post("/api/students", json=payload2)
    assert response2.status_code == 400
    assert "already taken" in response2.json()["detail"]


def test_create_manual_student_duplicate_name(app_context):
    client = TestClient(app_context["app"])
    payload1 = {
        "id": 990003,
        "name": "Duplicate Name",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response1 = client.post("/api/students", json=payload1)
    assert response1.status_code == 200

    payload2 = {
        "id": 990004,
        "name": "duplicate name",
        "jenjang": "Secondary",
        "class_name": "S1A"
    }
    response2 = client.post("/api/students", json=payload2)
    assert response2.status_code == 409
    assert "already exists" in response2.json()["detail"]


def test_create_manual_student_no_upload_history(app_context):
    client = TestClient(app_context["app"])
    db = app_context["db_module"].SessionLocal()
    UploadLog = app_context["UploadLog"]

    assert db.query(UploadLog).count() == 0

    payload = {
        "name": "No History Student",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response = client.post("/api/students", json=payload)
    assert response.status_code == 200

    assert db.query(UploadLog).count() == 0
    db.close()


def test_manual_student_appears_in_candidates(app_context):
    client = TestClient(app_context["app"])
    db = app_context["db_module"].SessionLocal()
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]

    ay = db.query(AcademicYear).filter(AcademicYear.label == "2025/2026").first()
    if not ay:
        ay = AcademicYear(
            label="2025/2026",
            start_date=date(2025, 7, 1),
            end_date=date(2026, 6, 30),
            status="active",
            is_default=False,
        )
        db.add(ay)
        db.commit()

    j = db.query(Jenjang).filter(Jenjang.name == "Primary").first()
    if not j:
        j = Jenjang(name="Primary")
        db.add(j)
        db.commit()

    ay_id = ay.id
    j_id = j.id

    payload = {
        "name": "Candidate Student",
        "jenjang": "Primary",
        "class_name": "P1A"
    }
    response = client.post("/api/students", json=payload)
    assert response.status_code == 200
    student_id = response.json()["id"]

    resp_candidates = client.get(
        f"/api/grades/enrollment/candidates?academic_year_id={ay_id}&jenjang_id={j_id}&source_class=P1A"
    )
    assert resp_candidates.status_code == 200
    candidates = resp_candidates.json()
    assert any(c["id"] == student_id for c in candidates)

    db.close()
