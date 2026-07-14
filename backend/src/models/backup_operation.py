from datetime import UTC, datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Float, Integer, String, Text

from core.database import Base


class BackupSchedulerConfig(Base):
    __tablename__ = "backup_scheduler_config"

    id = Column(Integer, primary_key=True, default=1)
    enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    schedule_type = Column(String(16), nullable=False, default="daily", server_default="daily")
    interval_minutes = Column(Integer, nullable=False, default=1440, server_default="1440")
    hour_utc = Column(Integer, nullable=False, default=1, server_default="1")
    minute_utc = Column(Integer, nullable=False, default=0, server_default="0")
    weekday_utc = Column(Integer, nullable=False, default=0, server_default="0")
    keep_daily = Column(Integer, nullable=False, default=7, server_default="7")
    keep_weekly = Column(Integer, nullable=False, default=4, server_default="4")
    keep_monthly = Column(Integer, nullable=False, default=12, server_default="12")
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))

    __table_args__ = (
        CheckConstraint("schedule_type IN ('daily','weekly','interval')", name="ck_backup_schedule_type"),
        CheckConstraint("interval_minutes >= 1", name="ck_backup_interval"),
        CheckConstraint("hour_utc BETWEEN 0 AND 23", name="ck_backup_hour"),
        CheckConstraint("minute_utc BETWEEN 0 AND 59", name="ck_backup_minute"),
        CheckConstraint("weekday_utc BETWEEN 0 AND 6", name="ck_backup_weekday"),
        CheckConstraint("keep_daily >= 0 AND keep_weekly >= 0 AND keep_monthly >= 0", name="ck_backup_retention_tiers"),
    )


class BackupExecutionHistory(Base):
    __tablename__ = "backup_execution_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    backup_filename = Column(String(255), nullable=True, index=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC), index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Float, nullable=True)
    status = Column(String(16), nullable=False, default="PENDING", index=True)
    error_message = Column(Text, nullable=True)
    trigger_type = Column(String(16), nullable=False, index=True)
    size_bytes = Column(Integer, nullable=True)
    checksum = Column(String(64), nullable=True)
    integrity_verified = Column(Boolean, nullable=False, default=False, server_default="0")
    removed_backups_json = Column(Text, nullable=False, default="[]", server_default="[]")

    __table_args__ = (
        CheckConstraint("status IN ('PENDING','RUNNING','SUCCESS','FAILED','CANCELLED')", name="ck_backup_execution_status"),
        CheckConstraint("trigger_type IN ('MANUAL','SCHEDULED')", name="ck_backup_trigger_type"),
    )
