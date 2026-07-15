from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from core.database import Base
from models.student_master import StudentMaster  # noqa: F401 - registers FK target metadata


class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_name = Column(String, nullable=True)
    class_assigned = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    academic_year = relationship("AcademicYear")
    jenjang = relationship("Jenjang")

    __table_args__ = (
        UniqueConstraint("student_id", "academic_year_id", name="_student_year_uc"),
    )
