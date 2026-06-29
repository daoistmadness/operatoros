from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import relationship

from core.database import Base


class StudentSubjectGrade(Base):
    __tablename__ = "student_subject_grades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    component_id = Column(Integer, ForeignKey("assessment_components.id", ondelete="RESTRICT"), nullable=False, index=True)
    score = Column(Float, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    enrollment = relationship("StudentEnrollment")
    subject = relationship("Subject")
    component = relationship("AssessmentComponent")

    __table_args__ = (
        UniqueConstraint("enrollment_id", "subject_id", "component_id", name="_grade_component_uc"),
    )
