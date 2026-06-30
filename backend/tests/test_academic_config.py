import importlib
import sys
from datetime import date
from pathlib import Path

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
    academic_year_module = importlib.import_module("models.academic_year")
    jenjang_module = importlib.import_module("models.jenjang")
    subject_module = importlib.import_module("models.subject")
    academic_config_module = importlib.import_module("models.academic_config")

    db_module.init_db()

    return {
        "app": main_module.app,
        "db_module": db_module,
        "AcademicYear": academic_year_module.AcademicYear,
        "Jenjang": jenjang_module.Jenjang,
        "Subject": subject_module.Subject,
        "KkmThreshold": academic_config_module.KkmThreshold,
        "AcademicTermConfig": academic_config_module.AcademicTermConfig,
    }


def seed_academic_config_context(app_context):
    db_module = app_context["db_module"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]
    Subject = app_context["Subject"]

    db = db_module.SessionLocal()

    ay = db.query(AcademicYear).filter_by(label="2026/2027").first()
    if not ay:
        ay = AcademicYear(label="2026/2027", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30))
        db.add(ay)
        db.commit()

    jen = db.query(Jenjang).filter_by(name="Primary").first()
    if not jen:
        jen = Jenjang(name="Primary")
        db.add(jen)
        db.commit()

    sub = db.query(Subject).filter_by(name="Math").first()
    if not sub:
        sub = Subject(name="Math", jenjang_id=jen.id, supports_sumatif=True, supports_formatif=True)
        db.add(sub)
        db.commit()

    ay_id = ay.id
    jen_id = jen.id
    sub_id = sub.id
    db.close()

    return ay_id, jen_id, sub_id


def test_kkm_threshold_resolution_precedence(app_context):
    client = TestClient(app_context["app"])
    ay_id, jen_id, sub_id = seed_academic_config_context(app_context)

    # 1. Fallback (no custom config)
    res = client.get(f"/api/academic-config/kkm-effective?academic_year_id={ay_id}&assessment_type=sumatif")
    assert res.status_code == 200
    assert res.json()["threshold"] == 85.0
    assert res.json()["threshold_source"] == "legacy-fallback"

    # 2. Academic year level
    client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": ay_id,
        "assessment_type": "sumatif",
        "threshold": 70.0
    })
    res = client.get(f"/api/academic-config/kkm-effective?academic_year_id={ay_id}&jenjang_id={jen_id}&subject_id={sub_id}&assessment_type=sumatif")
    assert res.json()["threshold"] == 70.0
    assert res.json()["threshold_source"] == "academic-year-level"

    # 3. Jenjang level
    client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": ay_id,
        "jenjang_id": jen_id,
        "assessment_type": "sumatif",
        "threshold": 75.0
    })
    res = client.get(f"/api/academic-config/kkm-effective?academic_year_id={ay_id}&jenjang_id={jen_id}&subject_id={sub_id}&assessment_type=sumatif")
    assert res.json()["threshold"] == 75.0
    assert res.json()["threshold_source"] == "jenjang-level"

    # 4. Subject level
    client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": ay_id,
        "jenjang_id": jen_id,
        "subject_id": sub_id,
        "assessment_type": "sumatif",
        "threshold": 80.0
    })
    res = client.get(f"/api/academic-config/kkm-effective?academic_year_id={ay_id}&jenjang_id={jen_id}&subject_id={sub_id}&assessment_type=sumatif")
    assert res.json()["threshold"] == 80.0
    assert res.json()["threshold_source"] == "subject-specific"


def test_term_resolution_precedence_and_validation(app_context):
    client = TestClient(app_context["app"])
    ay_id, _, _ = seed_academic_config_context(app_context)

    # 1. Fallback (no custom config)
    res = client.get(f"/api/academic-config/terms/effective?academic_year_id={ay_id}")
    assert res.status_code == 200
    terms = res.json()
    assert len(terms) == 4
    assert terms[0]["source"] == "default"
    assert terms[0]["start_date"] == "2026-07-01"

    # 2. Custom term overrides default
    res = client.post("/api/academic-config/terms", json={
        "academic_year_id": ay_id,
        "term_number": 1,
        "label": "Custom Term 1",
        "start_date": "2026-07-15",
        "end_date": "2026-08-15"
    })
    assert res.status_code == 200

    res = client.get(f"/api/academic-config/terms/effective?academic_year_id={ay_id}")
    terms = res.json()
    assert terms[0]["source"] == "custom"
    assert terms[0]["start_date"] == "2026-07-15"
    assert terms[0]["label"] == "Custom Term 1"

    # 3. Validation: Overlapping dates
    res = client.post("/api/academic-config/terms", json={
        "academic_year_id": ay_id,
        "term_number": 2,
        "label": "Custom Term 2",
        "start_date": "2026-08-01",
        "end_date": "2026-09-01"
    })
    assert res.status_code == 400
    assert "overlaps" in res.json()["detail"].lower()

    # 4. Validation: Invalid date range (start > end)
    res = client.post("/api/academic-config/terms", json={
        "academic_year_id": ay_id,
        "term_number": 2,
        "label": "Custom Term 2",
        "start_date": "2026-10-01",
        "end_date": "2026-09-01"
    })
    assert res.status_code == 400
    assert "start_date must be on or before end_date" in res.json()["detail"]


def test_kkm_threshold_validation(app_context):
    client = TestClient(app_context["app"])
    ay_id, jen_id, _ = seed_academic_config_context(app_context)

    # 1. Negative KKM threshold
    res = client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": ay_id,
        "assessment_type": "sumatif",
        "threshold": -10.0
    })
    assert res.status_code == 422 # Pydantic validation error

    # 2. Exceeds 100
    res = client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": ay_id,
        "assessment_type": "sumatif",
        "threshold": 110.0
    })
    assert res.status_code == 422 # Pydantic validation error

    # 3. Invalid reference (404)
    res = client.post("/api/academic-config/kkm-thresholds", json={
        "academic_year_id": 9999,
        "assessment_type": "sumatif",
        "threshold": 80.0
    })
    assert res.status_code == 404
