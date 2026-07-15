import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer,
    JSON, String, UniqueConstraint, func,
)

from core.database import Base


def new_import_batch_id() -> str:
    return str(uuid.uuid4())


class AttendanceImportBatch(Base):
    __tablename__ = "attendance_import_batches"

    id = Column(String(36), primary_key=True, default=new_import_batch_id)
    filename = Column(String(255), nullable=False)
    checksum = Column(String(64), nullable=False, index=True)
    uploaded_by = Column(String(255), nullable=False)
    uploaded_at = Column(DateTime, nullable=False, server_default=func.now())
    status = Column(String(32), nullable=False, default="preview", server_default="preview")
    total_rows = Column(Integer, nullable=False, default=0, server_default="0")
    logical_rows = Column(Integer, nullable=False, default=0, server_default="0")
    new_records = Column(Integer, nullable=False, default=0, server_default="0")
    update_records = Column(Integer, nullable=False, default=0, server_default="0")
    unchanged_records = Column(Integer, nullable=False, default=0, server_default="0")
    conflict_records = Column(Integer, nullable=False, default=0, server_default="0")
    invalid_records = Column(Integer, nullable=False, default=0, server_default="0")
    new_students = Column(Integer, nullable=False, default=0, server_default="0")
    committed_at = Column(DateTime, nullable=True)
    commit_result = Column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('preview','committing','committed','failed','expired')",
            name="ck_attendance_import_batch_status",
        ),
    )


class AttendanceImportRow(Base):
    __tablename__ = "attendance_import_rows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(36), ForeignKey("attendance_import_batches.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_row = Column(Integer, nullable=True)
    student_identifier = Column(String(64), nullable=True)
    student_name = Column(String(255), nullable=True)
    attendance_date = Column(Date, nullable=True)
    existing_attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=True)
    classification = Column(String(32), nullable=False, index=True)
    existing_record = Column(JSON, nullable=True)
    proposed_change = Column(JSON, nullable=True)
    validation_error = Column(String(1000), nullable=True)
    warning = Column(String(1000), nullable=True)
    selected_for_commit = Column(Boolean, nullable=False, default=False, server_default="0")

    __table_args__ = (
        CheckConstraint(
            "classification IN ('NEW','UNCHANGED','DIFFERENCE','CONFLICT','INVALID')",
            name="ck_attendance_import_row_classification",
        ),
        UniqueConstraint("batch_id", "student_identifier", "attendance_date", name="uq_attendance_import_batch_key"),
        Index("ix_attendance_import_rows_batch_class", "batch_id", "classification"),
    )
