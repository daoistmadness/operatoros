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
    assert [item["class_name"] for item in classes if item["active"]] == ["Primary 1A", "Primary 1B"]
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
    assert attendance.json()["total"] >= 1
    assert any(item["student_name"] == "E2E Ada" for item in attendance.json()["items"])
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


def test_student_management_identity_enrollment_roster_and_xlsx_round_trip(authenticated):
    years = authenticated.get("/api/academic-masters/academic-years").json()
    classes = [row for row in authenticated.get("/api/academic-masters/classes").json() if row["active"]]
    year_id = years[0]["id"]
    class_a = next(row for row in classes if row["class_name"] == "Primary 1A")
    class_b = next(row for row in classes if row["class_name"] == "Primary 1B")
    created = authenticated.post("/api/student-masters", json={
        "identity": {"full_name": "E2E Student Management", "nisn": "0000990110", "nik": "3201000000990110", "student_status": "active"},
        "contact": {"address": "E2E Synthetic Address"},
        "guardians": [{"guardian_type": "guardian", "name": "E2E Guardian"}],
        "device_identity": {"device_identifier": "990110", "device_source": "attendance_machine", "effective_from": "2026-07-20", "reason": "E2E synthetic assignment"},
    })
    assert created.status_code == 201, created.text
    student = created.json(); student_id = student["id"]

    student["identity"]["preferred_name"] = "E2E Managed"
    edited = authenticated.patch(f"/api/student-masters/{student_id}/profile", json={
        "record_version": student["record_version"], "identity": student["identity"],
        "contact": student["contact"], "guardians": student["guardians"], "reason": "E2E profile edit",
    })
    assert edited.status_code == 200, edited.text
    replaced = authenticated.post(f"/api/student-masters/{student_id}/device-identities", json={
        "device_identifier": "990111", "device_source": "attendance_machine", "effective_from": "2026-08-01",
        "reason": "E2E device replacement", "confirmation": "REPLACE_ATTENDANCE_DEVICE_ID",
    })
    assert replaced.status_code == 201, replaced.text
    detail = authenticated.get(f"/api/student-masters/{student_id}/profile").json()
    assert len(detail["device_identities"]) == 2
    assert next(row for row in detail["device_identities"] if row["is_active"])["device_identifier"] == "990111"

    enrollment = authenticated.post(f"/api/student-enrollments/student/{student_id}", json={
        "academic_year_id": year_id, "academic_class_id": class_a["id"], "effective_from": "2026-07-20",
    })
    assert enrollment.status_code == 201, enrollment.text
    enrollment_id = enrollment.json()["id"]
    for target, effective in ((class_b, "2026-09-01"), (class_a, "2026-10-01")):
        moved = authenticated.post(f"/api/student-enrollments/{enrollment_id}/transfer", json={
            "target_class_id": target["id"], "effective_date": effective,
            "reason": "E2E reversible class transfer", "confirmation": "TRANSFER_STUDENT_ENROLLMENT",
        })
        assert moved.status_code == 200, moved.text
    history = authenticated.get(f"/api/student-enrollments/student/{student_id}").json()
    assert len(history[0]["class_history"]) == 3

    exported = authenticated.get("/api/student-masters/management/export-template")
    assert exported.status_code == 200
    workbook = openpyxl.load_workbook(io.BytesIO(exported.content))
    sheet = workbook["Student Data"]
    headers = [cell.value for cell in sheet[1]]
    target_row = next(row for row in range(2, sheet.max_row + 1) if sheet.cell(row, headers.index("OperatorOS Student UUID") + 1).value == student_id)
    sheet.cell(target_row, headers.index("Preferred Name") + 1).value = "E2E Workbook"
    payload = io.BytesIO(); workbook.save(payload)
    update_preview = authenticated.post("/api/student-masters/management/update-preview", files={
        "file": ("e2e-student-update.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    })
    assert update_preview.status_code == 200, update_preview.text
    preview_json = update_preview.json()
    update_row = next(row for row in preview_json["rows"] if row["student_master_id"] == student_id)
    assert update_row["classification"] == "UPDATE_EXISTING_MASTER"
    committed = authenticated.post(f"/api/student-masters/management/update-commit/{preview_json['id']}", json={
        "selected_row_ids": [update_row["id"]], "confirmation": "COMMIT_STUDENT_DATA_UPDATE",
        "preview_checksum": preview_json["preview_checksum"],
    })
    assert committed.status_code == 200, committed.text
    assert authenticated.get(f"/api/student-masters/{student_id}/profile").json()["identity"]["preferred_name"] == "E2E Workbook"

    roster = openpyxl.Workbook(); roster_sheet = roster.active; roster_sheet.title = "Roster"
    roster_sheet.append(["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status", "nisn", "nik", "start_date"])
    roster_sheet.append(["990120", "E2E Roster Student", "2026/2027", "Primary", "Primary 1A", "MAIN", "active", "0000990120", "3201000000990120", "2026-07-20"])
    roster_bytes = io.BytesIO(); roster.save(roster_bytes)
    roster_preview = authenticated.post("/api/student-enrollments/roster-preview", data={"source_owner": "E2E Registrar", "date_received": "2026-07-20"}, files={"file": ("e2e-roster.xlsx", roster_bytes.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert roster_preview.status_code == 200, roster_preview.text
    roster_json = roster_preview.json(); assert roster_json["rows"][0]["classification"] == "CREATE_NEW_MASTER"
    roster_commit = authenticated.post("/api/student-enrollments/roster-commit", json={
        "preview_id": roster_json["preview_id"], "selected_row_ids": [1], "confirmation": "COMMIT_ACADEMIC_ROSTER", "preview_checksum": roster_json["preview_checksum"],
    })
    assert roster_commit.status_code == 200, roster_commit.text
    assert roster_commit.json()["students_created"] == 1
