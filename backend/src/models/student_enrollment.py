from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from core.database import Base
from models.student_master import StudentMaster  # noqa: F401 - registers FK target metadata
from models.academic_master import AcademicClass  # noqa: F401 - registers FK target metadata


class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Legacy attendance-machine identity. Academic enrollment is owned by
    # StudentMaster and must survive retirement/deletion of this optional link.
    student_id = Column(Integer, ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    academic_class_id = Column(Integer, ForeignKey("academic_classes.id", ondelete="RESTRICT"), nullable=True, index=True)
    class_name = Column(String, nullable=True)
    class_assigned = Column(Boolean, nullable=False, default=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    lifecycle_state = Column(String(16), nullable=False, default="ACTIVE", server_default="ACTIVE", index=True)
    lifecycle_effective_date = Column(Date, nullable=True)
    lifecycle_reason_code = Column(String(64), nullable=True)
    lifecycle_reason = Column(String(1000), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    academic_year = relationship("AcademicYear")
    jenjang = relationship("Jenjang")
    academic_class = relationship("AcademicClass")

    __table_args__ = (
        UniqueConstraint("student_id", "academic_year_id", name="_student_year_uc"),
        Index(
            "uq_student_master_academic_year",
            "student_master_id",
            "academic_year_id",
            unique=True,
            sqlite_where=student_master_id.isnot(None),
            postgresql_where=student_master_id.isnot(None),
        ),
        CheckConstraint("effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from", name="ck_student_enrollment_effective_dates"),
        CheckConstraint(
            "lifecycle_state IN ('DRAFT','ACTIVE','ENDED','WITHDRAWN','GRADUATED','VOIDED')",
            name="ck_student_enrollment_lifecycle_state",
        ),
    )


class StudentEnrollmentLifecycleAudit(Base):
    __tablename__ = "student_enrollment_lifecycle_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=False, index=True)
    prior_state = Column(String(16), nullable=False)
    new_state = Column(String(16), nullable=False)
    effective_date = Column(Date, nullable=False)
    actor = Column(String(255), nullable=False)
    reason_code = Column(String(64), nullable=False)
    source_workflow = Column(String(128), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
