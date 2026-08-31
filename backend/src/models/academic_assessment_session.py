from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from core.database import Base


class AcademicAssessmentSession(Base):
    __tablename__ = "academic_assessment_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    term_number = Column(Integer, nullable=False)
    label = Column(String(120), nullable=False)
    assessment_date = Column(Date, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    academic_year = relationship("AcademicYear")

    __table_args__ = (
        CheckConstraint("term_number >= 1 AND term_number <= 4", name="ck_academic_assessment_term_number"),
    )
