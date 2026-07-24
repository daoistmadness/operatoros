from datetime import datetime
from sqlalchemy import Column, Integer, String, Time, Date, DateTime, Boolean, Text, ForeignKey
from core.database import Base


class DismissalPolicy(Base):
    __tablename__ = "dismissal_policies"

    id = Column(Integer, primary_key=True, index=True)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=True)
    jenjang = Column(String, nullable=False, index=True)
    weekday = Column(Integer, nullable=False)  # 0=Monday..6=Sunday
    dismissal_time = Column(Time, nullable=False)
    grace_period_minutes = Column(Integer, nullable=False, default=0)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    change_reason = Column(String, nullable=True)
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DismissalPolicyAudit(Base):
    __tablename__ = "dismissal_policy_audits"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey("dismissal_policies.id", ondelete="RESTRICT"), nullable=False)
    action = Column(String, nullable=False)  # CREATED, UPDATED, DEACTIVATED
    change_reason = Column(String, nullable=True)
    actor = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    policy_snapshot = Column(Text, nullable=True)
