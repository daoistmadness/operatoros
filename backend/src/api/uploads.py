from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import io
import pandas as pd
from datetime import date, timedelta, time

from services.excel_parser import parse_excel
from core.database import get_db
from models.attendance import Attendance
from models.student import Student
from models.upload_log import UploadLog
from services.attendance_metrics import calculate_heb, derive_jenjang_from_class_name, month_year_filters

router = APIRouter()

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_XLS_MIME = "application/vnd.ms-excel"
_ACCEPTED_MIMES = {_XLSX_MIME, _XLS_MIME, "application/octet-stream", "application/zip"}


def _write_upload_log(
    db: Session,
    filename: str,
    uploaded_by: str | None,
    report: dict,
    status: str,
) -> None:
    log_row = UploadLog(
        filename=filename,
        uploaded_by=uploaded_by,
        total_records=int(report.get("total_records", 0)),
        new_students=int(report.get("new_students", 0)),
        late_entries=int(report.get("late_entries", 0)),
        incomplete_entries=int(report.get("incomplete_entries", 0)),
        failed_rows=int(report.get("failed_rows", 0)),
        skipped_empty=int(report.get("skipped_empty", 0)),
        status=status,
    )

    db.add(log_row)
    db.commit()


def _resolve_upload_status(report: dict) -> str:
    total_records = int(report.get("total_records", 0))
    failed_rows = int(report.get("failed_rows", 0))

    if total_records == 0 and failed_rows > 0:
        return "failed"
    if failed_rows > 0:
        return "partial"
    return "success"

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Endpoint for uploading attendance Excel files.
    Returns a summary report of the processed data.
    """
    filename = file.filename or "unknown.xlsx"
    uploaded_by = None

    # Accept by MIME or by extension — browsers sometimes send octet-stream
    # for files with spaces or parentheses in the name.
    is_excel_mime = file.content_type in _ACCEPTED_MIMES
    is_excel_ext = (file.filename or "").lower().endswith((".xlsx", ".xls"))
    if not (is_excel_mime or is_excel_ext):
        _write_upload_log(db, filename, uploaded_by, {
            "total_records": 0, "new_students": 0, "late_entries": 0, "failed_rows": 0,
        }, "failed")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file.content_type}'. Please upload a .xlsx or .xls file.",
        )
    
    base_report = {
        "total_records": 0,
        "new_students": 0,
        "late_entries": 0,
        "failed_rows": 0,
        "skipped_empty": 0,
        "incomplete_entries": 0,
        "rows_inserted": 0,
        "rows_updated": 0,
        "rows_unchanged": 0,
        "rows_dropped_invalid": 0,
        "scans_coerced_to_null": 0,
        "dates_coerced_to_null": 0,
        "null_overwrite_blocked": 0,
        "intra_chunk_conflicts": 0,
        "chunk_fallbacks": 0,
        "row_errors": [],
        "failed_records": [],
        "pending_categorization_count": 0,
    }

    
    try:
        report = await parse_excel(file, db)
        pending_count = (
            db.query(func.count(Student.id))
            .filter(Student.class_name.is_(None))
            .scalar()
            or 0
        )
        report["pending_categorization_count"] = pending_count
        status = _resolve_upload_status(report)

        _write_upload_log(db, filename, uploaded_by, report, status)

        if status == "success":
            message = "Upload Complete"
        elif status == "partial":
            message = "Upload Partially Complete"
        else:
            message = "Upload Failed"
        
        return {
            "message": message,
            "report": report
        }
    except ValueError as val_err:
        db.rollback()
        _write_upload_log(db, filename, uploaded_by, base_report, "failed")
        raise HTTPException(status_code=400, detail=str(val_err))
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        _write_upload_log(db, filename, uploaded_by, base_report, "failed")
        raise HTTPException(
            status_code=500,
            detail={
                "error": type(e).__name__,
                "message": str(e),
                "hint": "Check that your file matches the expected format and all required columns are present.",
            },
        )


@router.get("/history")
def get_upload_history(db: Session = Depends(get_db)):
    return db.query(UploadLog).order_by(UploadLog.uploaded_at.desc()).limit(20).all()


@router.get("/missing-records")
def get_missing_records(
    month: int,
    year: int,
    class_name: str | None = None,
    db: Session = Depends(get_db),
):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")

    students_query = db.query(Student)
    if class_name and class_name.strip().lower() != "all":
        class_filter = class_name.strip()
        if class_filter == "unassigned":
            students_query = students_query.filter(Student.class_name.is_(None))
        else:
            students_query = students_query.filter(Student.class_name == class_filter)

    students = students_query.order_by(Student.name.asc()).all()
    student_ids = [student.id for student in students]

    attendance_counts: dict[int, int] = {}
    if student_ids:
        filters = month_year_filters(db, Attendance.date, month, year)
        rows = (
            db.query(Attendance.student_id, func.count(Attendance.id).label("attendance_count"))
            .filter(Attendance.student_id.in_(student_ids), Attendance.status != "skipped", *filters)
            .group_by(Attendance.student_id)
            .all()
        )
        attendance_counts = {row.student_id: int(row.attendance_count) for row in rows}

    heb_by_jenjang: dict[str, int] = {}
    under_recorded = []

    for student in students:
        jenjang = student.jenjang or derive_jenjang_from_class_name(student.class_name)
        if jenjang not in heb_by_jenjang:
            heb_by_jenjang[jenjang] = calculate_heb(db, jenjang, month, year)["heb"]

        heb_value = heb_by_jenjang[jenjang]
        attendance_count = attendance_counts.get(student.id, 0)
        if attendance_count < heb_value:
            under_recorded.append(
                {
                    "no_id": str(student.id),
                    "nama": student.name,
                    "class_name": student.class_name,
                    "jenjang": jenjang,
                    "heb": heb_value,
                    "attendance_count": attendance_count,
                    "missing_days": heb_value - attendance_count,
                }
            )

    return {
        "month": f"{year}-{month:02d}",
        "heb_by_jenjang": heb_by_jenjang,
        "under_recorded": under_recorded,
        "total_students": len(students),
        "under_recorded_count": len(under_recorded),
    }


@router.get("/sample-template")
def download_sample_template():
    """Returns a sample .xlsx matching the required import format."""
    today = date.today()

    rows = [
        {"No. ID": 20000001, "Nama": "Budi Santoso",    "Tanggal": today.strftime("%d/%m/%Y"),                       "Scan Masuk": "07:00", "Scan Pulang": "14:30", "Terlambat": "",        "Absent": "",     "Lembur": "",        "Pengecualian": "",      "week": today.strftime("%a")},
        {"No. ID": 20000002, "Nama": "Siti Rahayu",     "Tanggal": today.strftime("%d/%m/%Y"),                       "Scan Masuk": "07:45", "Scan Pulang": "14:30", "Terlambat": "0:45:00", "Absent": "",     "Lembur": "",        "Pengecualian": "",      "week": today.strftime("%a")},
        {"No. ID": 20000003, "Nama": "Ahmad Fauzi",     "Tanggal": today.strftime("%d/%m/%Y"),                       "Scan Masuk": "",      "Scan Pulang": "",      "Terlambat": "",        "Absent": "True", "Lembur": "",        "Pengecualian": "Sakit", "week": today.strftime("%a")},
        {"No. ID": 20000004, "Nama": "Dewi Kurniawati", "Tanggal": (today + timedelta(days=1)).strftime("%d/%m/%Y"), "Scan Masuk": "06:55", "Scan Pulang": "15:00", "Terlambat": "",        "Absent": "",     "Lembur": "0:30:00", "Pengecualian": "",      "week": (today + timedelta(days=1)).strftime("%a")},
        {"No. ID": 20000005, "Nama": "Rizky Pratama",   "Tanggal": (today + timedelta(days=1)).strftime("%d/%m/%Y"), "Scan Masuk": "08:10", "Scan Pulang": "14:30", "Terlambat": "1:10:00", "Absent": "",     "Lembur": "",        "Pengecualian": "",      "week": (today + timedelta(days=1)).strftime("%a")},
    ]

    df = pd.DataFrame(rows, columns=[
        "No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang",
        "Terlambat", "Absent", "Lembur", "Pengecualian", "week",
    ])

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Attendance")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": "attachment; filename=attendance_template.xlsx"},
    )
