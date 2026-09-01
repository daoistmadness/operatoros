from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from core.database import Base


class AttendanceSubmissionDeadline(Base):
    """One explicit same-day local cutoff per academic year and jenjang."""

    __tablename__ = "attendance_submission_deadlines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False)
    cutoff_time = Column(String(5), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("academic_year_id", "jenjang_id", name="attendance_submission_deadlines_scope_uc"),
        CheckConstraint("cutoff_time GLOB '[0-9][0-9]:[0-9][0-9]' AND substr(cutoff_time, 1, 2) BETWEEN '00' AND '23' AND substr(cutoff_time, 4, 2) BETWEEN '00' AND '59'", name="ck_attendance_submission_deadline_time"),
    )
