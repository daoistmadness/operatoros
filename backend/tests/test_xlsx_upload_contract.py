import importlib
import io
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook


MODULE_PREFIXES = ("src", "api", "core", "models", "services", "security")


def _unload_app_modules():
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)


def _workbook_bytes(headers=None):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Attendance Export"
    sheet.append(headers or [
        "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
        "Terlambat", "Lembur", "Pengecualian", "week",
    ])
    sheet.append([900001, "Synthetic Student", "01/04/2026", "06:29", "15:00", "00:00", "", "", "Wednesday"])
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_authenticated_canonical_xlsx_upload_contract(monkeypatch, tmp_path):
    project_source = Path(__file__).resolve().parents[1] / "src"
    monkeypatch.syspath_prepend(str(project_source))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'xlsx-contract.db'}")
    _unload_app_modules()

    main = importlib.import_module("src.main")
    database = importlib.import_module("core.database")
    dependencies = importlib.import_module("security.dependencies")
    User = importlib.import_module("models.user").User
    UploadLog = importlib.import_module("models.upload_log").UploadLog
    Attendance = importlib.import_module("models.attendance").Attendance

    with TestClient(main.app) as unauthenticated:
        response = unauthenticated.post(
            "/api/uploads/upload",
            files={"file": ("attendance export.xls.xlsx", _workbook_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 401

    main.app.dependency_overrides[dependencies.get_current_user] = lambda: User(
        id=1, username="fixture-admin", role="admin", is_active=True
    )
    try:
        with TestClient(main.app) as client:
            wrong_field = client.post(
                "/api/uploads/upload",
                files={"workbook": ("attendance export.xls.xlsx", _workbook_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )
            assert wrong_field.status_code == 422

            disabled = client.post(
                "/api/uploads/upload",
                files={"file": ("attendance export.xls.xlsx", _workbook_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )
            assert disabled.status_code == 410
            assert disabled.json()["detail"]["code"] == "LEGACY_ATTENDANCE_IMPORT_DISABLED"

        session = database.SessionLocal()
        try:
            assert session.query(Attendance).count() == 0
            logs = session.query(UploadLog).order_by(UploadLog.id).all()
            assert logs == []
        finally:
            session.close()
    finally:
        main.app.dependency_overrides.clear()
