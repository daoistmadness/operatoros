from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.teacher_class_assignment import TeacherClassAssignment
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.teacher_class_assignment import (
    create_assignment,
    deactivate_assignment,
    reactivate_assignment,
    serialize_assignment,
    audit_teacher_assignment_event,
    safe_error,
    ALLOWED_CLASS_ROLES,
    check_date_range_overlap,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


class AssignmentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: int = Field(gt=0)
    academic_year_id: int = Field(gt=0)
    academic_class_id: int = Field(gt=0)
    class_role: str
    subject_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class AssignmentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_role: Optional[str] = None
    subject_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    active: Optional[bool] = None


@router.get("")
def list_assignments(
    user_id: Optional[int] = Query(None),
    academic_year_id: Optional[int] = Query(None),
    academic_class_id: Optional[int] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Non-admin users without manage_teacher_class_assignments can only view their own assignments
    if current_user.role != "admin" and "manage_teacher_class_assignments" not in current_user.role:
        if user_id is not None and user_id != current_user.id:
            raise safe_error(403, "ATTENDANCE_CLASS_SCOPE_FORBIDDEN", "Insufficient permissions to view other users' assignments.")
        user_id = current_user.id

    query = db.query(TeacherClassAssignment)

    if user_id is not None:
        query = query.filter(TeacherClassAssignment.user_id == user_id)
    if academic_year_id is not None:
        query = query.filter(TeacherClassAssignment.academic_year_id == academic_year_id)
    if academic_class_id is not None:
        query = query.filter(TeacherClassAssignment.academic_class_id == academic_class_id)
    if active_only:
        query = query.filter(TeacherClassAssignment.active.is_(True))

    assignments = query.order_by(TeacherClassAssignment.id.desc()).all()
    return [serialize_assignment(row) for row in assignments]


@router.post("")
def post_create_assignment(
    body: AssignmentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_teacher_class_assignments")),
):
    assignment = create_assignment(
        db,
        current_user,
        user_id=body.user_id,
        academic_year_id=body.academic_year_id,
        academic_class_id=body.academic_class_id,
        class_role=body.class_role.strip(),
        subject_id=body.subject_id,
        effective_from=body.effective_from,
        effective_to=body.effective_to,
    )
    return serialize_assignment(assignment)


@router.patch("/{assignment_id}")
def update_assignment_endpoint(
    assignment_id: int,
    body: AssignmentUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_teacher_class_assignments")),
):
    assignment = db.get(TeacherClassAssignment, assignment_id)
    if not assignment:
        raise safe_error(404, "TEACHER_CLASS_ASSIGNMENT_NOT_FOUND", "Assignment not found.")

    before_summary = serialize_assignment(assignment)

    new_role = body.class_role.strip() if body.class_role else assignment.class_role
    if new_role not in ALLOWED_CLASS_ROLES:
        raise safe_error(400, "INVALID_CLASS_ROLE", f"class_role must be one of {sorted(ALLOWED_CLASS_ROLES)}")

    new_from = body.effective_from if body.effective_from is not None else assignment.effective_from
    new_to = body.effective_to if body.effective_to is not None else assignment.effective_to

    if new_from and new_to and new_to < new_from:
        raise safe_error(400, "INVALID_DATE_RANGE", "effective_to cannot be earlier than effective_from.")

    # If role or dates changed, re-check overlap
    if (new_role != assignment.class_role or new_from != assignment.effective_from or new_to != assignment.effective_to):
        existing_assignments = (
            db.query(TeacherClassAssignment)
            .filter(
                TeacherClassAssignment.id != assignment.id,
                TeacherClassAssignment.user_id == assignment.user_id,
                TeacherClassAssignment.academic_class_id == assignment.academic_class_id,
                TeacherClassAssignment.class_role == new_role,
                TeacherClassAssignment.active.is_(True),
            )
            .all()
        )
        for exist in existing_assignments:
            if check_date_range_overlap(new_from, new_to, exist.effective_from, exist.effective_to):
                raise safe_error(
                    400,
                    "TEACHER_CLASS_ASSIGNMENT_OVERLAP",
                    "An overlapping active assignment exists for the specified teacher, class, and role.",
                )

    assignment.class_role = new_role
    if body.subject_id is not None:
        assignment.subject_id = body.subject_id
    assignment.effective_from = new_from
    assignment.effective_to = new_to
    if body.active is not None:
        assignment.active = body.active

    after_summary = serialize_assignment(assignment)

    audit_teacher_assignment_event(
        db,
        actor=current_user.username,
        action="ASSIGNMENT_MODIFIED",
        assignment_id=assignment.id,
        user_id=assignment.user_id,
        academic_class_id=assignment.academic_class_id,
        academic_year_id=assignment.academic_year_id,
        before_summary=before_summary,
        after_summary=after_summary,
    )

    db.commit()
    db.refresh(assignment)
    return serialize_assignment(assignment)


@router.post("/{assignment_id}/deactivate")
def post_deactivate_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_teacher_class_assignments")),
):
    assignment = deactivate_assignment(db, current_user, assignment_id)
    return serialize_assignment(assignment)


@router.post("/{assignment_id}/reactivate")
def post_reactivate_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("manage_teacher_class_assignments")),
):
    assignment = reactivate_assignment(db, current_user, assignment_id)
    return serialize_assignment(assignment)
