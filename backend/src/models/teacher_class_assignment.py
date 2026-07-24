from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, String, func
from sqlalchemy.orm import relationship

from core.database import Base
from models.user import User  # noqa: F401
from models.academic_year import AcademicYear  # noqa: F401
from models.academic_master import AcademicClass  # noqa: F401
from models.subject import Subject  # noqa: F401


class TeacherClassAssignment(Base):
    __tablename__ = "teacher_class_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    academic_class_id = Column(Integer, ForeignKey("academic_classes.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_role = Column(String(64), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=True, index=True)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    assigned_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    user = relationship("User")
    academic_year = relationship("AcademicYear")
    academic_class = relationship("AcademicClass")
    subject = relationship("Subject")

    __table_args__ = (
        CheckConstraint(
            "effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from",
            name="ck_teacher_class_assignment_effective_dates",
        ),
        CheckConstraint(
            "class_role IN ('HOMEROOM_TEACHER', 'ATTENDANCE_TEACHER', 'SUBJECT_TEACHER', 'ASSISTANT_TEACHER')",
            name="ck_teacher_class_assignment_role",
        ),
        Index("idx_tca_user_class_active", "user_id", "academic_class_id", "active"),
        Index("idx_tca_class_year_dates", "academic_class_id", "academic_year_id", "effective_from", "effective_to"),
    )


class TeacherClassAssignmentAudit(Base):
    __tablename__ = "teacher_class_assignment_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assignment_id = Column(Integer, ForeignKey("teacher_class_assignments.id", ondelete="RESTRICT"), nullable=True, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    academic_class_id = Column(Integer, nullable=True, index=True)
    academic_year_id = Column(Integer, nullable=True, index=True)
    target_date = Column(Date, nullable=True)
    action = Column(String(64), nullable=False)
    actor = Column(String(255), nullable=False)
    before_summary = Column(JSON, nullable=True)
    after_summary = Column(JSON, nullable=True)
    source_workflow = Column(String(64), nullable=False, default="TEACHER_CLASS_ASSIGNMENT", server_default="TEACHER_CLASS_ASSIGNMENT")
    metadata_version = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
