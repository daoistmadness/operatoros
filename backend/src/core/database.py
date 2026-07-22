import sqlite3
import logging
import os
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

LOGGER = logging.getLogger(__name__)


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
                "student_enrollment_lifecycle_audit",
            )
            if table_name in tables
        ]
        if engine.dialect.name == "sqlite":
            for table_name in protected_tables:
                if table_name == "student_enrollment_class_history":
                    connection.execute(text("DROP TRIGGER IF EXISTS trg_student_enrollment_class_history_no_update"))
                    immutable = ("id", "enrollment_id", "class_name", "effective_from", "changed_by", "changed_at", "source", "import_batch_id")
                    same = " AND ".join(f"OLD.{column} IS NEW.{column}" for column in immutable)
                    connection.execute(text(
                        "CREATE TRIGGER trg_student_enrollment_class_history_no_update "
                        "BEFORE UPDATE ON student_enrollment_class_history WHEN NOT ("
                        f"{same} AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL "
                        "AND NEW.effective_to >= OLD.effective_from) BEGIN "
                        "SELECT RAISE(FAIL, 'class history permits only one-way interval closure'); END"
                    ))
                else:
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
            if "student_enrollment_class_history" in protected_tables:
                connection.execute(text("DROP TRIGGER IF EXISTS trg_student_enrollment_class_history_no_update ON student_enrollment_class_history"))
                connection.execute(text("""
                    CREATE OR REPLACE FUNCTION permit_enrollment_history_interval_closure()
                    RETURNS trigger AS $$ BEGIN
                        IF OLD.id IS NOT DISTINCT FROM NEW.id
                           AND OLD.enrollment_id IS NOT DISTINCT FROM NEW.enrollment_id
                           AND OLD.class_name IS NOT DISTINCT FROM NEW.class_name
                           AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from
                           AND OLD.changed_by IS NOT DISTINCT FROM NEW.changed_by
                           AND OLD.changed_at IS NOT DISTINCT FROM NEW.changed_at
                           AND OLD.source IS NOT DISTINCT FROM NEW.source
                           AND OLD.import_batch_id IS NOT DISTINCT FROM NEW.import_batch_id
                           AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
                           AND NEW.effective_to >= OLD.effective_from THEN RETURN NEW; END IF;
                        RAISE EXCEPTION 'class history permits only one-way interval closure';
                    END; $$ LANGUAGE plpgsql
                """))
                connection.execute(text(
                    "CREATE TRIGGER trg_student_enrollment_class_history_no_update "
                    "BEFORE UPDATE ON student_enrollment_class_history FOR EACH ROW "
                    "EXECUTE FUNCTION permit_enrollment_history_interval_closure()"
                ))


def _ensure_academic_master_compatibility() -> None:
    """Add S3.7 governance columns without assigning academic values."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        if "jenjangs" in tables:
            columns = {column["name"] for column in inspector.get_columns("jenjangs")}
            if "code" not in columns:
                connection.execute(text("ALTER TABLE jenjangs ADD COLUMN code VARCHAR(32) NULL"))
            if "level" not in columns:
                connection.execute(text("ALTER TABLE jenjangs ADD COLUMN level INTEGER NULL"))
            if "active" not in columns:
                default = "TRUE" if engine.dialect.name == "postgresql" else "1"
                connection.execute(text(f"ALTER TABLE jenjangs ADD COLUMN active BOOLEAN NOT NULL DEFAULT {default}"))
            if "created_at" not in columns:
                connection.execute(text("ALTER TABLE jenjangs ADD COLUMN created_at TIMESTAMP NULL"))
            if "updated_at" not in columns:
                connection.execute(text("ALTER TABLE jenjangs ADD COLUMN updated_at TIMESTAMP NULL"))
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_jenjangs_code ON jenjangs(code)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_jenjangs_active ON jenjangs(active)"))
        if "academic_years" in tables:
            columns = {column["name"] for column in inspector.get_columns("academic_years")}
            if "created_at" not in columns:
                connection.execute(text("ALTER TABLE academic_years ADD COLUMN created_at TIMESTAMP NULL"))
            if "updated_at" not in columns:
                connection.execute(text("ALTER TABLE academic_years ADD COLUMN updated_at TIMESTAMP NULL"))
        if "academic_programs" in tables:
            columns = {column["name"] for column in inspector.get_columns("academic_programs")}
            if "created_at" not in columns:
                connection.execute(text("ALTER TABLE academic_programs ADD COLUMN created_at TIMESTAMP NULL"))
            if "updated_at" not in columns:
                connection.execute(text("ALTER TABLE academic_programs ADD COLUMN updated_at TIMESTAMP NULL"))
        if "academic_classes" in tables:
            columns = {column["name"] for column in inspector.get_columns("academic_classes")}
            if "grade_id" not in columns:
                class_count = connection.execute(text("SELECT COUNT(*) FROM academic_classes")).scalar() or 0
                enrollment_refs = 0
                if "student_enrollments" in tables and "academic_class_id" in {column["name"] for column in inspector.get_columns("student_enrollments")}:
                    enrollment_refs = connection.execute(text("SELECT COUNT(*) FROM student_enrollments WHERE academic_class_id IS NOT NULL")).scalar() or 0
                raise RuntimeError(
                    "DATABASE_MIGRATION_REQUIRED: academic_classes.grade_id is missing; "
                    f"rows={class_count}, enrollment_references={enrollment_refs}"
                )
        if "student_enrollments" in tables:
            columns = {column["name"] for column in inspector.get_columns("student_enrollments")}
            if "academic_class_id" not in columns:
                connection.execute(text(
                    "ALTER TABLE student_enrollments ADD COLUMN academic_class_id INTEGER NULL "
                    "REFERENCES academic_classes(id) ON DELETE RESTRICT"
                ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_student_enrollments_academic_class_id "
                "ON student_enrollments(academic_class_id)"
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
    from models.academic_master import AcademicClass, AcademicGrade, AcademicMasterAudit, AcademicMasterImportPreview, AcademicProgram
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


def validate_student_linking_gate(engine_arg: Engine, *, bypass: bool = False) -> None:
    """Block startup when legacy students are not linked one-to-one to masters."""
    with engine_arg.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        if not {"students", "student_masters"}.issubset(tables):
            return
        students_count = connection.execute(text("SELECT COUNT(*) FROM students")).scalar() or 0
        masters_count = connection.execute(text("SELECT COUNT(*) FROM student_masters")).scalar() or 0

    if bypass:
        LOGGER.warning(
            "STUDENT LINKING GATE BYPASSED: BYPASS_STUDENT_LINKING_GATE=true "
            "(students=%d, student_masters=%d). Do not use this setting in production.",
            students_count,
            masters_count,
        )
        return

    # An empty database is the approved first-time deployment state. Once legacy
    # students exist, every student must have a restored master before startup.
    if students_count > 0 and masters_count != students_count:
        raise RuntimeError(
            "Deployment Gate Violation: legacy student linking is incomplete "
            f"(students={students_count}, student_masters={masters_count})."
        )


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
    from models.student_enrollment import StudentEnrollment, StudentEnrollmentLifecycleAudit
    from models.student_master import (
        EnrollmentPopulationPreviewBatch, LegacyLinkPreviewBatch, LegacyLinkResolution,
        StudentAddress, StudentContact, StudentDeviceIdentity, StudentDocumentStatus,
        StudentEnrollmentClassHistory, StudentHealthProfile, StudentImportBatch,
        StudentImportRow, StudentMaster, StudentMasterChangeHistory, StudentParentGuardian,
    )
    from models.student_subject_grade import StudentSubjectGrade
    from models.academic_roster import AcademicRosterImportBatch
    from models.student_import_session import StudentImportAppliedAction, StudentImportSession
    from models.operations_audit import OperationsAuditEvent
    from models.academic_config import AcademicTermConfig, KkmThreshold
    from models.academic_intervention import AcademicIntervention
    from models.report_builder import ReportTemplate, ReportBrandingConfig
    from models.backup_operation import BackupExecutionHistory, BackupSchedulerConfig
    from models.first_admin_setup import FirstAdminSetupState
    from models.academic_master import AcademicClass, AcademicGrade, AcademicMasterAudit, AcademicMasterImportPreview, AcademicProgram
    # Identity tables are migration-owned even when their ORM models were imported.
    startup_tables = [
        table for table in Base.metadata.sorted_tables if table.name not in {"users", "sessions"}
    ]
    Base.metadata.create_all(bind=engine, tables=startup_tables)
    _ensure_academic_master_compatibility()
    run_grade_ledger_patches(engine)
    _seed_grade_ledger_minimum(engine)
    _ensure_students_schema_compatibility()
    _ensure_upload_logs_schema_compatibility()
    _ensure_attendance_schema_compatibility()
    _ensure_attendance_index_compatibility()
    _ensure_student_foundation_compatibility()
    from services.report_builder import seed_report_builder_defaults

    seed_report_builder_defaults()

    if not os.environ.get("PYTEST_CURRENT_TEST"):
        validate_student_linking_gate(
            engine,
            bypass=os.environ.get("BYPASS_STUDENT_LINKING_GATE", "false").lower() == "true",
        )
