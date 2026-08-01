"""Employee master data and auditable staff-import provenance models."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from core.database import Base


def new_staff_id() -> str:
    return str(uuid.uuid4())


class StaffMember(Base):
    __tablename__ = "staff_members"

    id = Column(String(36), primary_key=True, default=new_staff_id)
    source_staff_id = Column(String(64), nullable=True, index=True)
    full_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    employment_status = Column(String(32), nullable=False, default="UNKNOWN", server_default="UNKNOWN", index=True)
    birth_place = Column(String(255), nullable=True)
    birth_date = Column(Date, nullable=True)
    job_title_raw = Column(String(255), nullable=True)
    job_title_normalized = Column(String(255), nullable=True)
    employment_start_date = Column(Date, nullable=True)
    dapodik_status_raw = Column(String(64), nullable=True)
    dapodik_status_normalized = Column(String(64), nullable=False, default="UNKNOWN", server_default="UNKNOWN")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    identifiers = relationship("StaffIdentifier", back_populates="staff_member", cascade="all, delete-orphan")
    contact = relationship("StaffContactDetail", back_populates="staff_member", uselist=False, cascade="all, delete-orphan")
    import_rows = relationship("StaffImportRow", back_populates="staff_member")

    __table_args__ = (
        CheckConstraint("employment_status IN ('ACTIVE','FORMER','UNKNOWN','REVIEW_REQUIRED')", name="ck_staff_employment_status"),
        CheckConstraint("dapodik_status_normalized IN ('ACTIVE','NOT_REGISTERED','SUBMITTED_OR_COMPLETED','UNKNOWN')", name="ck_staff_dapodik_status"),
    )

class StaffIdentifier(Base):
    __tablename__ = "staff_identifiers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    staff_member_id = Column(String(36), ForeignKey("staff_members.id", ondelete="RESTRICT"), nullable=False, index=True)
    identifier_type = Column(String(32), nullable=False)
    raw_value = Column(Text, nullable=True)
    normalized_value = Column(Text, nullable=True, index=True)
    verification_status = Column(String(32), nullable=False, default="UNVERIFIED", server_default="UNVERIFIED")
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    staff_member = relationship("StaffMember", back_populates="identifiers")

    __table_args__ = (
        CheckConstraint("identifier_type IN ('INTERNAL_STAFF_ID','NIP','NUPTK','NIK')", name="ck_staff_identifier_type"),
        CheckConstraint("verification_status IN ('UNVERIFIED','VALIDATED','REVIEW_REQUIRED')", name="ck_staff_identifier_verification"),
        Index("idx_staff_identifier_lookup", "identifier_type", "normalized_value"),
    )


class StaffContactDetail(Base):
    __tablename__ = "staff_contact_details"

    id = Column(Integer, primary_key=True, autoincrement=True)
    staff_member_id = Column(String(36), ForeignKey("staff_members.id", ondelete="RESTRICT"), nullable=False, unique=True)
    address = Column(Text, nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    staff_member = relationship("StaffMember", back_populates="contact")


class StaffImportBatch(Base):
    __tablename__ = "staff_import_batches"

    id = Column(String(36), primary_key=True, default=new_staff_id)
    source_filename = Column(String(255), nullable=False)
    source_sheet = Column(String(255), nullable=False)
    file_sha256 = Column(String(64), nullable=False, index=True)
    imported_at = Column(DateTime, nullable=False, server_default=func.now())
    imported_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    actor = Column(String(255), nullable=False, default="staff-import-cli", server_default="staff-import-cli")
    total_rows = Column(Integer, nullable=False, default=0, server_default="0")
    active_count = Column(Integer, nullable=False, default=0, server_default="0")
    former_count = Column(Integer, nullable=False, default=0, server_default="0")
    review_count = Column(Integer, nullable=False, default=0, server_default="0")
    issue_count = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(32), nullable=False, default="APPLIED", server_default="APPLIED")
    notes = Column(Text, nullable=True)

    rows = relationship("StaffImportRow", back_populates="batch", cascade="all, delete-orphan")
    issues = relationship("StaffImportIssue", back_populates="batch", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("status IN ('VALIDATED','APPLIED','REVIEW_REQUIRED','FAILED')", name="ck_staff_import_batch_status"),
    )


class StaffImportRow(Base):
    __tablename__ = "staff_import_rows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(36), ForeignKey("staff_import_batches.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_row_number = Column(Integer, nullable=False)
    source_staff_id = Column(String(64), nullable=True)
    staff_member_id = Column(String(36), ForeignKey("staff_members.id", ondelete="RESTRICT"), nullable=True, index=True)
    raw_payload_json = Column(JSON, nullable=False)
    normalized_payload_json = Column(JSON, nullable=False)
    row_status = Column(String(32), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    batch = relationship("StaffImportBatch", back_populates="rows")
    staff_member = relationship("StaffMember", back_populates="import_rows")
    issues = relationship("StaffImportIssue", back_populates="import_row", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("batch_id", "source_row_number", name="uq_staff_import_source_row"),
        CheckConstraint("row_status IN ('ACCEPTED','ACCEPTED_WITH_WARNINGS','REVIEW_REQUIRED','CONFLICT','SKIP_DUPLICATE_BATCH')", name="ck_staff_import_row_status"),
    )


class StaffImportIssue(Base):
    __tablename__ = "staff_import_issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(36), ForeignKey("staff_import_batches.id", ondelete="RESTRICT"), nullable=False, index=True)
    import_row_id = Column(Integer, ForeignKey("staff_import_rows.id", ondelete="RESTRICT"), nullable=True, index=True)
    issue_code = Column(String(64), nullable=False, index=True)
    field_name = Column(String(64), nullable=True)
    severity = Column(String(16), nullable=False, default="WARNING", server_default="WARNING")
    message = Column(String(512), nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    resolution_notes = Column(String(512), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    batch = relationship("StaffImportBatch", back_populates="issues")
    import_row = relationship("StaffImportRow", back_populates="issues")

    __table_args__ = (
        CheckConstraint("severity IN ('INFO','WARNING','ERROR')", name="ck_staff_import_issue_severity"),
    )


class StaffJobTitleMapping(Base):
    __tablename__ = "staff_job_title_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    raw_title = Column(String(255), nullable=False, unique=True)
    normalized_title = Column(String(255), nullable=False)
    status = Column(String(16), nullable=False, default="PENDING", server_default="PENDING")
    approved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('PENDING','APPROVED')", name="ck_staff_job_title_mapping_status"),
    )
