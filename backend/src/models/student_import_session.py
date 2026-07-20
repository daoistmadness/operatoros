import uuid

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, event, func, inspect

from core.database import Base

# Register both specialized batch tables before SQLAlchemy resolves ledger FKs.
from models.academic_roster import AcademicRosterImportBatch  # noqa: F401, E402
from models.student_master import StudentImportBatch  # noqa: F401, E402


class StudentImportSession(Base):
    __tablename__ = "student_import_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_uuid = Column(String(36), nullable=False, unique=True, default=lambda: str(uuid.uuid4()))
    import_type = Column(String(32), nullable=False)
    status = Column(String(32), nullable=False, default="PREVIEW_CREATED")
    provenance_status = Column(String(40), nullable=False, default="PROVENANCE_FAILED")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
    created_by = Column(String(255), nullable=False, index=True)
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    committed_at = Column(DateTime, nullable=True)
    committed_by = Column(String(255), nullable=True)
    expires_at = Column(DateTime, nullable=False)
    source_filename = Column(String(255), nullable=False)
    source_file_checksum = Column(String(64), nullable=False)
    preview_checksum = Column(String(64), nullable=True)
    commit_checksum = Column(String(64), nullable=True)
    idempotency_key = Column(String(64), nullable=True, unique=True)
    request_correlation_id = Column(String(64), nullable=True, index=True)
    row_count = Column(Integer, nullable=False, default=0)
    selected_row_count = Column(Integer, nullable=False, default=0)
    applied_action_count = Column(Integer, nullable=False, default=0)
    rollback_state = Column(String(32), nullable=False, default="NOT_AVAILABLE")
    rollback_requested_at = Column(DateTime, nullable=True)
    rollback_completed_at = Column(DateTime, nullable=True)
    session_metadata = Column("metadata", JSON, nullable=False, default=dict)
    schema_version = Column(String(32), nullable=False, default="1")

    __table_args__ = (
        CheckConstraint("import_type IN ('STUDENT_ROSTER','STUDENT_DATA_UPDATE')", name="ck_student_import_session_type"),
        CheckConstraint("status IN ('PREVIEW_CREATED','PREVIEW_READY','PREVIEW_EXPIRED','COMMIT_PENDING','COMMITTED','COMMIT_FAILED','ARCHIVED')", name="ck_student_import_session_status"),
        CheckConstraint("provenance_status IN ('COMPLETE_ACTION_PROVENANCE','LEGACY_PROVENANCE_UNAVAILABLE','PROVENANCE_FAILED')", name="ck_student_import_provenance_status"),
        CheckConstraint("rollback_state IN ('NOT_AVAILABLE','AVAILABLE','PREVIEWED','PENDING','APPLIED','PARTIALLY_BLOCKED','BLOCKED','FAILED')", name="ck_student_import_rollback_state"),
        Index("ix_student_import_sessions_type_status", "import_type", "status"),
        Index("ix_student_import_sessions_provenance", "provenance_status"),
    )


class StudentImportAppliedAction(Base):
    __tablename__ = "student_import_applied_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("student_import_sessions.id", ondelete="RESTRICT"), nullable=False)
    student_import_batch_id = Column(String(36), ForeignKey("student_import_batches.id", ondelete="RESTRICT"), nullable=True)
    academic_roster_import_batch_id = Column(String(36), ForeignKey("academic_roster_import_batches.id", ondelete="RESTRICT"), nullable=True)
    source_row_number = Column(Integer, nullable=False)
    action_sequence = Column(Integer, nullable=False)
    action_type = Column(String(48), nullable=False)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(String(64), nullable=False)
    entity_reference = Column(String(64), nullable=False, index=True)
    operation_id = Column(String(64), nullable=False, unique=True)
    parent_action_id = Column(Integer, nullable=True)
    applied_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
    applied_by = Column(String(255), nullable=False)
    request_correlation_id = Column(String(64), nullable=True)
    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=False)
    before_state_checksum = Column(String(64), nullable=True)
    after_state_checksum = Column(String(64), nullable=False)
    dependency_checkpoint = Column(JSON, nullable=False, default=dict)
    compensation_type = Column(String(48), nullable=False)
    rollback_eligibility = Column(String(40), nullable=False)
    rollback_block_reason = Column(String(128), nullable=True)
    rollback_state = Column(String(32), nullable=False, default="NOT_REQUESTED")
    rollback_action_id = Column(Integer, nullable=True, unique=True)
    action_metadata = Column("metadata", JSON, nullable=False, default=dict)
    schema_version = Column(String(32), nullable=False, default="1")

    __table_args__ = (
        UniqueConstraint("session_id", "source_row_number", "action_sequence", name="uq_student_import_action_sequence"),
        CheckConstraint("NOT (student_import_batch_id IS NOT NULL AND academic_roster_import_batch_id IS NOT NULL)", name="ck_student_import_action_one_batch"),
        CheckConstraint("rollback_state IN ('NOT_REQUESTED','PREVIEWED','PENDING','APPLIED','PARTIALLY_APPLIED','BLOCKED','FAILED')", name="ck_student_import_action_rollback_state"),
        Index("ix_student_import_actions_session", "session_id"),
        Index("ix_student_import_actions_type", "action_type"),
        Index("ix_student_import_actions_rollback", "rollback_state"),
    )


IMMUTABLE_ACTION_FIELDS = {
    "session_id", "student_import_batch_id", "academic_roster_import_batch_id",
    "source_row_number", "action_sequence", "action_type", "entity_type", "entity_id",
    "entity_reference", "operation_id", "parent_action_id", "before_state", "after_state",
    "before_state_checksum", "after_state_checksum", "dependency_checkpoint", "compensation_type",
    "rollback_eligibility", "schema_version",
}


@event.listens_for(StudentImportAppliedAction, "before_update")
def prevent_applied_action_rewrite(_mapper, _connection, target):
    state = inspect(target)
    if any(state.attrs[field].history.has_changes() for field in IMMUTABLE_ACTION_FIELDS):
        raise ValueError("Applied import action provenance is immutable")


@event.listens_for(StudentImportAppliedAction, "before_delete")
def prevent_applied_action_delete(_mapper, _connection, _target):
    raise ValueError("Applied import action provenance cannot be deleted")
