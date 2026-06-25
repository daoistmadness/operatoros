import importlib
import sys
from datetime import date, datetime, time
from pathlib import Path

import pytest
from fastapi import HTTPException


MODULE_PREFIXES = ("src", "api", "core", "models", "services")
CONFIRMATION_VALUE = "CLEAR_ALL_ATTENDANCE_DATA"
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"


def unload_app_modules() -> None:
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)


def prepare_source_imports(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(SOURCE_ROOT))


@pytest.fixture
def app_context(monkeypatch, tmp_path):
    return create_app_context(monkeypatch, tmp_path, destructive_enabled=False)


def create_app_context(monkeypatch, tmp_path, destructive_enabled: bool):
    db_path = tmp_path / "attendance-test.db"
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    monkeypatch.delenv("POSTGRES_PORT", raising=False)
    if destructive_enabled:
        monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "true")
    else:
        monkeypatch.delenv("ENABLE_DESTRUCTIVE_OPERATIONS", raising=False)
    unload_app_modules()

    main_module = importlib.import_module("src.main")
    db_module = importlib.import_module("core.database")
    system_module = importlib.import_module("api.system")
    student_module = importlib.import_module("models.student")
    attendance_module = importlib.import_module("models.attendance")
    upload_log_module = importlib.import_module("models.upload_log")
    review_module = importlib.import_module("models.attendance_review")
    absence_reason_module = importlib.import_module("models.absence_reason")
    absence_reason_class_entry_module = importlib.import_module("models.absence_reason_class_entry")
    jenjang_config_module = importlib.import_module("models.jenjang_config")
    heb_override_module = importlib.import_module("models.heb_override")

    context = {
        "app": main_module.app,
        "system": system_module,
        "db_module": db_module,
        "Student": student_module.Student,
        "Attendance": attendance_module.Attendance,
        "UploadLog": upload_log_module.UploadLog,
        "AttendanceOverride": review_module.AttendanceOverride,
        "AttendanceOverrideHistory": review_module.AttendanceOverrideHistory,
        "AbsenceReason": absence_reason_module.AbsenceReason,
        "AbsenceReasonClassEntry": absence_reason_class_entry_module.AbsenceReasonClassEntry,
        "JenjangConfig": jenjang_config_module.JenjangConfig,
        "HebOverride": heb_override_module.HebOverride,
    }

    return context


def seed_synthetic_data(context):
    db_module = context["db_module"]
    Student = context["Student"]
    Attendance = context["Attendance"]
    UploadLog = context["UploadLog"]
    AttendanceOverride = context["AttendanceOverride"]
    AttendanceOverrideHistory = context["AttendanceOverrideHistory"]
    AbsenceReason = context["AbsenceReason"]
    AbsenceReasonClassEntry = context["AbsenceReasonClassEntry"]
    JenjangConfig = context["JenjangConfig"]
    HebOverride = context["HebOverride"]

    session = db_module.SessionLocal()
    try:
        student = Student(id=1001, name="Synthetic Student", jenjang="PRIMARY", class_name="1A")
        session.add(student)
        session.flush()

        attendance = Attendance(
            student_id=student.id,
            date=date(2026, 6, 1),
            check_in=time(7, 10),
            check_out=time(14, 30),
            late_duration=10,
            late_source="excel",
            is_absent=False,
            overtime=None,
            exception=None,
            week="Mon",
            status="late",
        )
        session.add(attendance)
        session.flush()

        upload_log = UploadLog(
            filename="synthetic.xlsx",
            uploaded_by="tester",
            total_records=1,
            new_students=1,
            late_entries=1,
            incomplete_entries=0,
            failed_rows=0,
            skipped_empty=0,
            status="success",
        )
        session.add(upload_log)
        session.flush()

        override = AttendanceOverride(
            attendance_id=attendance.id,
            original_status="late",
            override_status="on-time",
            note="manual review",
            reviewed_by="tester",
            reviewed_at=datetime.utcnow(),
        )
        session.add(override)
        session.flush()

        history = AttendanceOverrideHistory(
            override_id=override.id,
            attendance_id=attendance.id,
            previous_status="late",
            new_status="on-time",
            note="manual review",
            reviewed_by="tester",
            timestamp=datetime.utcnow(),
        )
        session.add(history)

        absence_reason = AbsenceReason(
            student_id=student.id,
            class_name="1A",
            month=6,
            year=2026,
            sakit=1,
            izin=0,
            alfa=0,
            note="synthetic",
            entered_by="tester",
        )
        session.add(absence_reason)

        class_entry = AbsenceReasonClassEntry(
            class_name="1A",
            month=6,
            year=2026,
            sakit=2,
            izin=1,
            alfa=0,
            note="synthetic",
            entered_by="tester",
        )
        session.add(class_entry)

        jenjang_config = JenjangConfig(jenjang="PRIMARY", cutoff_time="07:00")
        session.add(jenjang_config)

        heb_override = HebOverride(
            jenjang="PRIMARY",
            month=6,
            year=2026,
            heb_value=20,
            note="synthetic",
            set_by="tester",
        )
        session.add(heb_override)

        session.commit()
    finally:
        session.close()


def table_counts(context):
    db_module = context["db_module"]
    session = db_module.SessionLocal()
    try:
        return {
            "students": session.query(context["Student"]).count(),
            "attendance": session.query(context["Attendance"]).count(),
            "upload_logs": session.query(context["UploadLog"]).count(),
            "attendance_overrides": session.query(context["AttendanceOverride"]).count(),
            "attendance_override_history": session.query(context["AttendanceOverrideHistory"]).count(),
            "absence_reasons": session.query(context["AbsenceReason"]).count(),
            "absence_reason_class_entries": session.query(context["AbsenceReasonClassEntry"]).count(),
            "jenjang_config": session.query(context["JenjangConfig"]).count(),
            "heb_overrides": session.query(context["HebOverride"]).count(),
        }
    finally:
        session.close()


def test_clear_data_is_disabled_by_default(app_context):
    db_module = app_context["db_module"]
    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            app_context["system"].clear_all_data(
                app_context["system"].ClearDataRequest(
                    mode="attendance",
                    confirmation=CONFIRMATION_VALUE,
                ),
                db=session,
            )
    finally:
        session.close()

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Destructive operations are disabled."


def test_clear_data_rejected_when_flag_is_false(monkeypatch, tmp_path):
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'attendance-test.db'}")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "false")
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    monkeypatch.delenv("POSTGRES_PORT", raising=False)
    unload_app_modules()

    system_module = importlib.import_module("api.system")
    db_module = importlib.import_module("core.database")
    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            system_module.clear_all_data(
                system_module.ClearDataRequest(mode="attendance", confirmation=CONFIRMATION_VALUE),
                db=session,
            )
    finally:
        session.close()

    assert exc_info.value.status_code == 403


def test_clear_data_requires_confirmation(monkeypatch, tmp_path):
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'attendance-test.db'}")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "true")
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    monkeypatch.delenv("POSTGRES_PORT", raising=False)
    unload_app_modules()

    system_module = importlib.import_module("api.system")
    db_module = importlib.import_module("core.database")
    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            system_module.clear_all_data(
                system_module.ClearDataRequest(mode="attendance"),
                db=session,
            )
    finally:
        session.close()

    assert exc_info.value.status_code == 400
    assert "confirmation" in exc_info.value.detail.lower()


def test_clear_data_rejects_incorrect_confirmation(monkeypatch, tmp_path):
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'attendance-test.db'}")
    monkeypatch.setenv("ENABLE_DESTRUCTIVE_OPERATIONS", "true")
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    monkeypatch.delenv("POSTGRES_PORT", raising=False)
    unload_app_modules()

    system_module = importlib.import_module("api.system")
    db_module = importlib.import_module("core.database")
    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            system_module.clear_all_data(
                system_module.ClearDataRequest(mode="attendance", confirmation="reset"),
                db=session,
            )
    finally:
        session.close()

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid confirmation token. Use CLEAR_ALL_ATTENDANCE_DATA."


def test_clear_data_deletes_attendance_scope_only(monkeypatch, tmp_path):
    context = create_app_context(monkeypatch, tmp_path, destructive_enabled=True)
    seed_synthetic_data(context)
    system_module = context["system"]
    db_module = context["db_module"]
    session = db_module.SessionLocal()
    try:
        payload = system_module.clear_all_data(
            system_module.ClearDataRequest(mode="attendance", confirmation=CONFIRMATION_VALUE),
            db=session,
        )
    finally:
        session.close()

    assert payload["status"] == "success"
    assert "students" not in payload["deleted_counts"]

    counts = table_counts(context)
    assert counts["students"] == 1
    assert counts["attendance"] == 0
    assert counts["upload_logs"] == 0
    assert counts["attendance_overrides"] == 0
    assert counts["attendance_override_history"] == 0
    assert counts["absence_reasons"] == 0
    assert counts["absence_reason_class_entries"] == 0
    assert counts["jenjang_config"] == 1
    assert counts["heb_overrides"] == 1


def test_clear_data_deletes_full_scope_when_enabled(monkeypatch, tmp_path):
    context = create_app_context(monkeypatch, tmp_path, destructive_enabled=True)
    seed_synthetic_data(context)
    system_module = context["system"]
    db_module = context["db_module"]
    session = db_module.SessionLocal()
    try:
        payload = system_module.clear_all_data(
            system_module.ClearDataRequest(mode="full", confirmation=CONFIRMATION_VALUE),
            db=session,
        )
    finally:
        session.close()

    assert payload["deleted_counts"]["students"] == 1

    counts = table_counts(context)
    assert counts["students"] == 0
    assert counts["attendance"] == 0
    assert counts["upload_logs"] == 0
    assert counts["attendance_overrides"] == 0
    assert counts["attendance_override_history"] == 0
    assert counts["absence_reasons"] == 0
    assert counts["absence_reason_class_entries"] == 0
    assert counts["jenjang_config"] == 1
    assert counts["heb_overrides"] == 1


def test_system_routes_registered(app_context):
    route_paths = {route.path for route in app_context["app"].routes}

    assert "/system/clear-data" in route_paths
    assert "/system/health" in route_paths
