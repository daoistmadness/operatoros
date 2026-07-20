import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer,
    JSON, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import relationship

from core.database import Base


def new_student_master_id() -> str:
    return str(uuid.uuid4())


class StudentMaster(Base):
    __tablename__ = "student_masters"

    id = Column(String(36), primary_key=True, default=new_student_master_id)
    full_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    preferred_name = Column(String(255), nullable=True)
    nipd = Column(String(64), nullable=True)
    nisn = Column(String(64), nullable=True)
    nik = Column(String(64), nullable=True)
    gender = Column(String(32), nullable=True)
    birth_place = Column(String(255), nullable=True)
    birth_date = Column(Date, nullable=True)
    religion = Column(String(64), nullable=True)
    citizenship = Column(String(64), nullable=True)
    blood_type = Column(String(8), nullable=True)
    student_status = Column(String(32), nullable=False, default="pending_review", server_default="pending_review")
    admission_date = Column(Date, nullable=True)
    admission_type = Column(String(64), nullable=True)
    previous_school = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    created_by = Column(String(255), nullable=True)
    updated_by = Column(String(255), nullable=True)

    device_identities = relationship("StudentDeviceIdentity", back_populates="student_master")

    __table_args__ = (
        Index("uq_student_masters_nipd", "nipd", unique=True, sqlite_where=nipd.isnot(None), postgresql_where=nipd.isnot(None)),
        Index("uq_student_masters_nisn", "nisn", unique=True, sqlite_where=nisn.isnot(None), postgresql_where=nisn.isnot(None)),
        Index("uq_student_masters_nik", "nik", unique=True, sqlite_where=nik.isnot(None), postgresql_where=nik.isnot(None)),
        CheckConstraint("student_status IN ('pending_review','active','inactive','transferred','withdrawn','graduated','archived')", name="ck_student_master_status"),
    )


class StudentDeviceIdentity(Base):
    __tablename__ = "student_device_identities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, index=True)
    legacy_student_id = Column(Integer, ForeignKey("students.id", ondelete="RESTRICT"), nullable=True, index=True)
    device_identifier = Column(String(255), nullable=False)
    device_source = Column(String(255), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    created_by = Column(String(255), nullable=True)

    student_master = relationship("StudentMaster", back_populates="device_identities")

    __table_args__ = (
        Index("uq_active_student_device_identity", "device_source", "device_identifier", unique=True, sqlite_where=is_active.is_(True), postgresql_where=is_active.is_(True)),
        UniqueConstraint("student_master_id", "device_source", "device_identifier", "effective_from", name="uq_student_device_history"),
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_student_device_effective_dates"),
        CheckConstraint("NOT is_active OR effective_to IS NULL", name="ck_active_device_has_no_end"),
    )


class StudentAddress(Base):
    __tablename__ = "student_addresses"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, unique=True)
    address = Column(Text, nullable=True)
    kelurahan = Column(String(255), nullable=True, index=True)
    kecamatan = Column(String(255), nullable=True)
    city_regency = Column(String(255), nullable=True)
    province = Column(String(255), nullable=True)
    postal_code = Column(String(32), nullable=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class StudentContact(Base):
    __tablename__ = "student_contacts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, unique=True)
    student_phone = Column(String(64), nullable=True)
    student_email = Column(String(255), nullable=True)
    emergency_contact_name = Column(String(255), nullable=True)
    emergency_contact_relationship = Column(String(128), nullable=True)
    emergency_contact_phone = Column(String(64), nullable=True)
    emergency_contact_address = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class StudentParentGuardian(Base):
    __tablename__ = "student_parent_guardians"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, index=True)
    guardian_type = Column(String(32), nullable=False)
    name = Column(String(255), nullable=False)
    phone = Column(String(64), nullable=True)
    email = Column(String(255), nullable=True)
    occupation = Column(String(255), nullable=True)
    education = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (CheckConstraint("guardian_type IN ('father','mother','guardian')", name="ck_guardian_type"),)


class StudentHealthProfile(Base):
    __tablename__ = "student_health_profiles"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, unique=True)
    allergy = Column(Text, nullable=True)
    medical_condition = Column(Text, nullable=True)
    special_needs = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class StudentDocumentStatus(Base):
    __tablename__ = "student_document_statuses"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, unique=True)
    family_card_received = Column(Boolean, nullable=False, default=False, server_default="0")
    birth_certificate_received = Column(Boolean, nullable=False, default=False, server_default="0")
    parent_id_received = Column(Boolean, nullable=False, default=False, server_default="0")
    school_agreement_received = Column(Boolean, nullable=False, default=False, server_default="0")
    publication_consent_received = Column(Boolean, nullable=False, default=False, server_default="0")
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class StudentImportBatch(Base):
    __tablename__ = "student_import_batches"
    id = Column(String(36), primary_key=True, default=new_student_master_id)
    session_id = Column(String(36), ForeignKey("student_import_sessions.id", ondelete="RESTRICT"), nullable=False, unique=True)
    filename = Column(String(255), nullable=False)
    file_checksum = Column(String(64), nullable=False, index=True)
    source_sheet = Column(String(255), nullable=True)
    status = Column(String(32), nullable=False, default="preview", server_default="preview")
    total_rows = Column(Integer, nullable=False, default=0, server_default="0")
    new_count = Column(Integer, nullable=False, default=0, server_default="0")
    update_count = Column(Integer, nullable=False, default=0, server_default="0")
    unchanged_count = Column(Integer, nullable=False, default=0, server_default="0")
    conflict_count = Column(Integer, nullable=False, default=0, server_default="0")
    invalid_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    committed_at = Column(DateTime, nullable=True)
    __table_args__ = (CheckConstraint("status IN ('preview','approved','committing','committed','failed','expired')", name="ck_student_import_batch_status"),)


class StudentImportRow(Base):
    __tablename__ = "student_import_rows"
    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(36), ForeignKey("student_import_batches.id", ondelete="RESTRICT"), nullable=False, index=True)
    source_row = Column(Integer, nullable=False)
    classification = Column(String(64), nullable=False)
    matched_student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=True, index=True)
    normalized_payload = Column(JSON, nullable=False, default=dict)
    differences = Column(JSON, nullable=False, default=dict)
    validation_errors = Column(JSON, nullable=False, default=list)
    selected_for_commit = Column(Boolean, nullable=False, default=False, server_default="0")
    __table_args__ = (UniqueConstraint("batch_id", "source_row", name="uq_student_import_source_row"),)


class StudentMasterChangeHistory(Base):
    __tablename__ = "student_master_change_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    field_name = Column(String(128), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    source = Column(String(128), nullable=False)
    import_batch_id = Column(String(36), ForeignKey("student_import_batches.id", ondelete="RESTRICT"), nullable=True, index=True)
    changed_by = Column(String(255), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)


class LegacyLinkPreviewBatch(Base):
    __tablename__ = "legacy_link_preview_batches"
    id = Column(String(36), primary_key=True, default=new_student_master_id)
    snapshot_checksum = Column(String(64), nullable=False, index=True)
    rows = Column(JSON, nullable=False, default=list)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    committed_at = Column(DateTime, nullable=True)


class LegacyLinkResolution(Base):
    __tablename__ = "legacy_link_resolutions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    legacy_student_id = Column(Integer, ForeignKey("students.id", ondelete="RESTRICT"), nullable=False, index=True)
    resolution = Column(String(32), nullable=False)
    student_master_id = Column(String(36), ForeignKey("student_masters.id", ondelete="RESTRICT"), nullable=True)
    reason = Column(Text, nullable=False)
    resolved_by = Column(String(255), nullable=False)
    resolved_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("resolution IN ('linked','created','deferred','invalid')", name="ck_legacy_link_resolution"),
    )


class EnrollmentPopulationPreviewBatch(Base):
    __tablename__ = "enrollment_population_preview_batches"
    id = Column(String(36), primary_key=True, default=new_student_master_id)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False)
    effective_start_date = Column(Date, nullable=False)
    snapshot_checksum = Column(String(64), nullable=False, index=True)
    rows = Column(JSON, nullable=False, default=list)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    committed_at = Column(DateTime, nullable=True)


class StudentEnrollmentClassHistory(Base):
    __tablename__ = "student_enrollment_class_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    enrollment_id = Column(Integer, ForeignKey("student_enrollments.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_name = Column(String(255), nullable=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    changed_by = Column(String(255), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())
    source = Column(String(128), nullable=False)
    import_batch_id = Column(String(36), ForeignKey("student_import_batches.id", ondelete="RESTRICT"), nullable=True)
    __table_args__ = (
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_enrollment_class_history_dates"),
    )
