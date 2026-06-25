from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from core.database import Base


class JenjangConfig(Base):
    __tablename__ = "jenjang_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    jenjang = Column(String, nullable=False, unique=True, index=True)
    cutoff_time = Column(String, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
