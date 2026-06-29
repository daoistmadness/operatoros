from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from core.database import Base


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False, index=True)
    supports_sumatif = Column(Boolean, nullable=False, default=True)
    supports_formatif = Column(Boolean, nullable=False, default=True)

    jenjang = relationship("Jenjang")

    __table_args__ = (
        UniqueConstraint("name", "jenjang_id", name="_subject_jenjang_uc"),
    )
