import io
import json
import zipfile
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base, get_db
from main import app
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.user import User
from security.password import hash_password
from security.sessions import create_session
from services.csv_contract import FORMAT_VERSION, DATASET_CONTRACTS
from services.csv_parser import parse_csv_bytes, parse_zip_bundle
from services.csv_serializer import sanitize_cell_value, serialize_csv


from security.dependencies import get_current_user, require_role


@pytest.fixture
def test_db_session(tmp_path):
    db_path = tmp_path / "test_csv_portability.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Seed admin user
    admin_user = User(
        id=1,
        username="admin",
        password_hash=hash_password("adminpass123"),
        role="admin",
        is_active=True,
    )
    db.add(admin_user)
    db.commit()

    # Seed student master
    student = StudentMaster(
        id="STD-9901",
        full_name="Budi Santoso",
        normalized_name="budi santoso",
        student_status="active",
        gender="L",
    )
    db.add(student)
    db.commit()

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_client(test_db_session):
    admin_user = test_db_session.query(User).filter(User.username == "admin").first()

    client = TestClient(app)

    def override_get_db():
        try:
            yield test_db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_csv_contract_specifications():
    assert FORMAT_VERSION == "operatoros_csv_v1"
    assert "student_roster" in DATASET_CONTRACTS
    assert "attendance_operational_summary" in DATASET_CONTRACTS
    assert DATASET_CONTRACTS["attendance_operational_summary"].import_eligible is False


def test_spreadsheet_formula_neutralization():
    # Equals prefix neutralized
    assert sanitize_cell_value("=SUM(A1:A10)") == "'=SUM(A1:A10)"
    # Plus prefix neutralized
    assert sanitize_cell_value("+100") == "'+100"
    # At prefix neutralized
    assert sanitize_cell_value("@CMD") == "'@CMD"
    # Tab prefix neutralized
    assert sanitize_cell_value("\tEXEC") == "'\tEXEC"

    # Numeric negatives preserved
    assert sanitize_cell_value("-5.0", is_numeric_field=True) == "-5.0"
    assert sanitize_cell_value("-42", is_numeric_field=True) == "-42"

    # Non-numeric string starting with minus neutralized
    assert sanitize_cell_value("-TEXT", is_numeric_field=False) == "'-TEXT"

    # Leading zero string preserved
    assert sanitize_cell_value("00123") == "00123"


def test_csv_parser_delimiter_and_headers():
    csv_comma = b"student_id,full_name,student_status,gender\nSTD-01,Alpha,active,L\n"
    headers, rows, _ = parse_csv_bytes(csv_comma, expected_headers=["student_id", "full_name"])
    assert headers == ["student_id", "full_name", "student_status", "gender"]
    assert len(rows) == 1
    assert rows[0]["student_id"] == "STD-01"

    # Semicolon delimiter
    csv_semi = b"student_id;full_name;student_status;gender\nSTD-02;Beta;active;P\n"
    headers, rows, _ = parse_csv_bytes(csv_semi, expected_headers=["student_id", "full_name"])
    assert headers == ["student_id", "full_name", "student_status", "gender"]
    assert rows[0]["full_name"] == "Beta"


def test_zip_bundle_parsing_and_checksum_verification():
    headers = ["student_id", "full_name", "student_status", "gender"]
    csv_bytes = serialize_csv(headers=headers, rows=[["STD-01", "Test", "active", "L"]])
    import hashlib
    csv_sha = hashlib.sha256(csv_bytes).hexdigest()

    manifest = {
        "operatoros_format": FORMAT_VERSION,
        "dataset": "student_roster",
        "csv_sha256": csv_sha,
    }
    manifest_bytes = json.dumps(manifest).encode("utf-8")

    zip_io = io.BytesIO()
    with zipfile.ZipFile(zip_io, "w") as z:
        z.writestr("data.csv", csv_bytes)
        z.writestr("manifest.json", manifest_bytes)

    dataset, parsed_manifest, unpacked_csv = parse_zip_bundle(zip_io.getvalue(), "test_bundle.zip")
    assert dataset == "student_roster"
    assert unpacked_csv == csv_bytes


def test_datasets_endpoint(auth_client):
    res = auth_client.get("/api/data-portability/datasets")
    assert res.status_code == 200
    data = res.json()
    assert any(d["identifier"] == "student_roster" for d in data)


def test_template_download_endpoint(auth_client):
    res = auth_client.get("/api/data-portability/templates/student_roster")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"

    # Unpack downloaded zip
    with zipfile.ZipFile(io.BytesIO(res.content)) as z:
        namelist = z.namelist()
        assert "student_roster_template.csv" in namelist
        assert "manifest.json" in namelist
        assert "README.txt" in namelist


def test_export_preview_and_download_csv(auth_client):
    # Preview
    res_prev = auth_client.post(
        "/api/data-portability/exports/preview",
        json={"dataset": "student_roster"},
    )
    assert res_prev.status_code == 200
    assert res_prev.json()["estimated_row_count"] >= 1

    # Download CSV
    res_dl = auth_client.post(
        "/api/data-portability/exports",
        json={"dataset": "student_roster", "format_type": "csv"},
    )
    assert res_dl.status_code == 200
    assert "text/csv" in res_dl.headers["content-type"]
    assert "Budi Santoso" in res_dl.text


def test_roster_import_preview_and_atomic_commit(auth_client, test_db_session):
    csv_data = (
        "student_id,full_name,student_status,gender\n"
        "STD-9901,Budi Santoso Updated,active,L\n"
        "STD-9902,Dewi Sartika,active,P\n"
    ).encode("utf-8")

    # Preview
    res_prev = auth_client.post(
        "/api/data-portability/imports/preview",
        data={"dataset": "student_roster"},
        files={"file": ("roster.csv", csv_data, "text/csv")},
    )
    assert res_prev.status_code == 200
    prev_json = res_prev.json()
    assert prev_json["valid_count"] == 2
    assert prev_json["summary"]["NEW"] == 1
    assert prev_json["summary"]["UPDATE"] == 1

    batch_id = prev_json["batch_id"]

    # Commit
    res_commit = auth_client.post(
        "/api/data-portability/imports/commit",
        json={"batch_id": batch_id, "confirmation": "CONFIRM_IMPORT"},
    )
    assert res_commit.status_code == 200
    assert res_commit.json()["committed_count"] == 2

    # Verify DB update
    updated_budi = test_db_session.query(StudentMaster).filter(StudentMaster.id == "STD-9901").first()
    assert updated_budi.full_name == "Budi Santoso Updated"

    new_dewi = test_db_session.query(StudentMaster).filter(StudentMaster.id == "STD-9902").first()
    assert new_dewi is not None
    assert new_dewi.full_name == "Dewi Sartika"


def test_device_identity_import_preview_and_commit(auth_client, test_db_session):
    csv_data = (
        "student_id,device_identifier,notes\n"
        "STD-9901,RF-882001,Main Card\n"
    ).encode("utf-8")

    # Preview
    res_prev = auth_client.post(
        "/api/data-portability/imports/preview",
        data={"dataset": "device_identity_mapping"},
        files={"file": ("device.csv", csv_data, "text/csv")},
    )
    assert res_prev.status_code == 200
    prev_json = res_prev.json()
    assert prev_json["valid_count"] == 1

    batch_id = prev_json["batch_id"]

    # Commit
    res_commit = auth_client.post(
        "/api/data-portability/imports/commit",
        json={"batch_id": batch_id, "confirmation": "CONFIRM_IMPORT"},
    )
    assert res_commit.status_code == 200
    assert res_commit.json()["committed_count"] == 1

    # Verify DB insertion
    dev = test_db_session.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.device_identifier == "RF-882001").first()
    assert dev is not None
    assert dev.student_master_id == "STD-9901"


def test_attendance_import_prohibited(auth_client):
    csv_data = b"date,student_id,full_name,class_name,status\n2026-07-26,STD-9901,Budi,7A,Hadir\n"
    res = auth_client.post(
        "/api/data-portability/imports/preview",
        data={"dataset": "attendance_operational_summary"},
        files={"file": ("attendance.csv", csv_data, "text/csv")},
    )
    assert res.status_code == 400
    assert "DATA_IMPORT_ATTENDANCE_PROHIBITED" in res.json()["detail"]


def test_history_endpoint(auth_client):
    res = auth_client.get("/api/data-portability/history")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
