from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import io
import logging
import pandas as pd
from datetime import date, timedelta, time
from pydantic import BaseModel, Field

from services.excel_parser import parse_excel
from core.database import get_db
from models.attendance import Attendance
from models.student import Student
from models.upload_log import UploadLog
from models.attendance_import import AttendanceImportRow
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.attendance_import_preview import (
    commit_attendance_preview,
    create_attendance_preview,
    serialize_preview,
)
from services.attendance_metrics import calculate_heb, derive_jenjang_from_class_name, month_year_filters
from services.upload_history import (
    evidence_csv,
    evidence_json,
    get_upload_record,
    list_upload_history,
    upload_rows,
    upload_timeline,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_XLS_MIME = "application/vnd.ms-excel"
_ACCEPTED_MIMES = {_XLSX_MIME, _XLS_MIME, "application/octet-stream", "application/zip"}


class AttendanceImportCommitRequest(BaseModel):
    selected_row_ids: list[int] = Field(min_length=1)
    confirmation: str
    preview_checksum: str = Field(min_length=64, max_length=64)


def _validate_excel_upload(file: UploadFile) -> None:
    is_excel_mime = file.content_type in _ACCEPTED_MIMES
    is_excel_ext = (file.filename or "").lower().endswith((".xlsx", ".xls"))
    if not (is_excel_mime or is_excel_ext):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file.content_type}'. Please upload a .xlsx or .xls file.",
        )


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


@router.post("/preview")
async def preview_attendance_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("import_attendance")),
):
    """Parse an attendance workbook into staging without changing live records."""
    _validate_excel_upload(file)
    try:
        batch = create_attendance_preview(
            db,
            await file.read(),
            file.filename or "unknown.xlsx",
            current_user.username,
        )
        rows = (
            db.query(AttendanceImportRow)
            .filter(AttendanceImportRow.batch_id == batch.id)
            .order_by(AttendanceImportRow.id.asc())
            .all()
        )
        return serialize_preview(batch, rows)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected attendance workbook preview failure")
        raise HTTPException(status_code=500, detail="The server could not preview the workbook.") from exc


@router.post("/preview/{batch_id}/commit")
def commit_previewed_attendance_import(
    batch_id: str,
    request: AttendanceImportCommitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("import_attendance")),
):
    """Atomically commit explicitly selected, non-conflicting preview rows."""
    return commit_attendance_preview(
        db,
        batch_id,
        request.selected_row_ids,
        request.confirmation,
        current_user.username,
        request.preview_checksum,
    )

@router.post("/upload", deprecated=True)
async def upload_file(
    file: UploadFile = File(...),
    _current_user: User = Depends(require_capability("import_attendance")),
):
    del file
    raise HTTPException(
        status_code=410,
        detail={
            "code": "LEGACY_ATTENDANCE_IMPORT_DISABLED",
            "message": "Direct attendance import is disabled. Use preview and commit.",
        },
    )


@router.get("/history")
def get_upload_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    workflow_type: str | None = Query(None, max_length=20),
    status: str | None = Query(None, max_length=32),
    reconciliation_state: str | None = Query(None, max_length=32),
    actor: str | None = Query(None, max_length=100),
    filename: str | None = Query(None, max_length=100),
    checksum_prefix: str | None = Query(None, min_length=4, max_length=64),
    unresolved_only: bool = False,
    retry_activity: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    return list_upload_history(
        db,
        page=page,
        page_size=page_size,
        workflow_type=workflow_type,
        status=status,
        reconciliation_state=reconciliation_state,
        actor=actor,
        filename=filename,
        checksum_prefix=checksum_prefix,
        unresolved_only=unresolved_only,
        retry_activity=retry_activity,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/history/{upload_id}")
def get_upload_history_detail(
    upload_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    return get_upload_record(db, upload_id)


@router.get("/history/{upload_id}/timeline")
def get_upload_history_timeline(
    upload_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    return {"items": upload_timeline(db, upload_id)}


@router.get("/history/{upload_id}/rows")
def get_upload_history_rows(
    upload_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    outcome: str | None = Query(None, max_length=24),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    return upload_rows(db, upload_id, page=page, page_size=page_size, outcome=outcome)


def _evidence_name(upload_id: str, extension: str) -> str:
    safe_id = "".join(character if character.isalnum() or character in "-_" else "-" for character in upload_id)
    return f"operatoros-upload-evidence-{safe_id}.{extension}"


@router.get("/history/{upload_id}/export.csv")
def export_upload_history_csv(
    upload_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    content = evidence_csv(db, upload_id)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_evidence_name(upload_id, "csv")}"'},
    )


@router.get("/history/{upload_id}/export.json")
def export_upload_history_json(
    upload_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_student_audit")),
):
    content = evidence_json(db, upload_id)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_evidence_name(upload_id, "json")}"'},
    )


@router.get("/missing-records")
def get_missing_records(
    month: int,
    year: int,
    class_name: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_attendance")),
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
def download_sample_template(
    _user: User = Depends(require_capability("import_attendance")),
):
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
