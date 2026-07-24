from datetime import date, datetime, time
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from core.database import get_db
from models.academic_master import AcademicClass
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride, AttendanceCorrectionRequest, AttendancePeriod
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.teacher_class_assignment import TeacherClassAssignment
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.teacher_class_assignment import (
    verify_teacher_class_access,
    audit_teacher_assignment_event,
    safe_error,
)
from services.attendance_corrections import ACTIVE_REQUEST_STATES

router = APIRouter(dependencies=[Depends(get_current_user)])

ALLOWED_ATTENDANCE_STATUSES = {"on-time", "late", "incomplete", "absent", "sakit", "izin", "alfa"}


class ClassAttendanceEntryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_id: int = Field(gt=0)
    status: str
    check_in: Optional[time] = None
    check_out: Optional[time] = None
    notes: Optional[str] = None


class BulkAttendanceEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: List[ClassAttendanceEntryItem] = Field(min_length=1)


@router.get("/classes/assigned")
def get_assigned_classes(
    academic_year_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return active classes assigned to the current user (or all active classes for admin)."""
    if not academic_year_id:
        default_year = db.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).first()
        academic_year_id = default_year.id if default_year else None

    if current_user.role == "admin":
        query = db.query(AcademicClass).filter(AcademicClass.active.is_(True))
        if academic_year_id:
            query = query.filter(AcademicClass.academic_year_id == academic_year_id)
        classes = query.order_by(AcademicClass.class_name.asc()).all()
        return {
            "classes": [
                {
                    "id": c.id,
                    "class_name": c.class_name,
                    "academic_year_id": c.academic_year_id,
                    "role_in_class": "ADMINISTRATOR",
                }
                for c in classes
            ]
        }

    # For staff / teachers: return assigned classes
    query = (
        db.query(AcademicClass, TeacherClassAssignment.class_role)
        .join(TeacherClassAssignment, TeacherClassAssignment.academic_class_id == AcademicClass.id)
        .filter(
            TeacherClassAssignment.user_id == current_user.id,
            TeacherClassAssignment.active.is_(True),
            AcademicClass.active.is_(True),
        )
    )
    if academic_year_id:
        query = query.filter(AcademicClass.academic_year_id == academic_year_id)

    rows = query.order_by(AcademicClass.class_name.asc()).all()

    # Deduplicate class_ids if multiple roles exist
    seen = set()
    result = []
    for ac_class, role in rows:
        if ac_class.id not in seen:
            seen.add(ac_class.id)
            result.append(
                {
                    "id": ac_class.id,
                    "class_name": ac_class.class_name,
                    "academic_year_id": ac_class.academic_year_id,
                    "role_in_class": role,
                }
            )
    return {"classes": result}


@router.get("/classes/{class_id}/dates/{date_val}")
def get_class_date_attendance(
    class_id: int,
    date_val: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve date-effective class roster and attendance status for target class and date."""
    verify_teacher_class_access(db, current_user, class_id, date_val, action="view")

    ac_class = db.get(AcademicClass, class_id)
    if not ac_class or not ac_class.active:
        raise safe_error(400, "CLASS_NOT_ACTIVE", "Class is inactive or archived.")

    # Check period finalization
    period = db.query(AttendancePeriod).filter_by(attendance_date=date_val).first()
    is_finalized = period is not None and period.status == "FINALIZED"

    # Query effective enrollments on target date
    enrollments = (
        db.query(StudentEnrollment, Student)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .filter(
            StudentEnrollment.academic_class_id == class_id,
            StudentEnrollment.lifecycle_state == "ACTIVE",
        )
        .all()
    )

    effective_students = []
    for enr, std in enrollments:
        if enr.effective_from and date_val < enr.effective_from:
            continue
        if enr.effective_to and date_val > enr.effective_to:
            continue
        effective_students.append((enr, std))

    effective_students.sort(key=lambda pair: pair[1].name)
    student_ids = [std.id for _, std in effective_students]

    # Query raw attendance & overrides
    attendance_map = {}
    override_map = {}
    pending_correction_map = {}

    if student_ids:
        att_rows = (
            db.query(Attendance)
            .filter(Attendance.date == date_val, Attendance.student_id.in_(student_ids))
            .all()
        )
        for att in att_rows:
            attendance_map[att.student_id] = att

        att_ids = [att.id for att in att_rows]
        if att_ids:
            ovr_rows = (
                db.query(AttendanceOverride)
                .filter(AttendanceOverride.attendance_id.in_(att_ids))
                .all()
            )
            for ovr in ovr_rows:
                override_map[ovr.attendance_id] = ovr

            pending_reqs = (
                db.query(AttendanceCorrectionRequest)
                .filter(
                    AttendanceCorrectionRequest.attendance_id.in_(att_ids),
                    AttendanceCorrectionRequest.state.in_(ACTIVE_REQUEST_STATES),
                )
                .all()
            )
            for req in pending_reqs:
                pending_correction_map[req.attendance_id] = req

    items = []
    for enr, std in effective_students:
        att = attendance_map.get(std.id)
        ovr = override_map.get(att.id) if att else None
        pending_req = pending_correction_map.get(att.id) if att else None

        scan_in_str = att.check_in.strftime("%H:%M") if (att and att.check_in) else None
        scan_out_str = att.check_out.strftime("%H:%M") if (att and att.check_out) else None

        raw_status = att.status if att else "unrecorded"
        effective_status = ovr.override_status if ovr else raw_status

        items.append(
            {
                "student_id": std.id,
                "student_name": std.name,
                "attendance_id": att.id if att else None,
                "raw_status": raw_status,
                "effective_status": effective_status,
                "is_overridden": ovr is not None,
                "scan_in": scan_in_str,
                "scan_out": scan_out_str,
                "is_absent": att.is_absent if att else False,
                "pending_correction": pending_req is not None,
                "correction_request_id": pending_req.id if pending_req else None,
            }
        )

    return {
        "class_id": class_id,
        "class_name": ac_class.class_name,
        "date": date_val.isoformat(),
        "is_finalized": is_finalized,
        "total_enrolled": len(items),
        "items": items,
    }


@router.post("/classes/{class_id}/dates/{date_val}/entries")
def post_class_date_attendance_entries(
    class_id: int,
    date_val: date,
    body: BulkAttendanceEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit class/date attendance transactionally for authorized class & date."""
    verify_teacher_class_access(db, current_user, class_id, date_val, action="entry")

    ac_class = db.get(AcademicClass, class_id)
    if not ac_class or not ac_class.active:
        raise safe_error(400, "CLASS_NOT_ACTIVE", "Class is inactive or archived.")

    # 1. Check period finalization
    period = db.query(AttendancePeriod).filter_by(attendance_date=date_val).first()
    if period and period.status == "FINALIZED":
        raise safe_error(400, "ATTENDANCE_DATE_FINALIZED", "Attendance for target date is finalized and locked.")

    # 2. Resolve effective student IDs
    enrollments = (
        db.query(StudentEnrollment)
        .filter(
            StudentEnrollment.academic_class_id == class_id,
            StudentEnrollment.lifecycle_state == "ACTIVE",
        )
        .all()
    )
    effective_student_ids = set()
    for enr in enrollments:
        if enr.effective_from and date_val < enr.effective_from:
            continue
        if enr.effective_to and date_val > enr.effective_to:
            continue
        effective_student_ids.add(enr.student_id)

    # 3. Validate entries in body
    seen_students = set()
    for item in body.entries:
        if item.student_id in seen_students:
            raise safe_error(400, "ATTENDANCE_ENTRY_DUPLICATE", f"Duplicate entry for student ID {item.student_id}.")
        seen_students.add(item.student_id)

        if item.student_id not in effective_student_ids:
            raise safe_error(
                400,
                "ATTENDANCE_ENROLLMENT_NOT_EFFECTIVE",
                f"Student ID {item.student_id} is not effectively enrolled in class on target date.",
            )

        status_clean = item.status.strip().lower()
        if status_clean not in ALLOWED_ATTENDANCE_STATUSES:
            raise safe_error(
                400,
                "INVALID_ATTENDANCE_STATUS",
                f"Status '{item.status}' is invalid. Allowed: {sorted(ALLOWED_ATTENDANCE_STATUSES)}",
            )

    # 4. Atomic transaction processing
    try:
        updated_count = 0
        created_count = 0

        for item in body.entries:
            status_clean = item.status.strip().lower()
            is_absent = status_clean in {"absent", "sakit", "izin", "alfa"}

            att = (
                db.query(Attendance)
                .filter(Attendance.student_id == item.student_id, Attendance.date == date_val)
                .first()
            )

            if att is None:
                att = Attendance(
                    student_id=item.student_id,
                    date=date_val,
                    status=status_clean,
                    check_in=item.check_in,
                    check_out=item.check_out,
                    is_absent=is_absent,
                    late_source="manual" if status_clean == "late" else "none",
                )
                db.add(att)
                created_count += 1
            else:
                att.status = status_clean
                if item.check_in is not None:
                    att.check_in = item.check_in
                if item.check_out is not None:
                    att.check_out = item.check_out
                att.is_absent = is_absent
                if status_clean == "late":
                    att.late_source = "manual"
                updated_count += 1

        db.flush()

        audit_teacher_assignment_event(
            db,
            actor=current_user.username,
            action="BULK_ATTENDANCE_SUBMITTED",
            academic_class_id=class_id,
            academic_year_id=ac_class.academic_year_id,
            target_date=date_val,
            after_summary={
                "created": created_count,
                "updated": updated_count,
                "total": len(body.entries),
            },
        )

        db.commit()
    except Exception as exc:
        db.rollback()
        if isinstance(exc, HTTPException):
            raise exc
        raise safe_error(
            400,
            "ATTENDANCE_BULK_TRANSACTION_FAILED",
            "Failed to save attendance entries transactionally. Operation rolled back.",
        )

    return {
        "class_id": class_id,
        "date": date_val.isoformat(),
        "total_submitted": len(body.entries),
        "created": created_count,
        "updated": updated_count,
        "submitted_by": current_user.username,
    }
