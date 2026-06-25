from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from core.database import Base


class UploadLog(Base):
    __tablename__ = "upload_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    uploaded_by = Column(String, nullable=True)
    total_records = Column(Integer, nullable=False, default=0)
    new_students = Column(Integer, nullable=False, default=0)
    late_entries = Column(Integer, nullable=False, default=0)
    incomplete_entries = Column(Integer, nullable=False, default=0)
    failed_rows = Column(Integer, nullable=False, default=0)
    skipped_empty = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False)

