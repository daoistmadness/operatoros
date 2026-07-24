from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import relationship

from core.database import Base


class AttendanceOverride(Base):
    __tablename__ = "attendance_overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True)
    original_status = Column(String, nullable=False)
    override_status = Column(String, nullable=False, index=True)
    override_check_in = Column(Time, nullable=True)
    override_check_out = Column(Time, nullable=True)
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
    previous_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)
    note = Column(Text, nullable=False)
    reviewed_by = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    override = relationship("AttendanceOverride", back_populates="history_entries")

    __table_args__ = (
        Index("idx_attendance_override_history_attendance", "attendance_id", "timestamp"),
    )


class AttendanceCorrectionRequest(Base):
    __tablename__ = "attendance_correction_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=False, index=True)
    active_key = Column(String(96), nullable=True, unique=True)
    original_snapshot = Column(JSON, nullable=False)
    original_fingerprint = Column(String(64), nullable=False)
    proposed_status = Column(String, nullable=False)
    proposed_check_in = Column(Time, nullable=True)
    proposed_check_out = Column(Time, nullable=True)
    reason_code = Column(String(64), nullable=False)
    explanation = Column(Text, nullable=False)
    requester = Column(String(255), nullable=False, index=True)
    submitted_at = Column(DateTime, nullable=True)
    state = Column(String(32), nullable=False, default="DRAFT", server_default="DRAFT", index=True)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    approver = Column(String(255), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    resulting_override_id = Column(Integer, ForeignKey("attendance_overrides.id", ondelete="RESTRICT"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class AttendanceCorrectionAudit(Base):
    __tablename__ = "attendance_correction_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(Integer, ForeignKey("attendance_correction_requests.id", ondelete="RESTRICT"), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    prior_state = Column(String(32), nullable=True)
    new_state = Column(String(32), nullable=False)
    actor = Column(String(255), nullable=False)
    effective_date = Column(Date, nullable=False)
    reason_code = Column(String(64), nullable=True)
    explanation_summary = Column(String(255), nullable=True)
    source_workflow = Column(String(64), nullable=False, default="ATTENDANCE_CORRECTION")
    metadata_version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


class AttendancePeriod(Base):
    __tablename__ = "attendance_periods"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attendance_date = Column(Date, nullable=False, unique=True, index=True)
    status = Column(String(16), nullable=False, default="OPEN", server_default="OPEN")
    finalized_by = Column(String(255), nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    reason = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    reopened_by = Column(String(255), nullable=True)
    reopened_at = Column(DateTime, nullable=True)


class AttendancePeriodAudit(Base):
    __tablename__ = "attendance_period_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    period_id = Column(Integer, ForeignKey("attendance_periods.id", ondelete="RESTRICT"), nullable=False, index=True)
    action = Column(String(32), nullable=False)
    prior_status = Column(String(16), nullable=False)
    new_status = Column(String(16), nullable=False)
    actor = Column(String(255), nullable=False)
    reason = Column(Text, nullable=False)
    prior_version = Column(Integer, nullable=False)
    new_version = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
