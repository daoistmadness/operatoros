from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, func
from sqlalchemy.orm import relationship

from core.database import Base


class User(Base):
    """Local authenticated identity; created only by approved SQL migrations."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(512), nullable=False)
    role = Column(String(16), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    last_login_at = Column(DateTime, nullable=True)
    failed_login_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    locked_until = Column(DateTime, nullable=True)

    sessions = relationship("UserSession", back_populates="user")

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'staff')", name="ck_users_role"),
        CheckConstraint("failed_login_attempts >= 0", name="ck_users_failed_login_attempts"),
    )
