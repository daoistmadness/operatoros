from dataclasses import dataclass

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.academic_config import AcademicTermConfig
from models.academic_year import AcademicYear
from models.attendance import Attendance
from models.jenjang_config import JenjangConfig
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentMaster


@dataclass(frozen=True)
class ReadinessStep:
    code: str
    name: str
    status: str
    requirement: str
    reason: str
    destination: str | None
    can_manage: bool
    responsibility: str | None = None


def _step_status(complete: bool, *, optional: bool = False) -> str:
    if complete:
        return "COMPLETE"
    return "OPTIONAL" if optional else "NOT_STARTED"


def build_setup_readiness(db: Session, *, role: str) -> tuple[str, list[ReadinessStep]]:
    can_manage = role == "admin"
    usable_year = (
        db.query(AcademicYear)
        .filter(
            AcademicYear.start_date <= AcademicYear.end_date,
            or_(AcademicYear.is_default.is_(True), AcademicYear.status == "active"),
        )
        .order_by(AcademicYear.is_default.desc(), AcademicYear.start_date.desc())
        .first()
    )
    has_students = db.query(StudentMaster.id).first() is not None or db.query(Student.id).first() is not None
    has_device_link = (
        db.query(StudentDeviceIdentity.id).filter(StudentDeviceIdentity.is_active.is_(True)).first() is not None
        or db.query(Attendance.id).first() is not None
    )
    has_enrollment = False
    has_terms = False
    if usable_year:
        has_enrollment = (
            db.query(StudentEnrollment.id)
            .filter(
                StudentEnrollment.academic_year_id == usable_year.id,
                StudentEnrollment.lifecycle_state == "ACTIVE",
                StudentEnrollment.class_assigned.is_(True),
                or_(
                    StudentEnrollment.academic_class_id.isnot(None),
                    StudentEnrollment.class_name.isnot(None) & (StudentEnrollment.class_name != ""),
                ),
            )
            .first()
            is not None
        )
        has_terms = (
            db.query(AcademicTermConfig.id)
            .filter(
                AcademicTermConfig.academic_year_id == usable_year.id,
                AcademicTermConfig.start_date <= AcademicTermConfig.end_date,
            )
            .first()
            is not None
        )
    has_attendance = db.query(Attendance.id).first() is not None
    has_cutoff_override = db.query(JenjangConfig.id).first() is not None
    responsibility = None if can_manage else "An administrator can complete this step."

    steps = [
        ReadinessStep(
            code="academic_year",
            name="Configure an academic year",
            status=_step_status(usable_year is not None),
            requirement="REQUIRED",
            reason="A valid active or default academic year anchors enrollment, grades, and reports.",
            destination="/academic-management" if can_manage else None,
            can_manage=can_manage,
            responsibility=responsibility,
        ),
        ReadinessStep(
            code="students",
            name="Add or import students",
            status=_step_status(has_students),
            requirement="REQUIRED",
            reason="Student records are required before class placement and attendance workflows can begin.",
            destination="/upload" if can_manage else None,
            can_manage=can_manage,
            responsibility=responsibility,
        ),
        ReadinessStep(
            code="enrollment",
            name="Assign students to active classes",
            status=_step_status(has_enrollment),
            requirement="REQUIRED",
            reason="At least one class-assigned enrollment in the usable academic year is required for current workflows.",
            destination="/enrollment" if can_manage else None,
            can_manage=can_manage,
            responsibility=responsibility,
        ),
        ReadinessStep(
            code="device_link",
            name="Link attendance-machine identities",
            status=_step_status(has_device_link),
            requirement="RECOMMENDED",
            reason="Academic enrollment is ready without biometrics; a device link is only required for attendance-machine matching.",
            destination="/students" if can_manage else None,
            can_manage=can_manage,
            responsibility=responsibility,
        ),
        ReadinessStep(
            code="academic_terms",
            name="Configure academic periods",
            status=_step_status(has_terms),
            requirement="WORKFLOW",
            reason="Academic periods are required for term-based grade and academic reporting workflows.",
            destination="/academic-management" if can_manage else None,
            can_manage=can_manage,
            responsibility=responsibility,
        ),
        ReadinessStep(
            code="attendance",
            name="Record or import attendance",
            status=_step_status(has_attendance),
            requirement="RECOMMENDED",
            reason="Attendance data enables daily review, dashboards, reports, and Management Analytics.",
            destination="/upload" if can_manage else "/attendance-review",
            can_manage=can_manage,
            responsibility=None if can_manage else "You can review attendance after an administrator imports it.",
        ),
        ReadinessStep(
            code="cutoff_jenjang",
            name="Review Cutoff Jenjang overrides",
            status=_step_status(has_cutoff_override, optional=True),
            requirement="OPTIONAL",
            reason="Automatic Jenjang cutoffs remain active when no override is configured.",
            destination="/config/jenjang",
            can_manage=can_manage,
            responsibility=None if can_manage else "You can review the automatic fallback but cannot change it.",
        ),
    ]

    required = steps[:3]
    completed_required = sum(step.status == "COMPLETE" for step in required)
    if completed_required == 0:
        overall = "FIRST_RUN"
    elif completed_required < len(required):
        overall = "SETUP_PARTIAL"
    elif any(step.status != "COMPLETE" for step in steps[3:6]):
        overall = "READY_WITH_RECOMMENDATIONS"
    else:
        overall = "OPERATIONALLY_READY"
    if not can_manage and completed_required < len(required):
        overall = "READ_ONLY_GUIDANCE"
    return overall, steps
