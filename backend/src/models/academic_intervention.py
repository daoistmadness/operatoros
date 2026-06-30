from sqlalchemy import CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from core.database import Base


class AcademicIntervention(Base):
    __tablename__ = "academic_interventions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False, index=True)
    assessment_type = Column(String, nullable=True)
    term = Column(String, nullable=True, index=True)
    class_name = Column(String, nullable=True)
    student_name = Column(String, nullable=False)
    subject_name = Column(String, nullable=False)
    effective_threshold = Column(Float, nullable=False)
    threshold_source = Column(String, nullable=False)
    current_average = Column(Float, nullable=True)
    status = Column(String, nullable=False, default="open", index=True)
    priority = Column(String, nullable=False, default="medium", index=True)
    owner_name = Column(String, nullable=True)
    planned_action = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    follow_up_date = Column(Date, nullable=True)
    outcome = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    resolved_at = Column(DateTime, nullable=True)

    student = relationship("Student")
    enrollment = relationship("StudentEnrollment")
    academic_year = relationship("AcademicYear")
    jenjang = relationship("Jenjang")
    subject = relationship("Subject")

    __table_args__ = (
        CheckConstraint("assessment_type IS NULL OR assessment_type IN ('sumatif', 'formatif', 'overall')", name="ck_intervention_assessment_type"),
        CheckConstraint("effective_threshold >= 0.0 AND effective_threshold <= 100.0", name="ck_intervention_threshold_range"),
        CheckConstraint("current_average IS NULL OR (current_average >= 0.0 AND current_average <= 100.0)", name="ck_intervention_average_range"),
        CheckConstraint("status IN ('open', 'in_progress', 'monitoring', 'resolved', 'closed')", name="ck_intervention_status"),
        CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name="ck_intervention_priority"),
    )
