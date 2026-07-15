import uuid

from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, JSON, String, func

from core.database import Base


class AcademicRosterImportBatch(Base):
    __tablename__ = "academic_roster_import_batches"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255), nullable=False)
    checksum = Column(String(64), nullable=False, index=True)
    source_owner = Column(String(255), nullable=False)
    date_received = Column(Date, nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    status = Column(String(24), nullable=False, default="preview", server_default="preview")
    rows = Column(JSON, nullable=False)
    summary = Column(JSON, nullable=False)
    committed_by = Column(String(255), nullable=True)
    committed_at = Column(DateTime, nullable=True)
    commit_result = Column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('preview','committed','failed','expired')", name="ck_academic_roster_batch_status"),
    )

