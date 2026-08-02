from datetime import date
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.staff import router
from core.database import Base, get_db
from models.jenjang import Jenjang
from models.staff import StaffEducation, StaffIdentifier, StaffJenjangAssignment, StaffMember
from models.user import User
from security.dependencies import get_current_user
from services.staff_directory import completed_years, highest_education, service_duration
from core.staff_schema_migration import ensure_staff_schema


@pytest.fixture
def staff_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    primary = Jenjang(name="Primary", code="PRI", level="Primary", active=True)
    secondary = Jenjang(name="Secondary", code="SEC", level="Secondary", active=True)
    inactive = Jenjang(name="Former Level", code="OLD", level="Former", active=False)
    active = StaffMember(
        source_staff_id="S-001", full_name="Synthetic Active", normalized_name="synthetic active",
        employment_status="ACTIVE", birth_date=date(1990, 8, 3), employment_start_date=date(2020, 8, 3),
        job_title_raw="Teacher", job_title_normalized="Teacher", dapodik_status_normalized="ACTIVE",
    )
    former = StaffMember(
        source_staff_id="S-002", full_name="Synthetic Former", normalized_name="synthetic former",
        employment_status="FORMER", birth_date=date(1985, 1, 1), employment_start_date=date(2010, 1, 1),
        employment_end_date=date(2024, 6, 30), job_title_raw="Administrator", job_title_normalized="Administrator", dapodik_status_normalized="NOT_REGISTERED",
    )
    db.add_all([primary, secondary, inactive, active, former])
    db.flush()
    db.add_all([
        StaffJenjangAssignment(staff_member_id=active.id, jenjang_id=primary.id),
        StaffIdentifier(staff_member_id=active.id, identifier_type="NIP", normalized_value="123456789012345678", verification_status="VALIDATED"),
        StaffIdentifier(staff_member_id=active.id, identifier_type="NUPTK", normalized_value="1234567890123456", verification_status="VALIDATED"),
    ])
    db.commit()
    yield db, primary, secondary, inactive, active, former
    db.close()


def staff_client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/staff")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username="admin", role="admin", is_active=True)
    return TestClient(app)


def test_age_and_service_boundary_calculations():
    assert completed_years(date(1990, 8, 3), as_of=date(2026, 8, 2)) == 35
    assert completed_years(date(1990, 8, 3), as_of=date(2026, 8, 3)) == 36
    assert completed_years(date(1990, 8, 3), as_of=date(2026, 8, 4)) == 36
    assert completed_years(None, as_of=date(2026, 8, 4)) is None
    assert service_duration(date(2020, 8, 3), "ACTIVE", as_of=date(2026, 8, 2))["service_years"] == 5
    assert service_duration(date(2020, 8, 3), "ACTIVE", as_of=date(2026, 8, 3))["service_years"] == 6
    assert service_duration(date(2010, 1, 1), "FORMER", date(2024, 6, 30)) == {"service_years": 14, "service_months": 5, "service_duration_status": "CALCULATED"}
    assert service_duration(None, "ACTIVE")["service_duration_status"] == "UNAVAILABLE"
    assert service_duration(date(2024, 1, 1), "FORMER", None)["service_duration_status"] == "UNAVAILABLE"
    assert service_duration(date(2024, 1, 1), "FORMER", date(2023, 1, 1))["service_duration_status"] == "INVALID_CHRONOLOGY"


def test_optional_many_to_many_assignments_and_duplicate_guard(staff_db):
    db, primary, secondary, _inactive, active, former = staff_db
    assert former.jenjang_assignments == []
    db.add(StaffJenjangAssignment(staff_member_id=former.id, jenjang_id=primary.id))
    db.flush()
    db.add(StaffJenjangAssignment(staff_member_id=former.id, jenjang_id=primary.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert db.query(StaffJenjangAssignment).filter_by(staff_member_id=active.id).count() == 1
    assert secondary.id != primary.id


def test_directory_defaults_active_and_supports_filters_and_counts(staff_db):
    db, primary, secondary, _inactive, active, former = staff_db
    client = staff_client(db)
    default = client.get("/api/staff")
    assert default.status_code == 200
    assert [item["full_name"] for item in default.json()["items"]] == [active.full_name]
    assert default.json()["counts"] == {"ACTIVE": 1, "FORMER": 1, "ALL": 2}
    assert client.get("/api/staff", params={"status": "FORMER"}).json()["items"][0]["full_name"] == former.full_name
    assert client.get("/api/staff", params={"status": "ALL", "jenjang_id": primary.id}).json()["total"] == 1
    assert client.get("/api/staff", params={"status": "ALL", "dapodik_status": "NOT_REGISTERED"}).json()["total"] == 1
    assert client.get("/api/staff", params={"status": "ALL", "job_title": "admin"}).json()["total"] == 1
    assert client.get("/api/staff", params={"search": "123456789012345678"}).json()["total"] == 1
    assigned = client.put(f"/api/staff/{active.id}/jenjangs", json={"jenjang_ids": [primary.id, secondary.id]})
    assert assigned.status_code == 200
    assert [item["code"] for item in assigned.json()["jenjangs"]] == ["PRI", "SEC"]
    assert client.get("/api/staff", params={"jenjang_id": secondary.id}).json()["total"] == 1


def test_inactive_new_assignment_is_rejected_and_detail_is_derived(staff_db):
    db, _primary, _secondary, inactive, active, _former = staff_db
    client = staff_client(db)
    response = client.put(f"/api/staff/{active.id}/jenjangs", json={"jenjang_ids": [inactive.id]})
    assert response.status_code == 422
    detail = client.get(f"/api/staff/{active.id}")
    assert detail.status_code == 200
    assert detail.json()["age_years"] is not None
    assert detail.json()["service_duration_status"] == "CALCULATED"
    assert detail.json()["birth_date"] == "1990-08-03"


def test_education_crud_and_highest_recalculation(staff_db):
    db, _primary, _secondary, _inactive, active, _former = staff_db
    client = staff_client(db)
    first = client.post(f"/api/staff/{active.id}/education", json={"education_level": "SMA", "institution_name": "Synthetic High"})
    assert first.status_code == 201
    second = client.post(f"/api/staff/{active.id}/education", json={"education_level": "S1", "institution_name": "Synthetic University", "major": "Education", "graduation_year": 2012})
    assert second.status_code == 201
    third = client.post(f"/api/staff/{active.id}/education", json={"education_level": "S2", "institution_name": "Synthetic Graduate School", "graduation_year": 2018})
    assert third.status_code == 201
    summary = client.get(f"/api/staff/{active.id}/education").json()
    assert summary["highest_education_level"] == "S2"
    assert summary["highest_education_institution"] == "Synthetic Graduate School"
    assert client.post(f"/api/staff/{active.id}/education", json={"education_level": "S1"}).status_code == 422
    assert client.patch(f"/api/staff/{active.id}/education/{second.json()['id']}", json={"education_level": "S1", "institution_name": "Updated University"}).status_code == 200
    assert client.delete(f"/api/staff/{active.id}/education/{third.json()['id']}").status_code == 204
    assert client.get(f"/api/staff/{active.id}/education").json()["highest_education_level"] == "S1"


def test_invalid_employment_end_date_is_rejected_and_export_is_deterministic(staff_db):
    db, _primary, _secondary, _inactive, _active, former = staff_db
    client = staff_client(db)
    assert client.patch(f"/api/staff/{former.id}", json={"employment_end_date": "2009-01-01"}).status_code == 422
    response = client.get("/api/staff/export", params={"status": "ALL"})
    assert response.status_code == 200
    assert "Staff ID,Name,Employment Status" in response.text
    assert "Synthetic Former" in response.text


def test_highest_education_is_derived_from_records(staff_db):
    db, _primary, _secondary, _inactive, active, _former = staff_db
    records = [
        StaffEducation(staff_member_id=active.id, education_level="S1", institution_name="Synthetic U", graduation_year=2012),
        StaffEducation(staff_member_id=active.id, education_level="S2", institution_name="Synthetic Graduate", graduation_year=2018),
    ]
    db.add_all(records)
    db.commit()
    assert highest_education(records)["highest_education_level"] == "S2"


def test_staff_schema_v2_adds_assignments_education_and_end_date(tmp_path):
    database = tmp_path / "staff-schema.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE operatoros_schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        connection.execute("INSERT INTO operatoros_schema_migrations VALUES ('20260725_s43', '2026-07-25')")
        connection.execute("CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, level TEXT, active BOOLEAN NOT NULL DEFAULT 1)")
    assert ensure_staff_schema(database) == "20260802_staff_v2"
    with sqlite3.connect(database) as connection:
        staff_columns = {row[1] for row in connection.execute("PRAGMA table_info(staff_members)")}
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "employment_end_date" in staff_columns
        assert {"staff_jenjang_assignments", "staff_education"}.issubset(tables)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
