from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from core.database import Base


class AttendanceFollowUp(Base):
    __tablename__ = "attendance_follow_ups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exception_key = Column(String(255), nullable=False, index=True)
    exception_kind = Column(String(64), nullable=False, index=True)

    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=True, index=True)
    student_enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=True)
    attendance_correction_request_id = Column(Integer, ForeignKey("attendance_correction_requests.id", ondelete="RESTRICT"), nullable=True)
    early_departure_excuse_id = Column(Integer, ForeignKey("early_departure_excuses.id", ondelete="RESTRICT"), nullable=True)
    academic_class_id = Column(Integer, ForeignKey("academic_classes.id", ondelete="RESTRICT"), nullable=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=True)

    exception_date = Column(Date, nullable=True, index=True)
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)

    source_snapshot = Column(JSON, nullable=True)
    status = Column(String(32), nullable=False, default="OPEN", index=True)
    priority = Column(String(32), nullable=False, default="MEDIUM", index=True)

    assigned_to_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    acknowledged_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)

    resolved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution_code = Column(String(64), nullable=True)
    resolution_note = Column(Text, nullable=True)

    due_at = Column(DateTime, nullable=True, index=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    student_master = relationship("StudentMaster", foreign_keys=[student_master_id])
    student_enrollment = relationship("StudentEnrollment", foreign_keys=[student_enrollment_id])
    attendance = relationship("Attendance", foreign_keys=[attendance_id])
    academic_class = relationship("AcademicClass", foreign_keys=[academic_class_id])
    assigned_to_user = relationship("User", foreign_keys=[assigned_to_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    acknowledged_by_user = relationship("User", foreign_keys=[acknowledged_by_user_id])
    resolved_by_user = relationship("User", foreign_keys=[resolved_by_user_id])

    notes = relationship("AttendanceFollowUpNote", back_populates="follow_up", order_by="AttendanceFollowUpNote.created_at.asc()")

    __table_args__ = (
        Index("idx_followup_key_status", "exception_key", "status"),
        Index("idx_followup_class_date", "academic_class_id", "exception_date"),
        Index("idx_followup_assignee_status", "assigned_to_user_id", "status"),
    )


class AttendanceFollowUpNote(Base):
    __tablename__ = "attendance_follow_up_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    follow_up_id = Column(Integer, ForeignKey("attendance_follow_ups.id", ondelete="RESTRICT"), nullable=False, index=True)
    note_type = Column(String(32), nullable=False, default="INTERNAL_NOTE")
    body = Column(Text, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    supersedes_note_id = Column(Integer, ForeignKey("attendance_follow_up_notes.id", ondelete="RESTRICT"), nullable=True)

    follow_up = relationship("AttendanceFollowUp", back_populates="notes")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])


class AttendanceFollowUpAudit(Base):
    __tablename__ = "attendance_follow_up_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    follow_up_id = Column(Integer, ForeignKey("attendance_follow_ups.id", ondelete="RESTRICT"), nullable=True, index=True)
    actor = Column(String(255), nullable=False)
    action = Column(String(64), nullable=False)
    before_summary = Column(JSON, nullable=True)
    after_summary = Column(JSON, nullable=True)
    metadata_payload = Column(JSON, nullable=True)
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    schema_version = Column(Integer, nullable=False, default=1)
