from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, func
from sqlalchemy.orm import relationship

from core.database import Base


class StudentSubjectGrade(Base):
    __tablename__ = "student_subject_grades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    component_id = Column(Integer, ForeignKey("assessment_components.id", ondelete="RESTRICT"), nullable=False, index=True)
    assessment_session_id = Column(Integer, ForeignKey("academic_assessment_sessions.id", ondelete="RESTRICT"), nullable=True, index=True)
    score = Column(Float, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    enrollment = relationship("StudentEnrollment")
    subject = relationship("Subject")
    component = relationship("AssessmentComponent")
    assessment_session = relationship("AcademicAssessmentSession")

    __table_args__ = (
        Index(
            "uq_student_subject_grades_legacy_slot",
            "enrollment_id", "subject_id", "component_id",
            unique=True,
            sqlite_where=(assessment_session_id.is_(None)),
        ),
        Index(
            "uq_student_subject_grades_session_slot",
            "enrollment_id", "subject_id", "component_id", "assessment_session_id",
            unique=True,
            sqlite_where=(assessment_session_id.is_not(None)),
        ),
    )
