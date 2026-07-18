from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.academic_masters import router as crud_router
from api.student_enrollments import router as enrollment_router
from core.database import Base, get_db
from models.academic_master import AcademicClass, AcademicGrade, AcademicMasterAudit, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment
from models.user import User
from security.dependencies import get_current_user
from services.academic_master_preview import create_academic_master_preview


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record): connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine); session = sessionmaker(bind=engine)()
    session.add(AcademicYear(label="2025/2026", start_date=date(2025,7,1), end_date=date(2026,6,30), status="active", is_default=True))
    session.add(Jenjang(name="Primary", code=None, level=None, active=True)); session.commit()
    yield session
    session.close(); Base.metadata.drop_all(engine)


def approved_payload():
    hierarchy = {
        "SMP": ("Secondary", "Secondary", ["Secondary 1", "Secondary 2", "Secondary 3"]),
        "SD": ("Primary", "Primary", [f"Primary {i}" for i in range(1,7)]),
        "TK": ("EYP", "TK", ["TK A", "TK B"]),
        "KB": ("EYP", "KB", ["KB A", "KB B"]),
        "PKBM": ("Elite Academia", "Homeschooling", ["Homeschooling"]),
    }
    payload = {"academic_years":[{"name":"2026/2027","start_date":date(2026,7,1),"end_date":date(2027,6,30),"is_active":False,"is_default":False}],"jenjangs":[],"programs":[],"grades":[],"classes":[]}
    for code,(name,level,grades) in hierarchy.items():
        payload["jenjangs"].append({"code":code,"name":name,"level":level,"active":True})
        payload["programs"].append({"jenjang_code":code,"name":level,"active":True})
        for sequence,grade in enumerate(grades,1):
            payload["grades"].append({"jenjang_code":code,"program":level,"name":grade,"sequence_number":sequence,"active":True})
            payload["classes"].append({"academic_year":"2026/2027","jenjang_code":code,"program":level,"grade":grade,"class_name":grade,"section_code":"","active":True})
    return payload


def test_approved_preview_is_non_mutating_and_resolves_primary(db):
    before = (db.query(AcademicYear).count(), db.query(Jenjang).count(), db.query(AcademicProgram).count(), db.query(AcademicGrade).count(), db.query(AcademicClass).count())
    result = create_academic_master_preview(db, approved_payload(), "Approved S3.8 brief", "admin")
    assert result["summary"] == {"total":39,"create":38,"update":1,"match_existing":0,"conflict":0,"invalid":0}
    primary = next(row for row in result["rows"] if row["type"] == "jenjang" and row["payload"]["code"] == "SD")
    assert primary["classification"] == "UPDATE" and primary["existing_id"] is not None
    assert before == (db.query(AcademicYear).count(), db.query(Jenjang).count(), db.query(AcademicProgram).count(), db.query(AcademicGrade).count(), db.query(AcademicClass).count())


def test_parallel_sections_supported_and_duplicate_blocked(db):
    year=db.query(AcademicYear).one(); jenjang=db.query(Jenjang).one(); program=AcademicProgram(jenjang_id=jenjang.id,name="Primary"); db.add(program); db.flush()
    grade=AcademicGrade(jenjang_id=jenjang.id,program_id=program.id,name="Primary 1",sequence_number=1); db.add(grade); db.flush()
    db.add_all([AcademicClass(academic_year_id=year.id,grade_id=grade.id,class_name="Primary 1A",section_code="A"),AcademicClass(academic_year_id=year.id,grade_id=grade.id,class_name="Primary 1B",section_code="B")]); db.commit()
    db.add(AcademicClass(academic_year_id=year.id,grade_id=grade.id,class_name="Primary 1A",section_code="A"))
    with pytest.raises(IntegrityError): db.commit()


def test_crud_is_admin_only_and_audited(db):
    app=FastAPI(); app.include_router(crud_router,prefix="/api/academic-masters"); app.dependency_overrides[get_db]=lambda:db; client=TestClient(app)
    assert client.get("/api/academic-masters/jenjangs").status_code == 401
    app.dependency_overrides[get_current_user]=lambda:User(id=2,username="staff",role="staff",is_active=True)
    assert client.get("/api/academic-masters/jenjangs").status_code == 403
    app.dependency_overrides[get_current_user]=lambda:User(id=1,username="admin",role="admin",is_active=True)
    response=client.post("/api/academic-masters/jenjangs",json={"code":"SMP","name":"Secondary","level":"Secondary","active":True})
    assert response.status_code == 201
    assert db.query(AcademicMasterAudit).filter_by(entity_type="jenjang",action="CREATE",actor="admin").count() == 1


def test_referenced_grade_delete_is_rejected(db):
    year=db.query(AcademicYear).one(); jenjang=db.query(Jenjang).one(); program=AcademicProgram(jenjang_id=jenjang.id,name="Primary"); db.add(program); db.flush(); grade=AcademicGrade(jenjang_id=jenjang.id,program_id=program.id,name="Primary 1",sequence_number=1); db.add(grade); db.flush(); db.add(AcademicClass(academic_year_id=year.id,grade_id=grade.id,class_name="Primary 1",section_code="")); db.commit()
    app=FastAPI(); app.include_router(crud_router,prefix="/api/academic-masters"); app.dependency_overrides[get_db]=lambda:db; app.dependency_overrides[get_current_user]=lambda:User(id=1,username="admin",role="admin",is_active=True)
    assert TestClient(app).delete(f"/api/academic-masters/grades/{grade.id}").status_code == 409
    assert db.get(AcademicGrade,grade.id) is not None
