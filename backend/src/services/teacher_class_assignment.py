from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_

from models.teacher_class_assignment import TeacherClassAssignment, TeacherClassAssignmentAudit
from models.user import User
from models.academic_master import AcademicClass
from models.academic_year import AcademicYear
from models.subject import Subject
from services.attendance_corrections import safe_error


PERMITTED_ENTRY_ROLES = {"HOMEROOM_TEACHER", "ATTENDANCE_TEACHER", "SUBJECT_TEACHER"}
ALLOWED_CLASS_ROLES = {"HOMEROOM_TEACHER", "ATTENDANCE_TEACHER", "SUBJECT_TEACHER", "ASSISTANT_TEACHER"}


def serialize_assignment(assignment: TeacherClassAssignment) -> Dict[str, Any]:
    return {
        "id": assignment.id,
        "user_id": assignment.user_id,
        "username": assignment.user.username if assignment.user else None,
        "academic_year_id": assignment.academic_year_id,
        "academic_year_label": assignment.academic_year.label if assignment.academic_year else None,
        "academic_class_id": assignment.academic_class_id,
        "class_name": assignment.academic_class.class_name if assignment.academic_class else None,
        "class_role": assignment.class_role,
        "subject_id": assignment.subject_id,
        "subject_name": assignment.subject.name if assignment.subject else None,
        "effective_from": assignment.effective_from.isoformat() if assignment.effective_from else None,
        "effective_to": assignment.effective_to.isoformat() if assignment.effective_to else None,
        "active": assignment.active,
        "assigned_by": assignment.assigned_by,
        "created_at": assignment.created_at.isoformat() if assignment.created_at else None,
        "updated_at": assignment.updated_at.isoformat() if assignment.updated_at else None,
    }


def audit_teacher_assignment_event(
    db: Session,
    *,
    actor: str,
    action: str,
    assignment_id: Optional[int] = None,
    user_id: Optional[int] = None,
    academic_class_id: Optional[int] = None,
    academic_year_id: Optional[int] = None,
    target_date: Optional[date] = None,
    before_summary: Optional[Dict[str, Any]] = None,
    after_summary: Optional[Dict[str, Any]] = None,
    source_workflow: str = "TEACHER_CLASS_ASSIGNMENT",
) -> TeacherClassAssignmentAudit:
    audit = TeacherClassAssignmentAudit(
        assignment_id=assignment_id,
        user_id=user_id,
        academic_class_id=academic_class_id,
        academic_year_id=academic_year_id,
        target_date=target_date,
        action=action,
        actor=actor,
        before_summary=before_summary,
        after_summary=after_summary,
        source_workflow=source_workflow,
        metadata_version=1,
    )
    db.add(audit)
    return audit


def verify_teacher_class_access(
    db: Session,
    user: User,
    class_id: int,
    target_date: date,
    action: str = "view",
) -> TeacherClassAssignment:
    """Verify that user has authorization for class_id on target_date. Admin bypasses assignment checks."""
    if user.role == "admin":
        # Admin retains authorized global access. Look up active assignment if available, else None.
        assignment = (
            db.query(TeacherClassAssignment)
            .filter(
                TeacherClassAssignment.academic_class_id == class_id,
                TeacherClassAssignment.active.is_(True),
            )
            .first()
        )
        return assignment

    # Non-admin users (staff/teachers) require an active, date-effective assignment
    assignments = (
        db.query(TeacherClassAssignment)
        .filter(
            TeacherClassAssignment.user_id == user.id,
            TeacherClassAssignment.academic_class_id == class_id,
            TeacherClassAssignment.active.is_(True),
        )
        .all()
    )

    valid_assignment = None
    for assign in assignments:
        if assign.effective_from and target_date < assign.effective_from:
            continue
        if assign.effective_to and target_date > assign.effective_to:
            continue
        if action == "entry" and assign.class_role not in PERMITTED_ENTRY_ROLES:
            continue
        valid_assignment = assign
        break

    if not valid_assignment:
        audit_teacher_assignment_event(
            db,
            actor=user.username,
            action="REJECTED_SCOPED_ACCESS",
            user_id=user.id,
            academic_class_id=class_id,
            target_date=target_date,
            after_summary={"reason": "ATTENDANCE_CLASS_SCOPE_FORBIDDEN", "action": action},
        )
        db.commit()
        raise safe_error(
            403,
            "ATTENDANCE_CLASS_SCOPE_FORBIDDEN",
            "You are not assigned to manage attendance for this class on the specified date.",
        )

    return valid_assignment


def check_date_range_overlap(
    f1: Optional[date],
    t1: Optional[date],
    f2: Optional[date],
    t2: Optional[date],
) -> bool:
    """Check if date intervals [f1, t1] and [f2, t2] overlap."""
    if f1 and t2 and f1 > t2:
        return False
    if t1 and f2 and t1 < f2:
        return False
    return True


def create_assignment(
    db: Session,
    current_user: User,
    *,
    user_id: int,
    academic_year_id: int,
    academic_class_id: int,
    class_role: str,
    subject_id: Optional[int] = None,
    effective_from: Optional[date] = None,
    effective_to: Optional[date] = None,
) -> TeacherClassAssignment:
    # 1. User validation
    target_user = db.get(User, user_id)
    if not target_user or not target_user.is_active:
        raise safe_error(400, "USER_NOT_FOUND", "Target user was not found or is inactive.")

    # 2. Class & Academic Year validation
    ac_class = db.get(AcademicClass, academic_class_id)
    if not ac_class or not ac_class.active:
        raise safe_error(400, "CLASS_NOT_ACTIVE", "Archived or inactive classes cannot receive new assignments.")

    acad_year = db.get(AcademicYear, academic_year_id)
    if not acad_year or acad_year.status == "closed":
        raise safe_error(400, "ACADEMIC_YEAR_CLOSED", "Closed academic years cannot receive active assignments.")

    if ac_class.academic_year_id != academic_year_id:
        raise safe_error(400, "TEACHER_CLASS_ASSIGNMENT_REQUIRED", "Academic class does not match specified academic year.")

    # 3. Role & Subject validation
    if class_role not in ALLOWED_CLASS_ROLES:
        raise safe_error(400, "INVALID_CLASS_ROLE", f"class_role must be one of {sorted(ALLOWED_CLASS_ROLES)}")

    if subject_id:
        subj = db.get(Subject, subject_id)
        if not subj:
            raise safe_error(400, "SUBJECT_NOT_FOUND", "Subject not found.")

    # 4. Effective date range validation
    if effective_from and effective_to and effective_to < effective_from:
        raise safe_error(400, "INVALID_DATE_RANGE", "effective_to cannot be earlier than effective_from.")

    # 5. Overlap rejection
    existing_assignments = (
        db.query(TeacherClassAssignment)
        .filter(
            TeacherClassAssignment.user_id == user_id,
            TeacherClassAssignment.academic_class_id == academic_class_id,
            TeacherClassAssignment.class_role == class_role,
            TeacherClassAssignment.active.is_(True),
        )
        .all()
    )

    for exist in existing_assignments:
        if check_date_range_overlap(effective_from, effective_to, exist.effective_from, exist.effective_to):
            raise safe_error(
                400,
                "TEACHER_CLASS_ASSIGNMENT_OVERLAP",
                "An overlapping active assignment exists for the specified teacher, class, and role.",
            )

    assignment = TeacherClassAssignment(
        user_id=user_id,
        academic_year_id=academic_year_id,
        academic_class_id=academic_class_id,
        class_role=class_role,
        subject_id=subject_id,
        effective_from=effective_from,
        effective_to=effective_to,
        active=True,
        assigned_by=current_user.username,
    )
    db.add(assignment)
    db.flush()

    audit_teacher_assignment_event(
        db,
        actor=current_user.username,
        action="ASSIGNMENT_CREATED",
        assignment_id=assignment.id,
        user_id=user_id,
        academic_class_id=academic_class_id,
        academic_year_id=academic_year_id,
        after_summary=serialize_assignment(assignment),
    )

    db.commit()
    db.refresh(assignment)
    return assignment


def deactivate_assignment(
    db: Session,
    current_user: User,
    assignment_id: int,
) -> TeacherClassAssignment:
    assignment = db.get(TeacherClassAssignment, assignment_id)
    if not assignment:
        raise safe_error(404, "TEACHER_CLASS_ASSIGNMENT_NOT_FOUND", "Assignment not found.")

    if not assignment.active:
        return assignment

    before_summary = serialize_assignment(assignment)
    assignment.active = False
    after_summary = serialize_assignment(assignment)

    audit_teacher_assignment_event(
        db,
        actor=current_user.username,
        action="ASSIGNMENT_DEACTIVATED",
        assignment_id=assignment.id,
        user_id=assignment.user_id,
        academic_class_id=assignment.academic_class_id,
        academic_year_id=assignment.academic_year_id,
        before_summary=before_summary,
        after_summary=after_summary,
    )

    db.commit()
    db.refresh(assignment)
    return assignment


def reactivate_assignment(
    db: Session,
    current_user: User,
    assignment_id: int,
) -> TeacherClassAssignment:
    assignment = db.get(TeacherClassAssignment, assignment_id)
    if not assignment:
        raise safe_error(404, "TEACHER_CLASS_ASSIGNMENT_NOT_FOUND", "Assignment not found.")

    if assignment.active:
        return assignment

    # Re-validate class and year active state
    if not assignment.academic_class or not assignment.academic_class.active:
        raise safe_error(400, "CLASS_NOT_ACTIVE", "Cannot reactivate assignment for an archived class.")

    if not assignment.academic_year or assignment.academic_year.status == "closed":
        raise safe_error(400, "ACADEMIC_YEAR_CLOSED", "Cannot reactivate assignment for a closed academic year.")

    # Overlap check
    existing_assignments = (
        db.query(TeacherClassAssignment)
        .filter(
            TeacherClassAssignment.id != assignment.id,
            TeacherClassAssignment.user_id == assignment.user_id,
            TeacherClassAssignment.academic_class_id == assignment.academic_class_id,
            TeacherClassAssignment.class_role == assignment.class_role,
            TeacherClassAssignment.active.is_(True),
        )
        .all()
    )

    for exist in existing_assignments:
        if check_date_range_overlap(assignment.effective_from, assignment.effective_to, exist.effective_from, exist.effective_to):
            raise safe_error(
                400,
                "TEACHER_CLASS_ASSIGNMENT_OVERLAP",
                "Cannot reactivate assignment because an overlapping active assignment exists.",
            )

    before_summary = serialize_assignment(assignment)
    assignment.active = True
    after_summary = serialize_assignment(assignment)

    audit_teacher_assignment_event(
        db,
        actor=current_user.username,
        action="ASSIGNMENT_REACTIVATED",
        assignment_id=assignment.id,
        user_id=assignment.user_id,
        academic_class_id=assignment.academic_class_id,
        academic_year_id=assignment.academic_year_id,
        before_summary=before_summary,
        after_summary=after_summary,
    )

    db.commit()
    db.refresh(assignment)
    return assignment
