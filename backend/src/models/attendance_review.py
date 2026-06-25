from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from core.database import Base


class AttendanceOverride(Base):
    __tablename__ = "attendance_overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    original_status = Column(String, nullable=False)
    override_status = Column(String, nullable=False, index=True)
    note = Column(Text, nullable=False)
    reviewed_by = Column(String, nullable=False)
    reviewed_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    attendance = relationship("Attendance")
    history_entries = relationship(
        "AttendanceOverrideHistory",
        back_populates="override",
    )

    __table_args__ = (
        Index("idx_attendance_overrides_effective", "override_status", "reviewed_at"),
    )


class AttendanceOverrideHistory(Base):
    __tablename__ = "attendance_override_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    override_id = Column(Integer, ForeignKey("attendance_overrides.id", ondelete="RESTRICT"), nullable=False, index=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=False, index=True)
    previous_status = Column(String, nullable=True)
    new_status = Column(String, nullable=False)
    note = Column(Text, nullable=False)
    reviewed_by = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    override = relationship("AttendanceOverride", back_populates="history_entries")

    __table_args__ = (
        Index("idx_attendance_override_history_attendance", "attendance_id", "timestamp"),
    )
