from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, Index, Integer, String, func

from core.database import Base


class AcademicYear(Base):
    __tablename__ = "academic_years"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(String, nullable=False, unique=True, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="upcoming")
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('upcoming', 'active', 'closed')", name="ck_academic_year_status"),
        Index(
            "uq_academic_year_default",
            "is_default",
            unique=True,
            sqlite_where=(is_default == 1),
            postgresql_where=(is_default == True),
        ),
    )
