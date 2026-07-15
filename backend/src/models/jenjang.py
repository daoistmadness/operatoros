from sqlalchemy import Boolean, Column, Integer, String

from core.database import Base


class Jenjang(Base):
    __tablename__ = "jenjangs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)
    code = Column(String(32), nullable=True, unique=True, index=True)
    level = Column(Integer, nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="1", index=True)
