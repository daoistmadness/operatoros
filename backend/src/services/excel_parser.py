import logging
import datetime
from io import BytesIO
import pandas as pd
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.jenjang_config import JenjangConfig
from models.student import Student
from services.attendance_metrics import derive_jenjang_from_class_name

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000
MAX_ROW_ERRORS = 10
_seen_bad_times = set()
REQUIRED_COLUMNS = [
    "No. ID",
    "Nama",
    "Tanggal",
    "Scan Masuk",
    "Scan Pulang",
    "Terlambat",
    "Lembur",
    "Pengecualian",
    "week",
]


def _is_blank(value) -> bool:
    if pd.isna(value):
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def _warn_parse_once(kind: str, column: str, value, warned_values: set):
    raw = "" if value is None else str(value).strip()
    key = (kind, column, raw)
    if key in warned_values:
        return
    warned_values.add(key)
    logger.warning('[PARSE WARNING] Unrecognized %s value: "%s" — treated as null', column, raw)


def _capture_row_error(stats: dict, excel_row, no_id, nama, record_date, reason: str):
    if len(stats["row_errors"]) >= MAX_ROW_ERRORS:
        return

    date_text = None
    if isinstance(record_date, datetime.datetime):
        date_text = record_date.date().isoformat()
    elif hasattr(record_date, "isoformat"):
        date_text = record_date.isoformat()
    elif record_date is not None:
        date_text = str(record_date)

    stats["row_errors"].append(
        {
            "excel_row": int(excel_row) if excel_row is not None else None,
            "no_id": None if no_id is None else str(no_id),
            "nama": None if nama is None else str(nama),
            "date": date_text,
            "reason": reason,
        }
    )


def _parse_time(value, column_name: str, stats: dict, warned_values: set):
    if pd.isna(value):
        return None

    if isinstance(value, datetime.time):
        return value

    if isinstance(value, pd.Timestamp):
        return value.time()

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.datetime.strptime(text, "%H:%M").time()
        except ValueError:
            pass

    parsed_value = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed_value):
        stats["scans_coerced_to_null"] += 1
        _warn_parse_once("scan", column_name, value, _seen_bad_times)
        return None
    return parsed_value.time()


def _to_minutes_robust(value):
    if pd.isna(value):
        return 0
    if isinstance(value, (pd.Timedelta, datetime.timedelta)):
        return int(value.total_seconds() // 60)
    if isinstance(value, datetime.time):
        return (value.hour * 60) + value.minute
    if isinstance(value, str):
        val_str = value.strip()
        if not val_str:
            return 0
        try:
            parts = val_str.split(':')
            if len(parts) >= 2:
                return (int(parts[0]) * 60) + int(parts[1])
        except Exception:
            pass
        
        parsed = pd.to_timedelta(value, errors="coerce")
        if not pd.isna(parsed):
            return int(parsed.total_seconds() // 60)
    return 0

def _parse_duration(value):
    if pd.isna(value):
        return None
    mins = _to_minutes_robust(value)
    if mins > 0:
        return datetime.timedelta(minutes=mins)
    return None


def _derive_status(check_in_time, check_out_time, late_duration: int) -> str:
    if check_in_time is not None and check_out_time is not None:
        return "late" if (late_duration or 0) > 0 else "on-time"
    if (check_in_time is not None) != (check_out_time is not None):
        return "incomplete"
    return "absent"


def _time_to_minutes(value):
    if value is None:
        return None
    return (value.hour * 60) + value.minute


def _parse_late_excel_minutes(value):
    mins = _to_minutes_robust(value)
    return max(0, mins)


def _cutoff_to_minutes(cutoff_text):
    if cutoff_text is None:
        return None

    text = cutoff_text.strip()
    if not text:
        return None

    try:
        hour_text, minute_text = text.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except Exception:
        return None

    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return (hour * 60) + minute


def _resolve_cutoff_minutes(cutoff_map, jenjang):
    if jenjang is None:
        return None

    raw = cutoff_map.get(jenjang)
    if raw is None:
        raw = cutoff_map.get(jenjang.upper())
    return _cutoff_to_minutes(raw)


def _resolve_late_duration_minutes(check_in_time, terlambat_value, cutoff_map, jenjang):
    excel_minutes = _parse_late_excel_minutes(terlambat_value)
    if excel_minutes > 0:
        return excel_minutes, "excel"

    if check_in_time is not None:
        cutoff_minutes = _resolve_cutoff_minutes(cutoff_map, jenjang)
        if cutoff_minutes is not None:
            scan_minutes = _time_to_minutes(check_in_time)
            calculated = max(0, scan_minutes - cutoff_minutes)
            return calculated, "calculated"
        return 0, "none"

    return 0, "none"


def _normalize_chunk(chunk: pd.DataFrame, stats: dict, warned_values: set) -> tuple[pd.DataFrame, int, int]:
    chunk = chunk.copy()
    chunk.columns = chunk.columns.str.strip()

    original_dates = chunk["Tanggal"].copy()
    parsed_dates = pd.to_datetime(chunk["Tanggal"], format="%d/%m/%Y", errors="coerce")
    invalid_dates = original_dates[parsed_dates.isna()]
    for raw_value in invalid_dates.dropna().tolist():
        if _is_blank(raw_value):
            continue
        stats["dates_coerced_to_null"] += 1
        _warn_parse_once("date", "Tanggal", raw_value, warned_values)

    chunk["Tanggal"] = parsed_dates
    # Removed pd.to_timedelta cast for Terlambat/Lembur due to NaT bug with "00:00" type strings.
    # Handled inside _parse_duration and _parse_late_excel_minutes safely.
    
    before = len(chunk)
    chunk = chunk.dropna(how="all")
    skipped_empty = before - len(chunk)

    before_ident = len(chunk)
    chunk = chunk.dropna(subset=["No. ID", "Nama", "Tanggal"])
    chunk = chunk[chunk["Nama"].astype(str).str.strip() != ""]
    failed_ident = before_ident - len(chunk)
    stats["rows_dropped_invalid"] += failed_ident

    if failed_ident > 0:
        logger.warning("Dropped %s invalid rows missing ID/Name/Date.", failed_ident)

    return chunk, skipped_empty, failed_ident


def _iter_excel_chunks(file_obj, chunk_size: int, engine: str = "openpyxl"):
    workbook = pd.ExcelFile(file_obj, engine=engine)
    header = pd.read_excel(workbook, sheet_name=0, nrows=0)
    header.columns = header.columns.str.strip()

    missing = [col for col in REQUIRED_COLUMNS if col not in header.columns]
    if missing:
        raise ValueError(f"Missing required column: {missing[0]}")

    df = pd.read_excel(workbook, sheet_name=0)
    df.columns = df.columns.str.strip()
    df = df.dropna(how="all")
    df["__excel_row"] = df.index + 2

    for start in range(0, len(df), chunk_size):
        yield df.iloc[start : start + chunk_size]


def _ensure_student(db: Session, student_id: int, student_name: str, stats: dict) -> Student:
    student = db.query(Student).filter_by(id=student_id).first()
    if student:
        if student.name != student_name:
            student.name = student_name
        return student

    name_match = db.query(Student).filter_by(name=student_name).first()
    if name_match and name_match.id != student_id:
        old_id = name_match.id
        logger.warning("Student ID migration: %s -> %s for '%s'", old_id, student_id, student_name)

        replacement = Student(
            id=student_id,
            name=name_match.name,
            class_name=name_match.class_name,
            jenjang=name_match.jenjang,
            id_updated_at=datetime.utcnow(),
        )
        db.add(replacement)
        db.flush()

        db.query(Attendance).filter(Attendance.student_id == old_id).update(
            {Attendance.student_id: student_id},
            synchronize_session=False,
        )
        db.delete(name_match)
        db.flush()
        return replacement

    student = Student(id=student_id, name=student_name, class_name=None, jenjang=None)
    db.add(student)
    db.flush()
    stats["new_students"] += 1
    return student


def _is_absent_flag_true(value) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in {"true", "1", "yes", "y"}


def _scan_score(entry: dict) -> int:
    score = 0
    if entry["check_in"] is not None:
        score += 1
    if entry["check_out"] is not None:
        score += 1
    return score


def _build_chunk_entries(chunk: pd.DataFrame, stats: dict, warned_values: set, cutoff_map: dict[str, str]) -> list[dict]:
    normalized_chunk, skipped_empty, failed_ident = _normalize_chunk(chunk, stats, warned_values)
    stats["skipped_empty"] += skipped_empty
    stats["failed_rows"] += failed_ident

    chunk_seen: dict[tuple[int, object], dict] = {}

    for _, row in normalized_chunk.iterrows():
        excel_row = row.get("__excel_row")
        try:
            student_id = int(row["No. ID"])
            student_name = str(row["Nama"]).strip()
            record_date = row["Tanggal"].date()

            check_in_time = _parse_time(row["Scan Masuk"], "Scan Masuk", stats, warned_values)
            check_out_time = _parse_time(row["Scan Pulang"], "Scan Pulang", stats, warned_values)
            exception_val = None if pd.isna(row.get("Pengecualian")) else str(row.get("Pengecualian")).strip()
            absent_flag = _is_absent_flag_true(row.get("Absent"))

            if check_in_time is None and check_out_time is None and not absent_flag and _is_blank(exception_val):
                stats["skipped_empty"] += 1
                continue

            entry = {
                "excel_row": excel_row,
                "student_id": student_id,
                "student_name": student_name,
                "date": record_date,
                "check_in": check_in_time,
                "check_out": check_out_time,
                "overtime": _parse_duration(row["Lembur"]),
                "terlambat": row["Terlambat"],
                "exception": exception_val,
                "week": None if pd.isna(row["week"]) else str(row["week"]).strip(),
            }

            key = (student_id, record_date)
            if key in chunk_seen:
                stats["intra_chunk_conflicts"] += 1
                if _scan_score(entry) > _scan_score(chunk_seen[key]):
                    chunk_seen[key] = entry
            else:
                chunk_seen[key] = entry

        except Exception as error:
            stats["failed_rows"] += 1
            _capture_row_error(
                stats,
                excel_row,
                row.get("No. ID"),
                row.get("Nama"),
                row.get("Tanggal"),
                str(error),
            )
            logger.error("Failed to parse row %s: %s", excel_row, error)

    return list(chunk_seen.values())


def _upsert_entry(entry: dict, db: Session, stats: dict, cutoff_map: dict[str, str]):
    student = _ensure_student(db, entry["student_id"], entry["student_name"], stats)
    jenjang_key = student.jenjang or derive_jenjang_from_class_name(student.class_name)
    late_duration, late_source = _resolve_late_duration_minutes(
        entry["check_in"],
        entry["terlambat"],
        cutoff_map,
        jenjang_key,
    )

    status = _derive_status(entry["check_in"], entry["check_out"], late_duration)
    existing = db.query(Attendance).filter_by(student_id=student.id, date=entry["date"]).first()

    if existing:
        before = (
            existing.check_in,
            existing.check_out,
            existing.late_duration,
            existing.late_source,
            existing.is_absent,
            existing.overtime,
            existing.exception,
            existing.week,
            existing.status,
        )

        if entry["check_in"] is not None:
            existing.check_in = entry["check_in"]
        elif existing.check_in is not None:
            stats["null_overwrite_blocked"] += 1

        if entry["check_out"] is not None:
            existing.check_out = entry["check_out"]
        elif existing.check_out is not None:
            stats["null_overwrite_blocked"] += 1

        # TRACE: existing.check_in = "07:00", incoming = None
        # After Fix 1: existing.check_in preserved as "07:00"
        # Status re-derived from preserved check_in/check_out and late_duration

        existing.late_duration = late_duration
        existing.late_source = late_source
        existing.overtime = entry["overtime"]
        existing.exception = entry["exception"]
        existing.week = entry["week"]
        existing.status = _derive_status(existing.check_in, existing.check_out, existing.late_duration)
        existing.is_absent = existing.status == "absent"
        status = existing.status

        after = (
            existing.check_in,
            existing.check_out,
            existing.late_duration,
            existing.late_source,
            existing.is_absent,
            existing.overtime,
            existing.exception,
            existing.week,
            existing.status,
        )
        if before == after:
            stats["rows_unchanged"] += 1
        else:
            stats["rows_updated"] += 1
    else:
        attendance = Attendance(
            student_id=student.id,
            date=entry["date"],
            check_in=entry["check_in"],
            check_out=entry["check_out"],
            late_duration=late_duration,
            late_source=late_source,
            is_absent=status == "absent",
            overtime=entry["overtime"],
            exception=entry["exception"],
            week=entry["week"],
            status=status,
        )
        db.add(attendance)
        stats["rows_inserted"] += 1

    stats["total_records"] += 1
    if status == "late":
        stats["late_entries"] += 1
    elif status == "incomplete":
        stats["incomplete_entries"] += 1


def _process_chunk_with_fallback(entries: list[dict], db: Session, stats: dict, cutoff_map: dict[str, str]):
    try:
        for entry in entries:
            _upsert_entry(entry, db, stats, cutoff_map)
        db.commit()
        return
    except Exception as error:
        logger.warning("Chunk failed (%s). Falling back to per-row commits.", error)
        db.rollback()
        db.expunge_all()
        stats["chunk_fallbacks"] += 1

    for entry in entries:
        try:
            _upsert_entry(entry, db, stats, cutoff_map)
            db.commit()
        except Exception as row_error:
            db.rollback()
            db.expunge_all()
            stats["failed_rows"] += 1
            _capture_row_error(
                stats,
                entry.get("excel_row"),
                entry.get("student_id"),
                entry.get("student_name"),
                entry.get("date"),
                str(row_error),
            )


def _load_cutoff_map(db: Session) -> dict[str, str]:
    rows = db.query(JenjangConfig.jenjang, JenjangConfig.cutoff_time).all()
    cutoff_map = {}
    for row in rows:
        if row.jenjang:
            cutoff_map[row.jenjang.strip()] = row.cutoff_time
            cutoff_map[row.jenjang.strip().upper()] = row.cutoff_time
    return cutoff_map


async def parse_excel(file, db: Session):
    global _seen_bad_times
    _seen_bad_times = set()

    stats = {
        "total_records": 0,
        "new_students": 0,
        "late_entries": 0,
        "failed_rows": 0,
        "skipped_empty": 0,
        "incomplete_entries": 0,
        "failed_records": [],
        "row_errors": [],
        "rows_inserted": 0,
        "rows_updated": 0,
        "rows_unchanged": 0,
        "rows_dropped_invalid": 0,
        "scans_coerced_to_null": 0,
        "dates_coerced_to_null": 0,
        "null_overwrite_blocked": 0,
        "intra_chunk_conflicts": 0,
        "chunk_fallbacks": 0,
        "warnings": [],
    }

    warned_values: set = set()

    try:
        cutoff_map = _load_cutoff_map(db)
        file.file.seek(0)

        filename = (file.filename or "").lower()
        engine = "xlrd" if filename.endswith(".xls") else "openpyxl"

        for chunk in _iter_excel_chunks(file.file, CHUNK_SIZE, engine=engine):
            entries = _build_chunk_entries(chunk, stats, warned_values, cutoff_map)
            _process_chunk_with_fallback(entries, db, stats, cutoff_map)

        if not stats["failed_records"] and stats["row_errors"]:
            stats["failed_records"] = [
                {
                    "student": (item.get("nama") or "Unknown"),
                    "date": (item.get("date") or "Unknown"),
                    "reason": item.get("reason", "Unknown error"),
                }
                for item in stats["row_errors"]
            ]

        if stats.get("incomplete_entries", 0) > 0:
            stats["warnings"].append(
                f"{stats['incomplete_entries']} rows have Scan Masuk but no Scan Pulang. "
                "These are marked 'incomplete'. Use Mass Override on the Attendance Review "
                "page to resolve them after upload."
            )

        return stats

    except Exception as error:
        db.rollback()
        logger.error("Error parsing Excel: %s", error)
        raise error
