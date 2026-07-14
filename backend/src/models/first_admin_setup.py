from sqlalchemy import Boolean, Column, DateTime, Integer, String, func

from core.database import Base


class FirstAdminSetupState(Base):
    """Singleton bootstrap guard and atomic first-admin audit record."""

    __tablename__ = "first_admin_setup_state"

    id = Column(Integer, primary_key=True)
    completed = Column(Boolean, nullable=False, default=False, server_default="0")
    completed_at = Column(DateTime, nullable=True)
    # Dialect migrations enforce ON DELETE RESTRICT. Keeping the ORM column
    # scalar avoids coupling migration-owned identity metadata to legacy
    # analytics tests that intentionally reload core.database in isolation.
    created_user_id = Column(Integer, nullable=True)
    normalized_username = Column(String(255), nullable=True)
    provisioning_source = Column(String(32), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
