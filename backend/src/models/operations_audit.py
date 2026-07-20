import uuid
from sqlalchemy import Column, DateTime, Integer, String, Text, Boolean, JSON, Index, func
from core.database import Base


class OperationsAuditEvent(Base):
    __tablename__ = "operations_audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String(36), nullable=False, unique=True, default=lambda: str(uuid.uuid4()))
    occurred_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)
    actor_id = Column(String(255), nullable=False, index=True)
    actor_role = Column(String(64), nullable=False)
    capability = Column(String(64), nullable=False)
    entity_type = Column(String(64), nullable=False)
    entity_reference = Column(String(64), nullable=False, index=True)
    operation = Column(String(64), nullable=False)
    risk_level = Column(String(32), nullable=False, default="LOW")
    source = Column(String(32), nullable=False, default="API")
    reason = Column(Text, nullable=True)
    import_session_id = Column(String(36), nullable=True, index=True)
    import_action_id = Column(Integer, nullable=True)
    rollback_action_id = Column(Integer, nullable=True)
    export_scope = Column(String(64), nullable=True)
    success = Column(Boolean, nullable=False, default=True)
    failure_code = Column(String(64), nullable=True)
    changed_fields = Column(JSON, nullable=True)
    request_correlation_id = Column(String(64), nullable=True, index=True)
    audit_metadata = Column("metadata", JSON, nullable=False, default=dict)
    schema_version = Column(String(32), nullable=False, default="1")

    __table_args__ = (
        Index("ix_ops_audit_risk_occurred", "risk_level", "occurred_at"),
        Index("ix_ops_audit_actor_occurred", "actor_id", "occurred_at"),
        Index("ix_ops_audit_operation_occurred", "operation", "occurred_at"),
    )
