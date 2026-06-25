from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from models.absence_reason import AbsenceReason
from models.student import Student
from models.attendance import Attendance
from core.database import get_db
from services.attendance_metrics import (
    calculate_heb,
    derive_jenjang_from_class_name,
    month_year_filters,
)
import math

router = APIRouter()


class SetClassBody(BaseModel):
    student_id: int
    class_name: str
    jenjang: str


class BulkAssignBody(BaseModel):
    student_ids: list[int] = Field(default_factory=list)
    class_name: str
    jenjang: str


@router.post("/set-class")
def set_class(body: SetClassBody, db: Session = Depends(get_db)):
    """
    Updates the class and jenjang information for a student.
    Accepts a JSON body: { student_id, class_name, jenjang }.
    """
    student = db.query(Student).filter_by(id=body.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student.class_name = body.class_name.strip()
    student.jenjang = body.jenjang.strip()
    db.commit()
    return {"message": f"Student {student.name} moved to {student.jenjang} - {student.class_name}"}


@router.get("")
def get_students(
    search: str | None = None,
    jenjang: str | None = None,
    class_name: str | None = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
):
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be at least 1")
    if page_size < 1:
        raise HTTPException(status_code=400, detail="page_size must be at least 1")
    if page_size > 200:
        raise HTTPException(status_code=400, detail="page_size must be at most 200")

    query = db.query(Student)

    if search:
        keyword = search.strip().lower()
        if keyword:
            query = query.filter(func.lower(Student.name).like(f"%{keyword}%"))

    if jenjang and jenjang.strip():
        query = query.filter(Student.jenjang == jenjang.strip())

    if class_name and class_name.strip():
        class_filter = class_name.strip()
        if class_filter == "unassigned":
            query = query.filter(Student.class_name.is_(None))
        else:
            query = query.filter(Student.class_name == class_filter)

    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 0
    offset = (page - 1) * page_size

    rows = (
        query.order_by(Student.name.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    return {
        "students": [
            {
                "id": student.id,
                "name": student.name,
                "jenjang": student.jenjang,
                "class_name": student.class_name,
            }
            for student in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.patch("/assign-class")
def assign_class_bulk(body: BulkAssignBody, db: Session = Depends(get_db)):
    student_ids = body.student_ids
    class_name = body.class_name.strip()
    jenjang = body.jenjang.strip()

    if not student_ids:
        raise HTTPException(status_code=400, detail="student_ids must be a non-empty list")
    if not class_name:
        raise HTTPException(status_code=400, detail="class_name must be a non-empty string")
    if not jenjang:
        raise HTTPException(status_code=400, detail="jenjang must be a non-empty string")

    updated = (
        db.query(Student)
        .filter(Student.id.in_(student_ids))
        .update(
            {
                Student.class_name: class_name,
                Student.jenjang: jenjang,
            },
            synchronize_session=False,
        )
    )
    db.commit()

    return {
        "updated": updated,
        "class_name": class_name,
        "jenjang": jenjang,
    }



@router.get("/classes")
def get_existing_classes(db: Session = Depends(get_db)):
    """
    Returns a sorted distinct list of all assigned class names.
    Used to power the class mapping dropdown/autocomplete.
    """
    rows = (
        db.query(Student.class_name)
        .filter(Student.class_name.isnot(None))
        .distinct()
        .order_by(Student.class_name)
        .all()
    )
    return [r[0] for r in rows if r[0] and r[0].strip()]


@router.get("/all")
def get_all_students(db: Session = Depends(get_db)):
    """
    Returns a list of all students with their class mapping.
    """
    return db.query(Student).all()


def _format_time(value):
    if value is None:
        return None
    return value.strftime("%H:%M")


def _format_duration(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        total_minutes = int(value)
    else:
        total_minutes = int(value.total_seconds() // 60)

    sign = "-" if total_minutes < 0 else ""
    total_minutes = abs(total_minutes)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{sign}{hours:02d}:{minutes:02d}"


def _derived_status(row: Attendance) -> str:
    if row.check_in is not None and row.check_out is not None:
        if (row.late_duration or 0) > 0:
            return "late"
        return "on-time"
    if row.check_in is not None or row.check_out is not None:
        return "incomplete"
    return "absent"


@router.get("/{no_id}/attendance-summary")
def get_student_attendance_summary(
    no_id: int,
    month: int | None = None,
    year: int | None = None,
    db: Session = Depends(get_db),
):
    if month is not None and (month < 1 or month > 12):
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    if (month is None) != (year is None):
        raise HTTPException(status_code=400, detail="month and year must be provided together")

    student = db.query(Student).filter(Student.id == no_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    query = db.query(Attendance).filter(Attendance.student_id == student.id)
    if month is not None and year is not None:
        query = query.filter(*month_year_filters(db, Attendance.date, month, year))

    rows = query.order_by(Attendance.date.asc()).all()

    total_present = sum(
        1
        for row in rows
        if row.check_in is not None and row.check_out is not None and (row.late_duration or 0) == 0
    )
    total_late = sum(
        1
        for row in rows
        if row.check_in is not None and row.check_out is not None and (row.late_duration or 0) > 0
    )
    total_incomplete = sum(1 for row in rows if (row.check_in is not None) != (row.check_out is not None))
    total_absent = sum(1 for row in rows if row.check_in is None and row.check_out is None)
    jenjang = student.jenjang or derive_jenjang_from_class_name(student.class_name)

    if month is not None and year is not None:

        heb = calculate_heb(db, jenjang, month, year)["heb"]
    else:
        month_rows = (
            db.query(func.distinct(func.strftime("%Y-%m", Attendance.date)) if db.bind.dialect.name == "sqlite" else func.distinct(func.to_char(Attendance.date, "YYYY-MM")))
            .filter(Attendance.date.isnot(None))
            .all()
        )
        heb = 0
        for month_row in month_rows:
            month_key = month_row[0]
            year_text, month_text = month_key.split("-")
            heb += calculate_heb(db, jenjang, int(month_text), int(year_text))["heb"]

    attended = total_present + total_late + total_incomplete
    attendance_rate = round(attended / heb, 3) if heb > 0 else None

    sia_query = db.query(
        func.sum(AbsenceReason.sakit).label("sakit"),
        func.sum(AbsenceReason.izin).label("izin"),
        func.sum(AbsenceReason.alfa).label("alfa")
    ).filter(AbsenceReason.student_id == student.id)
    
    if month is not None and year is not None:
        sia_query = sia_query.filter(AbsenceReason.month == month, AbsenceReason.year == year)
    
    sia_row = sia_query.one_or_none()
    sakit = int(sia_row.sakit or 0) if sia_row else 0
    izin = int(sia_row.izin or 0) if sia_row else 0
    alfa = int(sia_row.alfa or 0) if sia_row else 0

    breakdown = [
        {
            "date": row.date.isoformat() if row.date is not None else None,
            "status": _derived_status(row),
            "scan_masuk": _format_time(row.check_in),
            "terlambat": _format_duration(row.late_duration),
        }
        for row in rows
    ]

    return {
        "no_id": str(student.id),
        "nama": student.name,
        "class_name": student.class_name,
        "jenjang": jenjang,
        "total_present": total_present,
        "total_late": total_late,
        "total_incomplete": total_incomplete,
        "total_absent": total_absent,
        "sakit": sakit,
        "izin": izin,
        "alfa": alfa,
        "heb": heb,
        "attendance_rate": attendance_rate,
        "breakdown": breakdown,
    }


@router.get("/{no_id}/monthly-history")
def get_student_monthly_history(
    no_id: int,
    db: Session = Depends(get_db),
):
    """
    Returns per-month aggregated attendance stats for a student,
    sorted ascending by year/month. Used for the trend chart on
    the Attendance Profile page.
    """
    student = db.query(Student).filter(Student.id == no_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    jenjang = student.jenjang or derive_jenjang_from_class_name(student.class_name)

    # Get distinct year-month combinations for this student
    is_sqlite = db.bind.dialect.name == "sqlite"
    if is_sqlite:
        month_fmt = func.strftime("%Y-%m", Attendance.date)
    else:
        month_fmt = func.to_char(Attendance.date, "YYYY-MM")

    month_rows = (
        db.query(func.distinct(month_fmt))
        .filter(Attendance.student_id == student.id)
        .filter(Attendance.date.isnot(None))
        .order_by(func.distinct(month_fmt).asc())
        .all()
    )

    history = []
    for (month_key,) in month_rows:
        if not month_key:
            continue
        year_text, month_text = month_key.split("-")
        y, m = int(year_text), int(month_text)

        rows = (
            db.query(Attendance)
            .filter(
                Attendance.student_id == student.id,
                *month_year_filters(db, Attendance.date, m, y),
            )
            .all()
        )

        present = sum(
            1 for r in rows
            if r.check_in is not None and r.check_out is not None and (r.late_duration or 0) == 0
        )
        late = sum(
            1 for r in rows
            if r.check_in is not None and r.check_out is not None and (r.late_duration or 0) > 0
        )
        absent = sum(1 for r in rows if r.check_in is None and r.check_out is None)

        heb_data = calculate_heb(db, jenjang, m, y)
        heb = heb_data["heb"]
        attended = present + late
        rate = round(attended / heb, 3) if heb > 0 else None

        history.append({
            "year": y,
            "month": m,
            "month_label": f"{month_text}/{year_text}",
            "present": present,
            "late": late,
            "absent": absent,
            "heb": heb,
            "attendance_rate": rate,
        })

    return {
        "no_id": str(student.id),
        "nama": student.name,
        "class_name": student.class_name,
        "jenjang": jenjang,
        "history": history,
    }
