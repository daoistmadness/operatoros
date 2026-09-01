from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from core.database import Base


class AttendanceCalendarWeekdayRule(Base):
    __tablename__ = "attendance_calendar_weekday_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False)
    weekday = Column(Integer, nullable=False)
    expectation = Column(String(16), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_attendance_calendar_weekday"),
        CheckConstraint("expectation IN ('EXPECTED','NOT_EXPECTED')", name="ck_attendance_calendar_weekday_expectation"),
        UniqueConstraint("academic_year_id", "jenjang_id", "weekday", name="_attendance_calendar_weekday_uc"),
    )


class AttendanceCalendarException(Base):
    __tablename__ = "attendance_calendar_exceptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False)
    jenjang_id = Column(Integer, ForeignKey("jenjangs.id", ondelete="RESTRICT"), nullable=False)
    date = Column(Date, nullable=False)
    expectation = Column(String(16), nullable=False)
    reason = Column(String(40), nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("expectation IN ('EXPECTED','NOT_EXPECTED')", name="ck_attendance_calendar_exception_expectation"),
        CheckConstraint("reason IN ('HOLIDAY','SCHOOL_BREAK','SCHOOL_CLOSED','NON_INSTRUCTIONAL_DAY','PROGRAM_NOT_IN_SESSION','REPLACEMENT_SCHOOL_DAY','SPECIAL_INSTRUCTIONAL_DAY')", name="ck_attendance_calendar_exception_reason"),
        UniqueConstraint("academic_year_id", "jenjang_id", "date", name="_attendance_calendar_exception_uc"),
    )
