from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.student_enrollments import router
from core.database import Base, get_db
from models.academic_master import AcademicClass, AcademicMasterImportPreview, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment
from models.user import User
from security.dependencies import get_current_user
from services.academic_master_preview import create_academic_master_preview


@pytest.fixture
def master_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record): connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine); db = Session()
    year = AcademicYear(label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), status="active", is_default=True)
    primary = Jenjang(name="Primary", code=None, level=None, active=True)
    db.add_all([year, primary]); db.commit()
    yield db, year, primary
    db.close(); Base.metadata.drop_all(engine)


def proposal():
    return {
        "jenjangs": [{"code": "SEC", "name": "Secondary", "level": 2, "active": True}],
        "programs": [{"jenjang_code": "SEC", "name": "Secondary", "active": True}],
        "classes": [{"academic_year": "2025/2026", "jenjang_code": "SEC", "program": "Secondary", "class_name": "Secondary 1A", "active": True}],
    }


def test_master_preview_writes_staging_only(master_db):
    db, _year, _primary = master_db
    before = (db.query(Jenjang).count(), db.query(AcademicProgram).count(), db.query(AcademicClass).count(), db.query(StudentEnrollment).count())
    preview = create_academic_master_preview(db, proposal(), "Academic Director", "admin")
    assert preview.validation_result["summary"] == {"total": 3, "new": 3, "exists": 0, "conflict": 0, "invalid": 0}
    assert before == (db.query(Jenjang).count(), db.query(AcademicProgram).count(), db.query(AcademicClass).count(), db.query(StudentEnrollment).count())
    assert preview.status == "review_required"


def test_duplicate_and_unknown_master_references_are_invalid(master_db):
    db, _year, _primary = master_db
    payload = proposal()
    payload["classes"].append(dict(payload["classes"][0]))
    payload["programs"].append({"jenjang_code": "UNKNOWN", "name": "Ghost", "active": True})
    preview = create_academic_master_preview(db, payload, "Academic Director", "admin")
    assert preview.validation_result["summary"]["invalid"] == 2
    assert db.query(AcademicProgram).count() == 0
    assert db.query(AcademicClass).count() == 0


def test_class_uniqueness_and_restrictive_foreign_keys(master_db):
    db, year, primary = master_db
    program = AcademicProgram(jenjang_id=primary.id, name="Primary", active=True)
    db.add(program); db.flush()
    db.add(AcademicClass(academic_year_id=year.id, program_id=program.id, jenjang_id=primary.id, class_name="P1A", active=True))
    db.commit()
    db.add(AcademicClass(academic_year_id=year.id, program_id=program.id, jenjang_id=primary.id, class_name="P1A", active=True))
    with pytest.raises(IntegrityError): db.commit()
    db.rollback()
    with pytest.raises(IntegrityError):
        db.delete(primary); db.commit()
    db.rollback()


def test_preview_requires_known_academic_year(master_db):
    db, _year, _primary = master_db
    payload = proposal(); payload["classes"][0]["academic_year"] = "2099/2100"
    preview = create_academic_master_preview(db, payload, "Academic Director", "admin")
    class_row = next(row for row in preview.validation_result["rows"] if row["type"] == "class")
    assert class_row["classification"] == "INVALID"
    assert "unknown academic year" in class_row["errors"]


def test_academic_master_preview_endpoint_requires_admin(master_db):
    db, _year, _primary = master_db
    app = FastAPI(); app.include_router(router, prefix="/api/student-enrollments")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    body = {"source_owner": "Academic Director", **proposal()}
    assert client.post("/api/student-enrollments/academic-master-preview", json=body).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: User(id=2, username="staff", role="staff", is_active=True)
    assert client.post("/api/student-enrollments/academic-master-preview", json=body).status_code == 403
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="admin", role="admin", is_active=True)
    response = client.post("/api/student-enrollments/academic-master-preview", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "review_required"
    assert db.query(Jenjang).count() == 1
