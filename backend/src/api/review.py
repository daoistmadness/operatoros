from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from api.error_responses import raise_internal_error
from core.database import get_db
from models.user import User
from security.dependencies import get_current_user, require_capability
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.academic_master import AcademicClass
from models.academic_year import AcademicYear
from services.attendance_corrections import ensure_period_open

router = APIRouter(dependencies=[Depends(get_current_user)])

ALLOWED_STATUSES = {"on-time", "late", "absent", "incomplete"}


def _format_time(value) -> str | None:
    if value is None:
        return None
    return value.strftime("%H:%M")


class ReviewClassItem(BaseModel):
    id: int
    name: str


class ReviewClassesResponse(BaseModel):
    classes: list[ReviewClassItem]


class ReviewAttendanceItem(BaseModel):
    attendance_id: int
    student_id: int
    student_name: str
    class_name: str | None
    date: date
    scan_in: str | None
    scan_out: str | None
    original_status: str
    effective_status: str
    is_overridden: bool
    current_status: str
    override_status: str | None
    override_note: str | None
    reviewed_by: str | None
    reviewed_at: datetime | None


class ReviewAttendanceResponse(BaseModel):
    date: date
    class_name: str
    total: int
    items: list[ReviewAttendanceItem]


class OverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    override_status: str
    note: str = Field(min_length=5)


class OverrideResponse(BaseModel):
    attendance_id: int
    original_status: str
    override_status: str
    effective_status: str
    note: str
    reviewed_by: str
    reviewed_at: datetime


class OverrideHistoryItem(BaseModel):
    id: int
    attendance_id: int
    previous_status: str | None
    new_status: str
    note: str
    reviewed_by: str
    timestamp: datetime


class OverrideHistoryResponse(BaseModel):
    attendance_id: int
    items: list[OverrideHistoryItem]


class MassOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    override_status: str
    note: str = Field(min_length=5)


class MassOverrideResponse(BaseModel):
    overridden: int
    skipped: int
    note: str
    reviewed_by: str
    reviewed_at: datetime


@router.get("/classes", response_model=ReviewClassesResponse)
def get_review_classes(
    academic_year_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_attendance")),
):
    if not academic_year_id:
        default_year = db.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).first()
        academic_year_id = default_year.id if default_year else None

    if academic_year_id:
        rows = (
            db.query(AcademicClass.id, AcademicClass.class_name)
            .filter(AcademicClass.academic_year_id == academic_year_id, AcademicClass.active.is_(True))
            .order_by(AcademicClass.class_name.asc())
            .all()
        )
        classes = [ReviewClassItem(id=row.id, name=row.class_name) for row in rows]
    else:
        rows = (
            db.query(Student.class_name)
            .filter(Student.class_name.isnot(None))
            .distinct()
            .order_by(Student.class_name.asc())
            .all()
        )
        classes = [ReviewClassItem(id=-1, name=row[0]) for row in rows if row[0] and row[0].strip()]
    return ReviewClassesResponse(classes=classes)


@router.get("/attendance", response_model=ReviewAttendanceResponse)
def get_review_attendance(
    date_value: date = Query(..., alias="date"),
    academic_year_id: int = Query(..., gt=0),
    academic_class_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_attendance")),
):
    academic_class = db.query(AcademicClass).filter(AcademicClass.id == academic_class_id).first()
    display_class_name = academic_class.class_name if academic_class else "Unknown Class"

    enrolled_student_ids = (
        db.query(StudentEnrollment.student_id)
        .filter(
            StudentEnrollment.academic_year_id == academic_year_id,
            StudentEnrollment.academic_class_id == academic_class_id
        )
        .all()
    )
    student_ids = [row[0] for row in enrolled_student_ids]

    if not student_ids:
        return ReviewAttendanceResponse(
            date=date_value,
            class_name=display_class_name,
            total=0,
            items=[],
        )

    stmt = (
        select(
            Attendance.id.label("attendance_id"),
            Attendance.student_id,
            Student.name.label("student_name"),
            Student.class_name,
            Attendance.date,
            Attendance.check_in,
            Attendance.check_out,
            Attendance.status.label("original_status"),
            AttendanceOverride.original_status.label("override_original_status"),
            AttendanceOverride.override_status,
            AttendanceOverride.note.label("override_note"),
            AttendanceOverride.reviewed_by,
            AttendanceOverride.reviewed_at,
        )
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .where(Attendance.date == date_value)
        .where(Attendance.student_id.in_(student_ids))
    )

    rows = db.execute(stmt.order_by(Student.name.asc())).all()

    items = [
        ReviewAttendanceItem(
            attendance_id=row.attendance_id,
            student_id=row.student_id,
            student_name=row.student_name,
            class_name=row.class_name,
            date=row.date,
            scan_in=_format_time(row.check_in),
            scan_out=_format_time(row.check_out),
            original_status=row.override_original_status or row.original_status,
            effective_status=row.override_status or row.original_status,
            is_overridden=row.override_status is not None,
            current_status=row.override_status or row.original_status,
            override_status=row.override_status,
            override_note=row.override_note,
            reviewed_by=row.reviewed_by,
            reviewed_at=row.reviewed_at,
        )
        for row in rows
    ]

    return ReviewAttendanceResponse(
        date=date_value,
        class_name=display_class_name,
        total=len(items),
        items=items,
    )


@router.post("/attendance/{attendance_id}/override", response_model=OverrideResponse)
def upsert_attendance_override(
    attendance_id: int,
    body: OverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_attendance")),
):
    override_status = body.override_status.strip()
    if override_status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"override_status must be one of {sorted(ALLOWED_STATUSES)}")

    note = body.note.strip()
    if len(note) < 5:
        raise HTTPException(status_code=400, detail="note must be at least 5 characters")

    reviewed_by = current_user.username

    attendance = db.query(Attendance).filter(Attendance.id == attendance_id).first()
    if attendance is None:
        raise HTTPException(status_code=404, detail="Attendance not found")
    ensure_period_open(db, attendance.date)

    now = datetime.utcnow()
    existing = db.query(AttendanceOverride).filter(AttendanceOverride.attendance_id == attendance_id).first()

    if existing is None:
        existing = AttendanceOverride(
            attendance_id=attendance_id,
            original_status=attendance.status,
            override_status=override_status,
            note=note,
            reviewed_by=reviewed_by,
            reviewed_at=now,
        )
        db.add(existing)
        db.flush()

        history_entry = AttendanceOverrideHistory(
            override_id=existing.id,
            attendance_id=attendance_id,
            previous_status=attendance.status,
            new_status=override_status,
            note=note,
            reviewed_by=reviewed_by,
            timestamp=now,
        )
        db.add(history_entry)
    else:
        history_entry = AttendanceOverrideHistory(
            override_id=existing.id,
            attendance_id=attendance_id,
            previous_status=existing.override_status,
            new_status=override_status,
            note=note,
            reviewed_by=reviewed_by,
            timestamp=now,
        )
        db.add(history_entry)

        existing.override_status = override_status
        existing.note = note
        existing.reviewed_by = reviewed_by
        existing.reviewed_at = now

    try:
        db.commit()
    except IntegrityError:
        db.rollback()

        existing = db.query(AttendanceOverride).filter(AttendanceOverride.attendance_id == attendance_id).first()
        if existing is None:
            raise HTTPException(status_code=409, detail="Override conflict detected. Please retry.")

        history_entry = AttendanceOverrideHistory(
            override_id=existing.id,
            attendance_id=attendance_id,
            previous_status=existing.override_status,
            new_status=override_status,
            note=note,
            reviewed_by=reviewed_by,
            timestamp=now,
        )
        db.add(history_entry)
        existing.override_status = override_status
        existing.note = note
        existing.reviewed_by = reviewed_by
        existing.reviewed_at = now
        db.commit()

    db.refresh(existing)

    return OverrideResponse(
        attendance_id=attendance_id,
        original_status=existing.original_status,
        override_status=existing.override_status,
        effective_status=existing.override_status,
        note=existing.note,
        reviewed_by=existing.reviewed_by,
        reviewed_at=existing.reviewed_at,
    )


@router.get("/attendance/{attendance_id}/history", response_model=OverrideHistoryResponse)
def get_override_history(
    attendance_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_attendance")),
):
    attendance_exists = db.query(Attendance.id).filter(Attendance.id == attendance_id).first()
    if attendance_exists is None:
        raise HTTPException(status_code=404, detail="Attendance not found")

    rows = (
        db.query(AttendanceOverrideHistory)
        .filter(AttendanceOverrideHistory.attendance_id == attendance_id)
        .order_by(AttendanceOverrideHistory.timestamp.desc(), AttendanceOverrideHistory.id.desc())
        .all()
    )

    items = [
        OverrideHistoryItem(
            id=row.id,
            attendance_id=row.attendance_id,
            previous_status=row.previous_status,
            new_status=row.new_status,
            note=row.note,
            reviewed_by=row.reviewed_by,
            timestamp=row.timestamp,
        )
        for row in rows
    ]

    return OverrideHistoryResponse(attendance_id=attendance_id, items=items)


@router.post("/attendance/mass-override-incomplete", response_model=MassOverrideResponse)
def mass_override_incomplete(
    body: MassOverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_attendance")),
):
    override_status = body.override_status.strip()
    if override_status not in {"on-time", "late"}:
        raise HTTPException(
            status_code=400,
            detail="override_status for mass override must be 'on-time' or 'late'",
        )

    note = body.note.strip()
    reviewed_by = current_user.username

    now = datetime.utcnow()

    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)

    candidates = (
        db.query(Attendance.id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "incomplete", Attendance.check_in.isnot(None))
        .all()
    )

    if not candidates:
        return MassOverrideResponse(
            overridden=0,
            skipped=0,
            note=note,
            reviewed_by=reviewed_by,
            reviewed_at=now,
        )

    attendance_ids = [row.id for row in candidates]
    for attendance_date in (
        db.query(Attendance.date).filter(Attendance.id.in_(attendance_ids)).distinct().all()
    ):
        ensure_period_open(db, attendance_date[0])

    # Fetch existing overrides for these attendances
    existing_overrides = (
        db.query(AttendanceOverride)
        .filter(AttendanceOverride.attendance_id.in_(attendance_ids))
        .all()
    )

    existing_by_attendance_id = {eo.attendance_id: eo for eo in existing_overrides}

    overridden_count = 0

    for att_id in attendance_ids:
        existing = existing_by_attendance_id.get(att_id)
        if existing is None:
            new_override = AttendanceOverride(
                attendance_id=att_id,
                original_status="incomplete",
                override_status=override_status,
                note=note,
                reviewed_by=reviewed_by,
                reviewed_at=now,
            )
            db.add(new_override)
            db.flush()

            history_entry = AttendanceOverrideHistory(
                override_id=new_override.id,
                attendance_id=att_id,
                previous_status="incomplete",
                new_status=override_status,
                note=note,
                reviewed_by=reviewed_by,
                timestamp=now,
            )
            db.add(history_entry)
        else:
            history_entry = AttendanceOverrideHistory(
                override_id=existing.id,
                attendance_id=att_id,
                previous_status=existing.override_status,
                new_status=override_status,
                note=note,
                reviewed_by=reviewed_by,
                timestamp=now,
            )
            db.add(history_entry)

            existing.override_status = override_status
            existing.note = note
            existing.reviewed_by = reviewed_by
            existing.reviewed_at = now

        overridden_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise_internal_error("The mass override could not be completed. Retry or contact the system administrator.", e)

    # skipped tracks records where check_in was null. The requirement is: "skipped: count of incomplete records where check_in was null".
    # Let's count them:
    skipped = (
        db.query(Attendance.id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(effective_status == "incomplete", Attendance.check_in.is_(None))
        .count()
    )
    
    return MassOverrideResponse(
        overridden=overridden_count,
        skipped=skipped,
        note=note,
        reviewed_by=reviewed_by,
        reviewed_at=now,
    )
