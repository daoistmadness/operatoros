from __future__ import annotations

import io
import os
import sqlite3
from datetime import date

import httpx
import openpyxl
import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.smoke]


@pytest.fixture(scope="session")
def client():
    with httpx.Client(base_url=os.environ["OPERATOROS_E2E_BACKEND_URL"], timeout=15.0) as session:
        yield session


@pytest.fixture(scope="session")
def authenticated(client):
    response = client.post("/api/auth/login", json={
        "username": os.environ["OPERATOROS_E2E_ADMIN_USERNAME"],
        "password": os.environ["OPERATOROS_E2E_ADMIN_PASSWORD"],
    })
    assert response.status_code == 200, response.text
    return client


def database_count(table: str) -> int:
    with sqlite3.connect(os.environ["OPERATOROS_E2E_DATABASE"]) as connection:
        return connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_authentication_authorization_and_hierarchy(client, authenticated):
    anonymous = httpx.get(f"{os.environ['OPERATOROS_E2E_BACKEND_URL']}/api/academic-masters/academic-years", timeout=15.0)
    assert anonymous.status_code == 401
    assert authenticated.get("/api/auth/me").json()["role"] == "admin"
    programs = authenticated.get("/api/academic-masters/programs").json()
    grades = authenticated.get("/api/academic-masters/grades").json()
    classes = authenticated.get("/api/academic-masters/classes").json()
    assert [item["name"] for item in programs if item["active"]] == ["MAIN"]
    assert [item["name"] for item in grades if item["active"]] == ["Primary 1"]
    assert [item["class_name"] for item in classes if item["active"]] == ["Primary 1A"]
    assert "Primary 1 / MAIN" not in [item["class_name"] for item in classes if item["active"]]


def test_class_allocation_preview_and_attendance_filter_are_non_mutating(authenticated):
    enrollment_before = database_count("student_enrollments")
    years = authenticated.get("/api/academic-masters/academic-years").json()
    jenjangs = authenticated.get("/api/academic-masters/jenjangs").json()
    classes = authenticated.get("/api/academic-masters/classes").json()
    year_id, jenjang_id = years[0]["id"], jenjangs[0]["id"]
    active_class = next(item for item in classes if item["active"])
    candidates = authenticated.get("/api/grades/enrollment/candidates", params={"academic_year_id": year_id, "jenjang_id": jenjang_id})
    assert candidates.status_code == 200
    assert [item["name"] for item in candidates.json()] == ["E2E Bima", "E2E Citra"]
    attendance = authenticated.get("/api/review/attendance", params={
        "date": date.today().isoformat(), "academic_year_id": year_id, "academic_class_id": active_class["id"],
    })
    assert attendance.status_code == 200
    assert attendance.json()["total"] == 1
    assert attendance.json()["items"][0]["student_name"] == "E2E Ada"
    assert database_count("student_enrollments") == enrollment_before


def test_upload_preview_validation_does_not_commit_attendance(authenticated):
    attendance_before = database_count("attendance")
    invalid = authenticated.post("/api/uploads/preview", files={"file": ("bad.txt", b"bad", "text/plain")})
    assert invalid.status_code == 400

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"])
    sheet.append(["E2E-DEVICE-2", "E2E Bima", date.today(), "07:20", "14:00", "00:05", "00:00", "", "E2E-WEEK"])
    payload = io.BytesIO()
    workbook.save(payload)
    valid = authenticated.post(
        "/api/uploads/preview",
        files={"file": ("e2e-attendance.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert valid.status_code == 200, valid.text
    assert "batch_id" in valid.json()
    assert database_count("attendance") == attendance_before
