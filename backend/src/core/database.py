import sqlite3

from sqlalchemy import create_engine, inspect, text, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings


@event.listens_for(Engine, "connect")
def set_sqlite_pragmas(dbapi_connection, connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=10000")
        cursor.close()

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def _ensure_students_schema_compatibility() -> None:
    """Apply incremental schema migrations for the students table."""
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "students" not in table_names:
        return

    column_names = {column["name"] for column in inspector.get_columns("students")}
    with engine.begin() as connection:
        if "id_updated_at" not in column_names:
            connection.execute(text("ALTER TABLE students ADD COLUMN id_updated_at TIMESTAMP NULL"))
        if "jenjang" not in column_names:
            connection.execute(text("ALTER TABLE students ADD COLUMN jenjang VARCHAR NULL"))


        # Apply unique index on name if not already present.
        # SQLite does not support adding constraints via ALTER TABLE,
        # so we use CREATE UNIQUE INDEX ... IF NOT EXISTS instead.
        existing_indexes = {idx["name"] for idx in inspector.get_indexes("students")}
        existing_constraints = {uc["name"] for uc in inspector.get_unique_constraints("students")}
        if "_student_name_uc" not in existing_indexes and "_student_name_uc" not in existing_constraints:
            connection.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS _student_name_uc ON students (name)")
            )
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_students_class_name ON students (class_name)"))


def _ensure_upload_logs_schema_compatibility() -> None:
    """Apply incremental schema migrations for the upload_logs table."""
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "upload_logs" not in table_names:
        return

    column_names = {column["name"] for column in inspector.get_columns("upload_logs")}
    with engine.begin() as connection:
        if "incomplete_entries" not in column_names:
            connection.execute(text("ALTER TABLE upload_logs ADD COLUMN incomplete_entries INTEGER DEFAULT 0"))
        if "skipped_empty" not in column_names:
            connection.execute(text("ALTER TABLE upload_logs ADD COLUMN skipped_empty INTEGER DEFAULT 0"))


def _ensure_attendance_index_compatibility() -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "attendance" not in table_names:
        return

    with engine.begin() as connection:
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance (student_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (status)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance (student_id, date)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_attendance_status_date ON attendance (status, date)"))


def _ensure_attendance_schema_compatibility() -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "attendance" not in table_names:
        return

    column_names = {column["name"] for column in inspector.get_columns("attendance")}
    with engine.begin() as connection:
        if "late_source" not in column_names:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN late_source VARCHAR DEFAULT 'none'"))



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models.student import Student
    from models.attendance import Attendance
    from models.absence_reason import AbsenceReason
    from models.absence_reason_class_entry import AbsenceReasonClassEntry
    from models.jenjang_config import JenjangConfig
    from models.heb_override import HebOverride
    from models.upload_log import UploadLog
    from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
    Base.metadata.create_all(bind=engine)
    _ensure_students_schema_compatibility()
    _ensure_upload_logs_schema_compatibility()
    _ensure_attendance_schema_compatibility()
    _ensure_attendance_index_compatibility()
