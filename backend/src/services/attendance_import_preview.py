import hashlib
from datetime import datetime, time, timedelta
from io import BytesIO

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
from models.attendance_review import AttendanceOverride
from models.student import Student
from models.student_master import StudentDeviceIdentity
from models.upload_log import UploadLog
from services.attendance_metrics import derive_jenjang_from_class_name
from services.excel_parser import (
    REQUIRED_COLUMNS,
    _build_chunk_entries,
    _derive_status,
    _load_cutoff_map,
    _resolve_late_duration_minutes,
)


ATTENDANCE_IMPORT_CONFIRMATION = "COMMIT_ATTENDANCE_IMPORT"
COMMITTABLE_CLASSIFICATIONS = {"NEW", "DIFFERENCE", "UNCHANGED"}
DEVICE_IDENTITY_UNMATCHED = "DEVICE_IDENTITY_UNMATCHED"


def _empty_stats() -> dict:
    keys = (
        "total_records", "new_students", "late_entries", "failed_rows", "skipped_empty",
        "incomplete_entries", "rows_inserted", "rows_updated", "rows_unchanged",
        "rows_dropped_invalid", "scans_coerced_to_null", "dates_coerced_to_null",
        "null_overwrite_blocked", "intra_chunk_conflicts", "chunk_fallbacks",
    )
    return {**{key: 0 for key in keys}, "row_errors": [], "failed_records": [], "warnings": []}


def _time_text(value: time | None) -> str | None:
    return value.strftime("%H:%M:%S") if value else None


def _duration_seconds(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, timedelta):
        return int(value.total_seconds())
    return None


def _attendance_payload(row: Attendance) -> dict:
    return {
        "check_in": _time_text(row.check_in),
        "check_out": _time_text(row.check_out),
        "late_duration": row.late_duration or 0,
        "late_source": row.late_source or "none",
        "is_absent": bool(row.is_absent),
        "overtime_seconds": _duration_seconds(row.overtime),
        "exception": row.exception,
        "week": row.week,
        "status": row.status,
    }


def _resolve_device_student(db: Session, student_identifier: int) -> Student | None:
    mapping = (
        db.query(StudentDeviceIdentity)
        .filter(
            StudentDeviceIdentity.device_identifier == str(student_identifier),
            StudentDeviceIdentity.is_active.is_(True),
        )
        .order_by(StudentDeviceIdentity.id.asc())
        .first()
    )
    if mapping is None or mapping.legacy_student_id is None:
        return None
    return db.get(Student, mapping.legacy_student_id)


def _proposed_payload(entry: dict, student: Student | None, existing: Attendance | None, cutoff_map: dict) -> dict:
    check_in = entry["check_in"] if entry["check_in"] is not None else (existing.check_in if existing else None)
    check_out = entry["check_out"] if entry["check_out"] is not None else (existing.check_out if existing else None)
    jenjang = None
    if student is not None:
        jenjang = student.jenjang or derive_jenjang_from_class_name(student.class_name)
    late_duration, late_source = _resolve_late_duration_minutes(
        check_in, entry["terlambat"], cutoff_map, jenjang
    )
    status = _derive_status(check_in, check_out, late_duration)
    return {
        "check_in": _time_text(check_in),
        "check_out": _time_text(check_out),
        "late_duration": late_duration,
        "late_source": late_source,
        "is_absent": status == "absent",
        "overtime_seconds": _duration_seconds(entry["overtime"]),
        "exception": entry["exception"],
        "week": entry["week"],
        "status": status,
    }


def _raw_duplicate_keys(frame: pd.DataFrame) -> tuple[set[tuple[int, object]], set[tuple[int, object]]]:
    working = frame.copy()
    working["_id"] = pd.to_numeric(working["No. ID"], errors="coerce")
    working["_date"] = pd.to_datetime(working["Tanggal"], format="%d/%m/%Y", errors="coerce").dt.date
    working = working.dropna(subset=["_id", "_date"])
    exact: set[tuple[int, object]] = set()
    divergent: set[tuple[int, object]] = set()
    compare_columns = [column for column in REQUIRED_COLUMNS if column in working.columns]
    for (student_id, attendance_date), group in working.groupby(["_id", "_date"]):
        if len(group) <= 1:
            continue
        normalized = group[compare_columns].fillna("").astype(str).drop_duplicates()
        key = (int(student_id), attendance_date)
        (exact if len(normalized) == 1 else divergent).add(key)
    return exact, divergent


def _read_workbook(file_bytes: bytes, filename: str) -> tuple[pd.DataFrame, list[dict], dict, set, set, list[dict]]:
    engine = "xlrd" if filename.lower().endswith(".xls") else "openpyxl"
    workbook = pd.ExcelFile(BytesIO(file_bytes), engine=engine)
    header = pd.read_excel(workbook, sheet_name=0, nrows=0)
    header.columns = header.columns.str.strip()
    missing = [column for column in REQUIRED_COLUMNS if column not in header.columns]
    if missing:
        raise ValueError(f"Missing required column: {missing[0]}")
    frame = pd.read_excel(workbook, sheet_name=0)
    frame.columns = frame.columns.str.strip()
    frame = frame.dropna(how="all")
    frame["__excel_row"] = frame.index + 2
    parsed_ids = pd.to_numeric(frame["No. ID"], errors="coerce")
    parsed_dates = pd.to_datetime(frame["Tanggal"], format="%d/%m/%Y", errors="coerce")
    names = frame["Nama"].fillna("").astype(str).str.strip()
    invalid_mask = parsed_ids.isna() | parsed_dates.isna() | names.eq("")
    invalid_source_rows = [
        {
            "excel_row": int(row["__excel_row"]),
            "no_id": None if pd.isna(row["No. ID"]) else str(row["No. ID"]),
            "nama": None if pd.isna(row["Nama"]) else str(row["Nama"]),
            "reason": "Missing or invalid No. ID, Nama, or Tanggal",
        }
        for _, row in frame[invalid_mask].iterrows()
    ]
    stats = _empty_stats()
    exact_duplicates, divergent_duplicates = _raw_duplicate_keys(frame)
    entries = _build_chunk_entries(frame, stats, set(), {})
    return frame, entries, stats, exact_duplicates, divergent_duplicates, invalid_source_rows


def create_attendance_preview(
    db: Session, file_bytes: bytes, filename: str, username: str
) -> AttendanceImportBatch:
    checksum = hashlib.sha256(file_bytes).hexdigest()
    frame, entries, stats, exact_duplicates, divergent_duplicates, invalid_source_rows = _read_workbook(
        file_bytes, filename
    )
    cutoff_map = _load_cutoff_map(db)
    batch = AttendanceImportBatch(
        filename=filename,
        checksum=checksum,
        uploaded_by=username,
        total_rows=len(frame),
        logical_rows=len(entries),
    )
    db.add(batch)
    db.flush()

    counts = {key: 0 for key in ("NEW", "UNCHANGED", "DIFFERENCE", "CONFLICT", "INVALID")}
    for entry in entries:
        student_id = entry["student_id"]
        key = (student_id, entry["date"])
        student = _resolve_device_student(db, student_id)
        existing = (
            db.query(Attendance)
            .filter(
                Attendance.student_id == student.id if student is not None else False,
                Attendance.date == entry["date"],
            )
            .first()
        )
        warning_parts = []
        validation_error = None
        if student is None:
            classification = "CONFLICT"
            validation_error = (
                f"{DEVICE_IDENTITY_UNMATCHED}: no active attendance device identity "
                f"is linked to {student_id}"
            )
        if key in exact_duplicates:
            warning_parts.append("Identical duplicate source key collapsed to one logical row")
        if student is not None and key in divergent_duplicates:
            classification = "CONFLICT"
            validation_error = "Divergent duplicate rows share the same student/date key"
        elif student is not None and student.name != entry["student_name"]:
            classification = "CONFLICT"
            validation_error = "Student identifier belongs to a different existing name"
        elif student is not None:
            proposed = _proposed_payload(entry, student, existing, cutoff_map)
            before = _attendance_payload(existing) if existing else None
            if existing is None:
                classification = "NEW"
            elif before == proposed:
                classification = "UNCHANGED"
            else:
                classification = "DIFFERENCE"
            if existing and db.query(AttendanceOverride).filter_by(attendance_id=existing.id).first():
                warning_parts.append("Administrative override exists and remains authoritative")

        proposed = None if classification == "CONFLICT" else _proposed_payload(entry, student, existing, cutoff_map)
        before = _attendance_payload(existing) if existing else None
        counts[classification] += 1
        db.add(AttendanceImportRow(
            batch_id=batch.id,
            source_row=entry.get("excel_row"),
            student_identifier=str(student_id),
            student_name=entry["student_name"],
            attendance_date=entry["date"],
            existing_attendance_id=existing.id if existing else None,
            classification=classification,
            existing_record=before,
            proposed_change=proposed,
            validation_error=validation_error,
            warning="; ".join(warning_parts) or None,
        ))

    for error in stats["row_errors"]:
        counts["INVALID"] += 1
        db.add(AttendanceImportRow(
            batch_id=batch.id,
            source_row=error.get("excel_row"),
            student_identifier=error.get("no_id"),
            student_name=error.get("nama"),
            classification="INVALID",
            validation_error=error.get("reason"),
        ))

    for error in invalid_source_rows:
        counts["INVALID"] += 1
        db.add(AttendanceImportRow(
            batch_id=batch.id,
            source_row=error.get("excel_row"),
            student_identifier=error.get("no_id"),
            student_name=error.get("nama"),
            classification="INVALID",
            validation_error=error.get("reason"),
        ))

    batch.new_records = counts["NEW"]
    batch.update_records = counts["DIFFERENCE"]
    batch.unchanged_records = counts["UNCHANGED"]
    batch.conflict_records = counts["CONFLICT"]
    batch.invalid_records = counts["INVALID"]
    batch.new_students = 0
    db.commit()
    db.refresh(batch)
    return batch


def serialize_preview(batch: AttendanceImportBatch, rows: list[AttendanceImportRow]) -> dict:
    return {
        "batch_id": batch.id,
        "filename": batch.filename,
        "checksum": batch.checksum,
        "status": batch.status,
        "summary": {
            "total_rows": batch.total_rows,
            "logical_rows": batch.logical_rows,
            "new_rows": batch.new_records,
            "update_rows": batch.update_records,
            "unchanged_rows": batch.unchanged_records,
            "conflicts": batch.conflict_records,
            "invalid_rows": batch.invalid_records,
            "new_students": batch.new_students,
        },
        "rows": [
            {
                "id": row.id,
                "source_row": row.source_row,
                "student_identifier": row.student_identifier,
                "student": row.student_name,
                "date": row.attendance_date.isoformat() if row.attendance_date else None,
                "existing_record": row.existing_record,
                "proposed_record": row.proposed_change,
                "classification": row.classification,
                "warning": row.warning,
                "validation_error": row.validation_error,
            }
            for row in rows
        ],
    }


def _parse_time_text(value: str | None) -> time | None:
    return datetime.strptime(value, "%H:%M:%S").time() if value else None


def _apply_payload(attendance: Attendance, payload: dict) -> None:
    attendance.check_in = _parse_time_text(payload.get("check_in"))
    attendance.check_out = _parse_time_text(payload.get("check_out"))
    attendance.late_duration = int(payload.get("late_duration") or 0)
    attendance.late_source = payload.get("late_source") or "none"
    attendance.is_absent = bool(payload.get("is_absent"))
    seconds = payload.get("overtime_seconds")
    attendance.overtime = timedelta(seconds=seconds) if seconds is not None else None
    attendance.exception = payload.get("exception")
    attendance.week = payload.get("week")
    attendance.status = payload.get("status")


def commit_attendance_preview(
    db: Session, batch_id: str, selected_row_ids: list[int], confirmation: str, username: str
) -> dict:
    if confirmation != ATTENDANCE_IMPORT_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    batch = db.get(AttendanceImportBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Attendance import preview not found")
    if batch.status == "committed":
        return batch.commit_result or {"status": "committed", "idempotent": True}
    if batch.status != "preview":
        raise HTTPException(status_code=409, detail="Attendance import preview is not committable")
    unique_ids = list(dict.fromkeys(selected_row_ids))
    rows = (
        db.query(AttendanceImportRow)
        .filter(AttendanceImportRow.batch_id == batch.id, AttendanceImportRow.id.in_(unique_ids))
        .order_by(AttendanceImportRow.id.asc())
        .all()
    )
    if not unique_ids or len(rows) != len(unique_ids):
        raise HTTPException(status_code=400, detail="Selected rows are not part of this preview")
    blocked = [row.id for row in rows if row.classification not in COMMITTABLE_CLASSIFICATIONS]
    if blocked:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "UNRESOLVED_IMPORT_ROWS",
                "message": "Selected attendance import rows require identity resolution.",
                "row_ids": blocked,
            },
        )

    inserted = updated = unchanged = new_students = late_entries = incomplete_entries = 0
    try:
        batch.status = "committing"
        for row in rows:
            student_identifier = int(row.student_identifier)
            student = _resolve_device_student(db, student_identifier)
            if student is None:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": DEVICE_IDENTITY_UNMATCHED,
                        "message": f"Attendance device identity is unresolved at preview row {row.id}",
                    },
                )
            elif student.name != row.student_name:
                raise HTTPException(status_code=409, detail=f"Student changed after preview row {row.id}")

            existing = (
                db.query(Attendance)
                .filter(Attendance.student_id == student.id, Attendance.date == row.attendance_date)
                .first()
            )
            current_payload = _attendance_payload(existing) if existing else None
            if current_payload != row.existing_record:
                raise HTTPException(status_code=409, detail=f"Attendance changed after preview row {row.id}")
            if row.classification == "NEW":
                attendance = Attendance(student_id=student.id, date=row.attendance_date)
                _apply_payload(attendance, row.proposed_change)
                db.add(attendance)
                inserted += 1
            elif row.classification == "DIFFERENCE":
                _apply_payload(existing, row.proposed_change)
                updated += 1
            else:
                unchanged += 1
            status = row.proposed_change.get("status") if row.proposed_change else None
            late_entries += status == "late"
            incomplete_entries += status == "incomplete"

        result = {
            "status": "committed",
            "batch_id": batch.id,
            "rows_inserted": inserted,
            "rows_updated": updated,
            "rows_unchanged": unchanged,
            "new_students": new_students,
        }
        db.add(UploadLog(
            filename=batch.filename,
            uploaded_by=username,
            total_records=len(rows),
            new_students=new_students,
            late_entries=late_entries,
            incomplete_entries=incomplete_entries,
            failed_rows=0,
            skipped_empty=0,
            status="success",
        ))
        batch.status = "committed"
        batch.committed_at = datetime.now()
        batch.commit_result = result
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
