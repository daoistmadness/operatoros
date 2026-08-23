"""Generate golden fixtures by recording current FastAPI-backend behavior.

Usage:
    cd backend && .venv/bin/python ../docs/migration/ts-backend/golden/tools/generate_golden_fixtures.py

Safety rules:
- Synthetic data only; disposable in-memory SQLite only.
- backend/attendance.db is never opened.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from datetime import date, time, timedelta
from io import BytesIO
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
GOLDEN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "src"))

os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
_DISPOSABLE_DB = Path("/tmp/opencode/tsgolden/golden-settings.db")
_DISPOSABLE_DB.parent.mkdir(parents=True, exist_ok=True)
if _DISPOSABLE_DB.exists():
    _DISPOSABLE_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DISPOSABLE_DB}"

from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from core.database import Base  # noqa: E402
from models.attendance import Attendance  # noqa: E402
from models.heb_override import HebOverride  # noqa: E402
from models.jenjang_config import JenjangConfig  # noqa: E402
from models.student import Student  # noqa: E402
from models.student_master import StudentDeviceIdentity, StudentMaster  # noqa: E402
from models.attendance_import import AttendanceImportRow  # noqa: E402
from services import attendance_metrics as am  # noqa: E402
from services import excel_parser as ep  # noqa: E402
from services.attendance_import_preview import (  # noqa: E402
    create_attendance_preview,
    serialize_preview,
)

for _model_file in sorted((REPO / "backend" / "src" / "models").glob("*.py")):
    if _model_file.stem != "__init__":
        importlib.import_module(f"models.{_model_file.stem}")

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _enable_fks(connection, _record):
    connection.execute("PRAGMA foreign_keys=ON")


Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
db = Session()

CUTOFFS = {"SMP": "07:15", "SMA": "07:00"}
HEADERS = [
    "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
    "Terlambat", "Lembur", "Pengecualian", "week",
]


def dump(obj) -> str:
    return json.dumps(obj, indent=2, default=str) + "\n"


def record(rel_path: str, obj) -> str:
    path = GOLDEN / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(obj))
    return str(path.relative_to(GOLDEN))


def hm(v) -> str | None:
    return v.strftime("%H:%M") if isinstance(v, time) else v


def seed_device_student(sid: int, name: str, jenjang: str, class_name: str) -> None:
    master = StudentMaster(full_name=name, normalized_name=name.lower(), student_status="active")
    db.add(master)
    db.flush()
    db.add(
        StudentDeviceIdentity(
            student_master_id=master.id,
            legacy_student_id=sid,
            device_identifier=str(sid),
            device_source="attendance_device",
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.add(Student(id=sid, name=name, jenjang=jenjang, class_name=class_name))
    db.commit()


def generate_pure_functions() -> list[str]:
    written = []

    derive_cases = []
    for label, cin, cout, late in [
        ("both-scans-zero-late", time(7, 0), time(16, 0), 0),
        ("both-scans-late-positive", time(7, 0), time(16, 0), 5),
        ("boundary-one-minute", time(7, 0), time(16, 0), 1),
        ("null-duration-treats-as-zero", time(7, 30), time(16, 0), None),
        ("check-in-only", time(7, 40), None, 20),
        ("check-out-only", None, time(16, 0), 0),
        ("no-scans", None, None, 0),
    ]:
        derive_cases.append(
            {
                "name": label,
                "args": {"check_in": hm(cin), "check_out": hm(cout), "late_duration": late},
                "expected": ep._derive_status(cin, cout, late if late is not None else 0)
                if late is not None
                else ep._derive_status(cin, cout, None),
            }
        )
    written.append(record("pure-functions/derive-status.json", derive_cases))

    late_cases = []
    for label, cin, terlambat, jenjang in [
        ("integer-terlambat-falls-to-calculated", time(8, 0), 30, "SMP"),
        ("string-hhmm-duration-terlambat", time(7, 40), "00:25", "SMP"),
        ("string-zero-duration-terlambat", time(7, 40), "00:00", "SMP"),
        ("integer-zero-falls-to-calculated", time(7, 40), 0, "SMP"),
        ("exact-cutoff-boundary", time(7, 15), 0, "SMP"),
        ("before-cutoff-clamps-to-zero", time(7, 10), 0, "SMP"),
        ("unknown-jenjang-no-cutoff", time(7, 40), 0, "XYZ"),
        ("no-check-in-none-source", None, 0, "SMP"),
        ("case-insensitive-jenjang-lookup", time(8, 10), 0, "smk"),
        ("negative-integer-terlambat-calculated-path", time(7, 40), -5, "SMP"),
    ]:
        minutes, source = ep._resolve_late_duration_minutes(cin, terlambat, CUTOFFS, jenjang)
        late_cases.append(
            {
                "name": label,
                "args": {"check_in": hm(cin), "terlambat": terlambat, "jenjang": jenjang},
                "expected": [minutes, source],
            }
        )
    written.append(record("pure-functions/late-minutes.json", late_cases))

    cutoff_cases = []
    for value in ["07:15", "7:05", "24:00", "abc", "", None, " 07:20 "]:
        cutoff_cases.append(
            {"args": {"cutoff_text": value}, "expected": ep._cutoff_to_minutes(value)}
        )
    for value in [None, 12, "12", "00:25", "00:00", -5]:
        cutoff_cases.append(
            {"args": {"terlambat": value}, "expected": ep._parse_late_excel_minutes(value)}
        )
    written.append(record("pure-functions/cutoff-parsing.json", cutoff_cases))

    jenjang_cases = []
    for value in ["SMP7", "smp7a", "IPA1A", "Umum", "7B", "X-II-A", "kelas-7", None, "", "  "]:
        jenjang_cases.append(
            {
                "args": {"class_name": value},
                "expected": am.derive_jenjang_from_class_name(value),
            }
        )
    written.append(record("pure-functions/jenjang-derivation.json", jenjang_cases))
    return written


def build_workbook(rows: list[list]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def seed_existing_attendance() -> None:
    db.add_all(
        [
            Attendance(
                student_id=9001, date=date(2026, 6, 15),
                check_in=time(7, 0), check_out=time(16, 0),
                late_duration=0, late_source="none", is_absent=False,
                week="25", status="on-time",
            ),
            Attendance(
                student_id=9002, date=date(2026, 6, 16),
                check_in=time(8, 0), check_out=time(16, 0),
                late_duration=45, late_source="calculated", is_absent=False,
                week="25", status="late",
            ),
        ]
    )
    db.commit()


def attendance_rows() -> list[list]:
    return [
        [9001, "Andi", "15/06/2026", "07:00", "16:00", None, None, None, "25"],
        [9002, "Beta", "16/06/2026", "07:50", "16:00", None, None, None, "25"],
        [9003, "Citra", "17/06/2026", "07:40", "15:30", None, None, None, "25"],
        [9002, "Beta", "18/06/2026", "07:05", "16:10", "00:25", None, None, "25"],
        [9001, "Andi", "19/06/2026", "07:00", None, None, None, None, "25"],
        [9003, "Citra", "31/02/2026", "08:00", "15:00", None, None, None, "25"],
        [9002, "Beta", "20/06/2026", "07:30", "16:00", None, None, None, "25"],
        [9002, "Beta", "20/06/2026", "07:30", "16:00", None, None, None, "25"],
        [9003, "Citra", "21/06/2026", "07:20", "15:00", None, None, None, "25"],
        [9003, "Citra", "21/06/2026", "07:20", "15:45", None, None, None, "25"],
        [9999, "Ghost", "22/06/2026", "07:30", "16:00", None, None, None, "25"],
        [9001, "Andi Tampered", "23/06/2026", "07:00", "16:00", None, None, None, "25"],
        [9002, "Beta", "24/06/2026", "00:00", "00:00", "00:00", None, None, "25"],
        [9003, "Citra", "25/06/2026", None, None, None, None, None, "25"],
        [9101, "Diana", "26/06/2026", "07:20", "16:00", None, None, None, "25"],
    ]


def generate_import_goldens() -> list[str]:
    written = []
    for sid, name, jenjang, cls in [
        (9001, "Andi", "SMP", "SMP7A"),
        (9002, "Beta", "SMP", "SMP7A"),
        (9003, "Citra", "SMP", "SMP7B"),
        (9101, "Diana", "SMA", "SMA2C"),
    ]:
        seed_device_student(sid, name, jenjang, cls)
    db.add_all([JenjangConfig(jenjang=j, cutoff_time=c) for j, c in CUTOFFS.items()])
    seed_existing_attendance()

    workbook = build_workbook(attendance_rows())
    (GOLDEN / "attendance-import" / "normal-preview.xlsx").write_bytes(workbook)

    batch = create_attendance_preview(db, workbook, "normal-preview.xlsx", "golden")
    rows = db.query(AttendanceImportRow).filter_by(batch_id=batch.id).all()
    payload = serialize_preview(batch, rows)

    def _scrub(node):
        if isinstance(node, dict):
            return {
                k: ("<ts>" if k.endswith("_at") and v else _scrub(v))
                for k, v in node.items()
            }
        if isinstance(node, list):
            return [_scrub(v) for v in node]
        return node

    payload = _scrub(payload)
    # Workbook bytes embed build timestamps; the checksum value therefore
    # varies per generation. Parity never depends on it — freeze a token.
    if isinstance(payload, dict) and "checksum" in payload:
        payload["checksum"] = "<sha256-of-source-workbook>"
    counters = {
        "total_rows": batch.total_rows,
        "logical_rows": batch.logical_rows,
        "new_records": batch.new_records,
        "update_records": batch.update_records,
        "unchanged_records": batch.unchanged_records,
        "conflict_records": batch.conflict_records,
        "invalid_records": batch.invalid_records,
        "new_students": batch.new_students,
        "status": batch.status,
    }
    written.append(
        record(
            "attendance-import/normal-preview.json",
            {"counters": counters, "preview": payload},
        )
    )

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append([h for h in HEADERS if h != "Terlambat"])
    ws.append([9001, "Andi", "15/06/2026", "07:00", "16:00", None, None, "25"])
    buf = BytesIO()
    wb.save(buf)
    bad = buf.getvalue()
    (GOLDEN / "attendance-import" / "missing-header.xlsx").write_bytes(bad)
    try:
        create_attendance_preview(db, bad, "missing-header.xlsx", "golden")
        error = None
    except Exception as exc:  # golden records the reference failure verbatim
        db.rollback()
        error = f"{type(exc).__name__}: {exc}"
    written.append(
        record(
            "attendance-import/missing-header.json",
            {"expected_error": error},
        )
    )
    return written


def generate_heb_goldens() -> list[str]:
    counts = [21, 21, 20, 19, 18, 10]
    for offset, days in enumerate(counts):
        sid = 201 + offset
        db.add(Student(id=sid, name=f"HebStudent{sid}", jenjang="SMP", class_name="SMP8"))
        for day in range(days):
            db.add(
                Attendance(
                    student_id=sid,
                    date=date(2026, 6, 1) + timedelta(days=day),
                    check_in=time(7, 0),
                    late_duration=0,
                    late_source="none",
                    is_absent=False,
                    status="on-time",
                )
            )
    db.commit()

    auto = am.calculate_auto_heb(db, "SMP", 6, 2026)
    empty = am.calculate_auto_heb(db, "SD", 6, 2026)
    db.add(
        HebOverride(
            jenjang="SMP", month=6, year=2026, heb_value=22,
            note="manual override wins", set_by="golden",
        )
    )
    db.commit()
    manual = am.calculate_heb(db, "SMP", 6, 2026)
    fallback = am.calculate_heb(db, "SD", 6, 2026)
    out = record(
        "heb/auto-manual-empty.json",
        {"auto_smp_june_2026": auto, "empty_sd": empty,
         "manual_with_override": manual, "fallback_without_data": fallback},
    )
    return [out]


def main() -> None:
    written = []
    written += generate_pure_functions()
    written += generate_import_goldens()
    written += generate_heb_goldens()
    manifest = {
        "regenerate_command": "backend/.venv/bin/python docs/migration/ts-backend/golden/tools/generate_golden_fixtures.py",
        "note": "outputs are recorded behavior of the FastAPI reference; never hand-edit",
        "files": sorted(written),
    }
    (GOLDEN / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("\n".join(manifest["files"]))


if __name__ == "__main__":
    main()
