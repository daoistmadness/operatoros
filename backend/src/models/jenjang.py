from sqlalchemy import Boolean, Column, DateTime, Integer, String, func

from core.database import Base


class Jenjang(Base):
    __tablename__ = "jenjangs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, index=True)
    code = Column(String(32), nullable=True, unique=True, index=True)
    level = Column(String(64), nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
