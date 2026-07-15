import sqlite3
from datetime import date

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


GRADE_BOOTSTRAP_JENJANG = "Primary"
GRADE_BOOTSTRAP_ACADEMIC_YEAR = "2025/2026"
GRADE_BOOTSTRAP_SUBJECT = "Language"


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


def _ensure_student_foundation_compatibility() -> None:
    """Apply additive S2 columns and database-level append-only protections."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "student_enrollments" in tables:
            enrollment_columns = {column["name"] for column in inspector.get_columns("student_enrollments")}
            if "student_master_id" not in enrollment_columns:
                if engine.dialect.name == "postgresql":
                    connection.execute(text(
                        "ALTER TABLE student_enrollments ADD COLUMN student_master_id VARCHAR(36) NULL "
                        "REFERENCES student_masters(id) ON DELETE RESTRICT"
                    ))
                else:
                    connection.execute(text(
                        "ALTER TABLE student_enrollments ADD COLUMN student_master_id VARCHAR(36) NULL "
                        "REFERENCES student_masters(id) ON DELETE RESTRICT"
                    ))
                connection.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_student_enrollments_master_id "
                    "ON student_enrollments(student_master_id)"
                ))
            if "effective_from" not in enrollment_columns:
                connection.execute(text("ALTER TABLE student_enrollments ADD COLUMN effective_from DATE NULL"))
            if "effective_to" not in enrollment_columns:
                connection.execute(text("ALTER TABLE student_enrollments ADD COLUMN effective_to DATE NULL"))
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_student_master_academic_year "
                "ON student_enrollments(student_master_id, academic_year_id) "
                "WHERE student_master_id IS NOT NULL"
            ))

        protected_tables = [
            table_name for table_name in (
                "attendance_override_history",
                "student_master_change_history",
                "student_enrollment_class_history",
            )
            if table_name in tables
        ]
        if engine.dialect.name == "sqlite":
            for table_name in protected_tables:
                connection.execute(text(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table_name}_no_update "
                    f"BEFORE UPDATE ON {table_name} BEGIN "
                    f"SELECT RAISE(FAIL, '{table_name} is append-only'); END"
                ))
                connection.execute(text(
                    f"CREATE TRIGGER IF NOT EXISTS trg_{table_name}_no_delete "
                    f"BEFORE DELETE ON {table_name} BEGIN "
                    f"SELECT RAISE(FAIL, '{table_name} is append-only'); END"
                ))
        elif engine.dialect.name == "postgresql":
            connection.execute(text("""
                CREATE OR REPLACE FUNCTION prevent_operatoros_append_only_mutation()
                RETURNS trigger AS $$ BEGIN
                    RAISE EXCEPTION 'append-only history cannot be modified';
                END; $$ LANGUAGE plpgsql
            """))
            for table_name in protected_tables:
                for action in ("UPDATE", "DELETE"):
                    trigger_name = f"trg_{table_name}_no_{action.lower()}"
                    connection.execute(text(f"DROP TRIGGER IF EXISTS {trigger_name} ON {table_name}"))
                    connection.execute(text(
                        f"CREATE TRIGGER {trigger_name} BEFORE {action} ON {table_name} "
                        "FOR EACH ROW EXECUTE FUNCTION prevent_operatoros_append_only_mutation()"
                    ))


def run_grade_ledger_patches(engine_arg) -> None:
    """Apply non-destructive patches for the dynamic Grade Ledger architecture."""
    inspector = inspect(engine_arg)
    table_names = set(inspector.get_table_names())

    with engine_arg.begin() as connection:
        if "student_term_grades" in table_names and "student_term_grades_legacy" not in table_names:
            connection.execute(text("ALTER TABLE student_term_grades RENAME TO student_term_grades_legacy"))

        refreshed_tables = set(inspect(connection).get_table_names())
        if "assessment_components" not in refreshed_tables:
            return

        component_count = connection.execute(text("SELECT COUNT(*) FROM assessment_components")).scalar() or 0
        if component_count == 0:
            connection.execute(
                text(
                    "INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES "
                    "(:kuis_name, :sumatif_type, NULL), "
                    "(:tes_name, :sumatif_type, NULL), "
                    "(:total_name, :sumatif_type, NULL), "
                    "(:total_name, :formatif_type, NULL)"
                ),
                {
                    "kuis_name": "kuis",
                    "tes_name": "tes",
                    "total_name": "total",
                    "sumatif_type": "sumatif",
                    "formatif_type": "formatif",
                },
            )


def _seed_grade_ledger_minimum(engine_arg) -> None:
    """Create minimal Grade Ledger master data without overwriting existing rows."""
    from models.academic_year import AcademicYear
    from models.academic_mapping import StudentAcademicMappingRule
    from models.academic_roster import AcademicRosterImportBatch
    from models.jenjang import Jenjang
    from models.subject import Subject

    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine_arg)
    session = session_factory()
    try:
        jenjang = session.query(Jenjang).filter(Jenjang.name == GRADE_BOOTSTRAP_JENJANG).first()
        if jenjang is None:
            jenjang = Jenjang(name=GRADE_BOOTSTRAP_JENJANG)
            session.add(jenjang)
            session.flush()

        default_year_exists = session.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).first() is not None
        academic_year = (
            session.query(AcademicYear)
            .filter(AcademicYear.label == GRADE_BOOTSTRAP_ACADEMIC_YEAR)
            .first()
        )
        if academic_year is None:
            academic_year = AcademicYear(
                label=GRADE_BOOTSTRAP_ACADEMIC_YEAR,
                start_date=date(2025, 7, 1),
                end_date=date(2026, 6, 30),
                status="active",
                is_default=not default_year_exists,
            )
            session.add(academic_year)
        elif not default_year_exists:
            academic_year.is_default = True

        subject = (
            session.query(Subject)
            .filter(
                Subject.name == GRADE_BOOTSTRAP_SUBJECT,
                Subject.jenjang_id == jenjang.id,
            )
            .first()
        )
        if subject is None:
            session.add(
                Subject(
                    name=GRADE_BOOTSTRAP_SUBJECT,
                    jenjang_id=jenjang.id,
                    supports_sumatif=True,
                    supports_formatif=True,
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models.student import Student
    from models.attendance import Attendance
    from models.attendance_import import AttendanceImportBatch, AttendanceImportRow
    from models.absence_reason import AbsenceReason
    from models.absence_reason_class_entry import AbsenceReasonClassEntry
    from models.jenjang_config import JenjangConfig
    from models.heb_override import HebOverride
    from models.upload_log import UploadLog
    from models.attendance_review import AttendanceOverride, AttendanceOverrideHistory
    from models.academic_year import AcademicYear
    from models.jenjang import Jenjang
    from models.subject import Subject
    from models.assessment_component import AssessmentComponent
    from models.student_enrollment import StudentEnrollment
    from models.student_master import (
        EnrollmentPopulationPreviewBatch, LegacyLinkPreviewBatch, LegacyLinkResolution,
        StudentAddress, StudentContact, StudentDeviceIdentity, StudentDocumentStatus,
        StudentEnrollmentClassHistory, StudentHealthProfile, StudentImportBatch,
        StudentImportRow, StudentMaster, StudentMasterChangeHistory, StudentParentGuardian,
    )
    from models.student_subject_grade import StudentSubjectGrade
    from models.academic_config import AcademicTermConfig, KkmThreshold
    from models.academic_intervention import AcademicIntervention
    from models.report_builder import ReportTemplate, ReportBrandingConfig
    from models.backup_operation import BackupExecutionHistory, BackupSchedulerConfig
    from models.first_admin_setup import FirstAdminSetupState
    # Identity tables are migration-owned even when their ORM models were imported.
    startup_tables = [
        table for table in Base.metadata.sorted_tables if table.name not in {"users", "sessions"}
    ]
    Base.metadata.create_all(bind=engine, tables=startup_tables)
    run_grade_ledger_patches(engine)
    _seed_grade_ledger_minimum(engine)
    _ensure_students_schema_compatibility()
    _ensure_upload_logs_schema_compatibility()
    _ensure_attendance_schema_compatibility()
    _ensure_attendance_index_compatibility()
    _ensure_student_foundation_compatibility()
    from services.report_builder import seed_report_builder_defaults

    seed_report_builder_defaults()
