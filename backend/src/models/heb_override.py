from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from core.database import Base


class HebOverride(Base):
    __tablename__ = "heb_overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    jenjang = Column(String, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    heb_value = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    set_by = Column(String, nullable=False)
    set_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("jenjang", "month", "year", name="uq_heb_overrides_period"),
    )
