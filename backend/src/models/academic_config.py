from sqlalchemy import CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from core.database import Base


class KkmThreshold(Base):
    __tablename__ = "kkm_thresholds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=True, index=True)
    assessment_type = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    academic_year = relationship("AcademicYear")
    jenjang = relationship("Jenjang")
    subject = relationship("Subject")

    __table_args__ = (
        CheckConstraint("assessment_type IN ('sumatif', 'formatif', 'overall')", name="ck_kkm_assessment_type"),
        CheckConstraint("threshold >= 0.0 AND threshold <= 100.0", name="ck_kkm_threshold_range"),
        UniqueConstraint(
            "academic_year_id",
            "jenjang_id",
            "subject_id",
            "assessment_type",
            name="_kkm_context_uc",
        ),
    )


class AcademicTermConfig(Base):
    __tablename__ = "academic_term_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    term_number = Column(Integer, nullable=False)
    label = Column(String, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    academic_year = relationship("AcademicYear")

    __table_args__ = (
        CheckConstraint("term_number >= 1 AND term_number <= 4", name="ck_academic_term_number"),
        CheckConstraint("start_date <= end_date", name="ck_academic_term_date_order"),
        UniqueConstraint("academic_year_id", "term_number", name="_academic_term_uc"),
    )
