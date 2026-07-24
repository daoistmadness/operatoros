from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from core.database import Base


class EarlyDepartureExcuse(Base):
    __tablename__ = "early_departure_excuses"

    id = Column(Integer, primary_key=True, index=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="RESTRICT"), nullable=False, index=True)
    reason_code = Column(String, nullable=False)  # MEDICAL, FAMILY_EMERGENCY, SCHOOL_EVENT, SAFE_PICKUP, ADMINISTRATIVE
    explanation = Column(Text, nullable=True)
    state = Column(String, nullable=False, default="ACTIVE")  # ACTIVE, REVOKED
    recorded_by = Column(String, nullable=False)
    recorded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_by = Column(String, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revocation_reason = Column(Text, nullable=True)


class EarlyDepartureExcuseAudit(Base):
    __tablename__ = "early_departure_excuse_audits"

    id = Column(Integer, primary_key=True, index=True)
    excuse_id = Column(Integer, ForeignKey("early_departure_excuses.id", ondelete="RESTRICT"), nullable=False)
    action = Column(String, nullable=False)  # RECORDED, REVOKED
    actor = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    reason_code = Column(String, nullable=True)
    revocation_reason = Column(Text, nullable=True)
