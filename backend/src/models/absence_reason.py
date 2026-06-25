from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from core.database import Base


class AbsenceReason(Base):
    __tablename__ = "absence_reasons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    class_name = Column(String, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    sakit = Column(Integer, nullable=False, default=0)
    izin = Column(Integer, nullable=False, default=0)
    alfa = Column(Integer, nullable=False, default=0)
    note = Column(Text, nullable=True)
    entered_by = Column(String, nullable=False)
    entered_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    student = relationship("Student", backref="absence_reasons")

    __table_args__ = (
        UniqueConstraint("student_id", "month", "year", name="uq_absence_reasons_period"),
    )
