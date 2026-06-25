from sqlalchemy import Column, Integer, Date, Time, Interval, String, Boolean, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from core.database import Base

class Attendance(Base):
    __tablename__ = 'attendance'

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey('students.id'), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    check_in = Column(Time, nullable=True)
    check_out = Column(Time, nullable=True)
    late_duration = Column(Integer, nullable=False, default=0)
    late_source = Column(String, nullable=False, default="none")
    is_absent = Column(Boolean, nullable=False, default=False)
    overtime = Column(Interval, nullable=True)
    exception = Column(String, nullable=True)
    week = Column(String, nullable=True)
    status = Column(String, nullable=False, index=True)

    student = relationship("Student", back_populates="attendances")

    # Add composite unique constraint for UPSERT logic
    __table_args__ = (
        UniqueConstraint('student_id', 'date', name='_student_date_uc'),
        Index('idx_attendance_status_date', 'status', 'date'),
    )
