from sqlalchemy import Column, Integer, String

from core.database import Base


class Jenjang(Base):
    __tablename__ = "jenjangs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)
