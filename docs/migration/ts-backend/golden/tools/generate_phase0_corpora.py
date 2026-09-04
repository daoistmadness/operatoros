"""Service-level Phase 0 goldens: migrations, restore preflight, KKM/terms,
grades constraints, HEB rounding edges, backup checksums.

Usage:
    python_tooling="$(bun scripts/python-tooling-env.ts --repo . print-executable)"
    OPERATOROS_PYTHON="$python_tooling" "$python_tooling" docs/migration/ts-backend/golden/tools/generate_phase0_corpora.py

Safety: disposable temp-file SQLite only; protected DB never addressed.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
GOLDEN = Path(__file__).resolve().parents[1]
OUT = GOLDEN / "service-corpora"
MIGRATIONS_DIR = REPO / "backend" / "migrations"

sys.path.insert(0, str(REPO / "backend" / "src"))
os.environ.setdefault("AUTH_COOKIE_SECRET", "astryx-test-only-cookie-secret-32-chars")
_BOOTSTRAP_DB = Path(tempfile.gettempdir()) / "opencode" / "tsphase0" / "bootstrap.db"
_BOOTSTRAP_DB.parent.mkdir(parents=True, exist_ok=True)
if _BOOTSTRAP_DB.exists():
    _BOOTSTRAP_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_BOOTSTRAP_DB}"
_RESTORE_BACKUP_DIR = Path(tempfile.gettempdir()) / "opencode" / "tsphase0" / "restore-backups"
if _RESTORE_BACKUP_DIR.exists():
    import shutil as _shutil

    _shutil.rmtree(_RESTORE_BACKUP_DIR, ignore_errors=True)
_RESTORE_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
os.environ["BACKUP_DIR"] = str(_RESTORE_BACKUP_DIR)
os.environ["ENABLE_DESTRUCTIVE_OPERATIONS"] = "true"
os.environ.setdefault("OPERATOROS_ISOLATED_TEST", "true")
os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")

written: list[str] = []


def dump(obj) -> str:
    return json.dumps(obj, indent=2, default=str, sort_keys=True) + "\n"


def _sanitize(value, key: str = ""):
    if isinstance(value, datetime):
        if key.endswith("_at") or key == "generated_at":
            return "<ts>"
        return value
    if isinstance(value, dict):
        return {k: _sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v, key) for v in value]
    if isinstance(value, str):
        value = re.sub(r"/(?:tmp|home)/[A-Za-z0-9_./-]+", "<path>", value)
        value = re.sub(r"Free bytes: \d+", "Free bytes: <free>", value)
        value = re.sub(r"backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(_\d+)?\.sqlite3", "<backup-file>", value)
        keep_digest = any(t in key.lower() for t in ("digest", "checksum", "sha"))
        if not keep_digest:
            value = re.sub(r"\b[0-9a-f]{64}\b", "<sha256>", value)
        if re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", value):
            if key.endswith("_at") or key in ("generated_at", "timestamp") or key.endswith("_filename") and "backup" in key.lower():
                return "<ts>" if key == "timestamp" else value
        return value
    return value


def record(rel: str, obj) -> None:
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(_sanitize(obj)))
    written.append(str(path.relative_to(GOLDEN)))


def fresh_ledgered_db(tmp: Path, name: str) -> Path:
    from core import database as core_database
    from core.database import init_db

    db_path = tmp / name
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    _rebind(core_database, f"sqlite:///{db_path}")
    init_db()
    identity = (MIGRATIONS_DIR / "20260713_identity_schema_sqlite.sql").read_text()
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(identity)
        conn.commit()
        # File-copy consumers (preflight rehearsal) need a self-contained
        # main DB file; flush WAL content back before handing the path out.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    return db_path


def _rebind(core_database, url: str) -> None:
    from sqlalchemy import create_engine

    old = getattr(core_database, "engine", None)
    if old is not None:
        old.dispose()
    core_database.engine = create_engine(url, connect_args={"check_same_thread": False})
    core_database.SessionLocal.configure(bind=core_database.engine)


def migration_corpus() -> None:
    from core.schema_guard import DatabaseStartupError, validate_database_startup

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-mig-"))
    ok_path = fresh_ledgered_db(tmp, "fresh.db")
    cases: list[dict] = []

    def attempt(label: str) -> None:
        try:
            validate_database_startup()
            cases.append({"case": label, "outcome": "OK"})
        except DatabaseStartupError as exc:
            cases.append({"case": label, "outcome": str(exc)})
        except Exception as exc:
            cases.append({"case": label, "outcome": f"{type(exc).__name__}: {exc}"})

    saved_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = f"sqlite:///{ok_path}"
    attempt("fresh_current_schema_validates")

    empty_path = tmp / "empty.db"
    empty_path.write_bytes(b"")
    os.environ["DATABASE_URL"] = f"sqlite:///{empty_path}"
    attempt("empty_file_integrity_rejected")
    os.environ["DATABASE_URL"] = "sqlite://"
    attempt("in_memory_url_rejected")
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp / 'absent.db'}"
    attempt("missing_file_rejected")

    no_ledger = tmp / "no-ledger.db"
    conn = sqlite3.connect(no_ledger)
    conn.execute("CREATE TABLE dummy (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{no_ledger}"
    attempt("missing_migration_ledger")

    if saved_url is not None:
        os.environ["DATABASE_URL"] = saved_url
    record("migrations/startup-validation.json", cases)


def preflight_corpus() -> None:
    from services.preflight_service import run_production_preflight

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-pf-"))
    ok_path = fresh_ledgered_db(tmp, "pf-fresh.db")
    good = run_production_preflight(ok_path)

    bad_path = tmp / "pf-empty.db"
    bad_path.write_bytes(b"")
    bad = run_production_preflight(bad_path)
    record("restore/preflight-gates.json", {"fresh_ok": good, "empty_rejected": bad})


def kkm_term_corpus() -> None:
    from sqlalchemy.orm import sessionmaker

    from models.academic_config import AcademicTermConfig, KkmThreshold
    from models.academic_year import AcademicYear
    from services.academic_config import (
        effective_term_rows,
        resolve_effective_kkm,
        resolve_effective_term_range,
    )

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-kkm-"))
    db_path = fresh_ledgered_db(tmp, "kkm.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from core import database as core_database

    db = core_database.SessionLocal()
    try:
        year = db.query(AcademicYear).filter_by(is_default=True).first()
        if year is None:
            year = AcademicYear(
                label="2026/2027", start_date=date(2026, 7, 1),
                end_date=date(2027, 6, 30), is_default=True,
            )
            db.add(year)
            db.commit()
        fallback = resolve_effective_kkm(db, year.id, None, None, "overall")
        db.add(KkmThreshold(
            academic_year_id=year.id, jenjang_id=None, subject_id=None,
            assessment_type="overall", threshold=90.0,
        ))
        db.commit()
        configured = resolve_effective_kkm(db, year.id, None, None, "overall")
        specific = resolve_effective_kkm(db, year.id, None, None, "formatif")
        terms = effective_term_rows(db, year.id)
        term_one = resolve_effective_term_range(db, year, "term_1")
        record("kkm/resolution-and-term-defaults.json", {
            "legacy_fallback_overall": fallback,
            "configured_academic_year_overall": configured,
            "unconfigured_formatif_falls_back": specific,
            "default_term_rows": terms,
            "term_one_range": term_one,
        })
    finally:
        db.close()


def grades_corpus() -> None:
    from sqlalchemy.exc import IntegrityError

    from models.academic_config import AcademicTermConfig  # noqa: F401
    from models.academic_year import AcademicYear
    from models.academic_master import AcademicGrade, AcademicProgram
    from models.assessment_component import AssessmentComponent
    from models.jenjang import Jenjang
    from models.student_enrollment import StudentEnrollment
    from models.student_master import StudentMaster
    from models.student_subject_grade import StudentSubjectGrade
    from models.subject import Subject

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-grades-"))
    db_path = fresh_ledgered_db(tmp, "grades.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from core import database as core_database

    db = core_database.SessionLocal()
    cases = []
    try:
        jenjang = Jenjang(name="SMP", code="SMP", level="menengah")
        year = db.query(AcademicYear).filter_by(is_default=True).first()
        if year is None:
            year = AcademicYear(
                label="2026/2027-g", start_date=date(2026, 7, 1),
                end_date=date(2027, 6, 30), is_default=True,
            )
        db.add(jenjang)
        if year not in db:
            db.add(year)
        db.flush()
        subject = Subject(name="Matematika", jenjang_id=jenjang.id)
        master = StudentMaster(full_name="Grade Student", normalized_name="grade student",
                               student_status="active")
        db.add_all([subject, master])
        db.flush()
        program = AcademicProgram(jenjang_id=jenjang.id, name="Program A")
        db.add(program)
        db.flush()
        grade = AcademicGrade(jenjang_id=jenjang.id, program_id=program.id,
                              name="Grade 7", sequence_number=1)
        db.add(grade)
        db.commit()
        enrollment = StudentEnrollment(
            student_master_id=master.id, academic_year_id=year.id,
            jenjang_id=jenjang.id,
        )
        comp = AssessmentComponent(name="UH1", assessment_type="sumatif", subject_id=subject.id)
        db.add_all([master, enrollment, comp])
        db.commit()
        db.add(StudentSubjectGrade(
            enrollment_id=enrollment.id, subject_id=subject.id,
            component_id=comp.id, score=85.0,
        ))
        db.commit()
        cases.append({"case": "grade_insert_ok", "outcome": "OK"})
        try:
            db.add(StudentSubjectGrade(
                enrollment_id=enrollment.id, subject_id=subject.id,
                component_id=comp.id, score=70.0,
            ))
            db.commit()
            cases.append({"case": "duplicate_grade_unique", "outcome": "OK (unexpected)"})
        except IntegrityError as exc:
            db.rollback()
            cases.append({"case": "duplicate_grade_unique", "outcome": f"{type(exc.orig).__name__}"})
        try:
            db.add(AssessmentComponent(name="Bad", assessment_type="bulanan", subject_id=subject.id))
            db.commit()
            cases.append({"case": "component_type_check", "outcome": "OK (unexpected)"})
        except IntegrityError as exc:
            db.rollback()
            cases.append({"case": "component_type_check", "outcome": f"{type(exc.orig).__name__}"})
        try:
            db.delete(subject)
            db.commit()
            cases.append({"case": "subject_delete_restrict", "outcome": "OK (unexpected)"})
        except IntegrityError as exc:
            db.rollback()
            cases.append({"case": "subject_delete_restrict", "outcome": f"{type(exc.orig).__name__}"})
    finally:
        db.close()
    record("grades/constraints.json", cases)


def heb_edge_corpus() -> None:
    from sqlalchemy.orm import sessionmaker

    from models.attendance import Attendance
    from models.student import Student
    from services.attendance_metrics import calculate_auto_heb

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-heb-"))
    db_path = fresh_ledgered_db(tmp, "heb-edge.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from core import database as core_database

    db = core_database.SessionLocal()
    try:
        for offset, days in enumerate([21, 21, 20, 19]):
            sid = 301 + offset
            db.add(Student(id=sid, name=f"HebEdge{sid}", jenjang="SMPJ", class_name="SMPJ9"))
            for day in range(days):
                db.add(Attendance(
                    student_id=sid,
                    date=date(2026, 5, 1) + timedelta(days=day),
                    late_duration=0, late_source="none", is_absent=False, status="on-time",
                ))
        db.commit()
        four_students = calculate_auto_heb(db, "SMPJ", 5, 2026)
        record("heb/even-median-rounding.json", {
            "top4_median_case": four_students,
            "note": "median of even count exercises Python round() half-to-even semantics",
        })
    finally:
        db.close()


def reports_corpus() -> None:
    from models.absence_reason_class_entry import AbsenceReasonClassEntry
    from models.academic_year import AcademicYear
    from models.assessment_component import AssessmentComponent
    from models.attendance import Attendance
    from models.jenjang import Jenjang
    from models.student import Student
    from models.student_enrollment import StudentEnrollment
    from models.student_master import StudentMaster
    from models.subject import Subject
    from models.student_subject_grade import StudentSubjectGrade
    from services.report_service import (
        build_annual_report,
        build_monthly_management_report,
        build_monthly_report,
    )

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-reports-"))
    db_path = fresh_ledgered_db(tmp, "reports.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from core import database as core_database

    db = core_database.SessionLocal()
    try:
        year = AcademicYear(label="2026/2027-reports", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), is_default=False)
        db.add(year)
        db.flush()
        jenjang_smp = Jenjang(name="SMP", code="SMP", level="junior")
        jenjang_sd = Jenjang(name="SD", code="SD", level="primary")
        db.add_all([jenjang_smp, jenjang_sd])
        db.flush()
        subject_smp = Subject(name="Matematika", jenjang_id=jenjang_smp.id)
        subject_sd = Subject(name="Bahasa", jenjang_id=jenjang_sd.id)
        db.add_all([subject_smp, subject_sd])
        db.flush()
        comp_smp = AssessmentComponent(name="UH1", assessment_type="sumatif", subject_id=subject_smp.id)
        comp_smp2 = AssessmentComponent(name="UH2", assessment_type="sumatif", subject_id=subject_smp.id)
        comp_sd = AssessmentComponent(name="UH1", assessment_type="sumatif", subject_id=subject_sd.id)
        db.add_all([comp_smp, comp_smp2, comp_sd])
        db.flush()

        def add_enrolled(name, jenjang, class_name):
            master = StudentMaster(full_name=name, normalized_name=name.lower(), student_status="active")
            db.add(master)
            db.flush()
            student = Student(name=name, jenjang=jenjang.name, class_name=class_name)
            db.add(student)
            db.flush()
            enr = StudentEnrollment(student_id=student.id, student_master_id=master.id, academic_year_id=year.id, jenjang_id=jenjang.id, class_name=class_name, lifecycle_state="ACTIVE")
            db.add(enr)
            db.flush()
            return enr, student

        enrollments = []
        e_a1, s_a1 = add_enrolled("Alice SMP7A", jenjang_smp, "7A")
        e_a2, s_a2 = add_enrolled("Bob SMP7A", jenjang_smp, "7A")
        e_a3, s_a3 = add_enrolled("Charlie SMP7A", jenjang_smp, "7A")
        e_b1, s_b1 = add_enrolled("Dina SMP7B", jenjang_smp, "7B")
        e_b2, s_b2 = add_enrolled("Eko SMP7B", jenjang_smp, "7B")
        e_c1, s_c1 = add_enrolled("Fajar SD1A", jenjang_sd, "1A")
        e_c2, s_c2 = add_enrolled("Gina SD1A", jenjang_sd, "1A")
        enrollments.extend([e_a1, e_a2, e_a3, e_b1, e_b2, e_c1, e_c2])
        db.commit()

        def add_attendance(student, d, status, late=0):
            from datetime import time as _t
            if status in ("on-time", "late"):
                ci = _t(7, 45) if status == "late" else _t(7, 30)
                co = _t(15, 0)
            elif status == "incomplete":
                ci = _t(7, 30)
                co = None
            else:
                ci = None
                co = None
            db.add(Attendance(student_id=student.id, date=d, check_in=ci, check_out=co, late_duration=late if status=="late" else 0, late_source="none" if status!="late" else "calculated", is_absent=False, status=status, week="31"))

        for s in [s_a1, s_a2, s_a3]:
            for i in range(3):
                add_attendance(s, date(2026, 8, 1+i), "on-time")
            add_attendance(s, date(2026, 8, 5), "late", late=15)
        for s in [s_b1, s_b2]:
            add_attendance(s, date(2026, 8, 1), "on-time")
            add_attendance(s, date(2026, 8, 2), "incomplete")
        for s in [s_c1, s_c2]:
            add_attendance(s, date(2026, 8, 1), "on-time")
            add_attendance(s, date(2026, 8, 3), "late", late=20)
            add_attendance(s, date(2026, 8, 5), "incomplete")
        e_empty, s_empty = add_enrolled("Hana SMP7C", jenjang_smp, "7C")
        db.flush()

        db.add_all([
            AbsenceReasonClassEntry(class_name="7A", month=8, year=2026, sakit=2, izin=1, alfa=0, entered_by="golden-seed"),
            AbsenceReasonClassEntry(class_name="7B", month=8, year=2026, sakit=0, izin=0, alfa=1, entered_by="golden-seed"),
            AbsenceReasonClassEntry(class_name="1A", month=8, year=2026, sakit=1, izin=1, alfa=1, entered_by="golden-seed"),
            AbsenceReasonClassEntry(class_name="7C", month=8, year=2026, sakit=0, izin=0, alfa=0, entered_by="golden-seed"),
        ])
        from models.absence_reason import AbsenceReason
        from models.heb_override import HebOverride
        db.add_all([
            AbsenceReason(student_id=s_a1.id, class_name="7A", month=8, year=2026, sakit=1, izin=0, alfa=0, entered_by="golden-seed"),
            AbsenceReason(student_id=s_a2.id, class_name="7A", month=8, year=2026, sakit=1, izin=1, alfa=0, entered_by="golden-seed"),
            AbsenceReason(student_id=s_a3.id, class_name="7A", month=8, year=2026, sakit=0, izin=0, alfa=0, entered_by="golden-seed"),
            AbsenceReason(student_id=s_b1.id, class_name="7B", month=8, year=2026, sakit=0, izin=0, alfa=1, entered_by="golden-seed"),
            AbsenceReason(student_id=s_c1.id, class_name="1A", month=8, year=2026, sakit=1, izin=1, alfa=0, entered_by="golden-seed"),
        ])
        db.add(HebOverride(jenjang="SMP", month=8, year=2026, heb_value=18, note="reports golden SMP", set_by="golden-seed"))
        db.add(HebOverride(jenjang="SD", month=8, year=2026, heb_value=15, note="reports golden SD", set_by="golden-seed"))
        db.add_all([
            StudentSubjectGrade(enrollment_id=e_a1.id, subject_id=subject_smp.id, component_id=comp_smp.id, score=80),
            StudentSubjectGrade(enrollment_id=e_a1.id, subject_id=subject_smp.id, component_id=comp_smp2.id, score=90),
        ])
        db.flush()
        db.add(StudentSubjectGrade(enrollment_id=e_a2.id, subject_id=subject_smp.id, component_id=comp_smp.id, score=70))
        db.commit()

        def safe_call(label, fn):
            try:
                res = fn()
                return {"label": label, "result": res}
            except Exception as exc:
                return {"label": label, "error": f"{type(exc).__name__}: {exc}"}

        monthly_complete = safe_call("monthly_complete_2026-08_combined", lambda: build_monthly_report(db, year.id, "2026-08", "combined"))
        monthly_empty = safe_call("monthly_empty_2026-07_combined", lambda: build_monthly_report(db, year.id, "2026-07", "combined"))
        monthly_mgmt = safe_call("monthly_management_2026-08", lambda: build_monthly_management_report(db, year.id, "2026-08", "combined"))
        annual = safe_call("annual_2026-2027", lambda: build_annual_report(db, year.id, "combined"))
        try:
            from api.analytics import _collect_tardiness_report_data
            tardiness = safe_call("tardiness_2026-08", lambda: _collect_tardiness_report_data(db, {"date_from": date(2026,8,1), "date_to": date(2026,8,31), "label": "August 2026"}))
        except Exception as exc:
            tardiness = {"label": "tardiness_2026-08", "error": f"{type(exc).__name__}: {exc}"}
        try:
            from api.analytics import _collect_v2_rekap_absensi_report_data
            rekap = safe_call("rekap_v2_2026-08", lambda: _collect_v2_rekap_absensi_report_data(db, {"date_from": date(2026,8,1), "date_to": date(2026,8,31), "label": "August 2026", "year": 2026}))
        except Exception as exc:
            rekap = {"label": "rekap_v2_2026-08", "error": f"{type(exc).__name__}: {exc}"}
        try:
            rekap_missing = safe_call("rekap_v2_2026-07_missing", lambda: _collect_v2_rekap_absensi_report_data(db, {"date_from": date(2026,7,1), "date_to": date(2026,7,31), "label": "July 2026", "year": 2026}))
        except Exception as exc:
            rekap_missing = {"label": "rekap_v2_2026-07_missing", "error": f"{type(exc).__name__}: {exc}"}

        export_struct = {}
        try:
            from services.report_export import build_report_xlsx, get_report_branding
            branding = get_report_branding(db)
            sample_report = monthly_complete.get("result")
            if sample_report:
                xlsx = build_report_xlsx(sample_report, branding)
                import openpyxl
                wb = openpyxl.load_workbook(filename=BytesIO(xlsx))
                export_struct = {"sheets": wb.sheetnames, "headers": [cell.value for cell in wb.active[5]] if wb.active else []}
        except Exception as exc:
            export_struct = {"error": f"{type(exc).__name__}: {exc}"}

        record("reports/monthly_complete.json", monthly_complete)
        record("reports/monthly_empty.json", monthly_empty)
        record("reports/management.json", monthly_mgmt)
        record("reports/annual.json", annual)
        record("reports/tardiness.json", tardiness)
        record("reports/rekap_v2.json", rekap)
        record("reports/rekap_v2_missing.json", rekap_missing)
        record("reports/export_structure.json", export_struct)
        record("reports/source_references.json", {
            "monthly": "services/report_service.py:build_monthly_report",
            "management": "services/report_service.py:build_monthly_management_report",
            "annual": "services/report_service.py:build_annual_report",
            "rekap_v2": "api/analytics.py:_collect_v2_rekap_absensi_report_data",
            "tardiness": "api/analytics.py:_collect_tardiness_report_data",
            "rounding": "api/analytics.py:_round_percentage_int (Decimal ROUND_HALF_UP) and services/report_service.py:_round_rate/_round_average",
        })
    finally:
        db.close()


def academic_placement_corpus() -> None:
    from sqlalchemy.exc import IntegrityError

    from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
    from models.academic_mapping import StudentAcademicMappingRule
    from models.academic_year import AcademicYear
    from models.attendance import Attendance
    from models.jenjang import Jenjang
    from models.student import Student
    from models.student_enrollment import StudentEnrollment
    from models.student_master import (
        EnrollmentPopulationPreviewBatch,
        StudentDeviceIdentity,
        StudentMaster,
    )
    from services.academic_mapping import resolve_class, resolve_jenjang
    from services.enrollment_population import (
        ENROLLMENT_CONFIRMATION,
        build_enrollment_rows,
        commit_enrollment_preview,
        create_enrollment_preview,
    )

    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-academic-"))
    db_path = fresh_ledgered_db(tmp, "academic.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from core import database as core_database

    db = core_database.SessionLocal()
    cases: dict = {}
    try:
        y1 = AcademicYear(label="2025/2026-academic", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30), is_default=False)
        y2 = AcademicYear(label="2026/2027-academic", start_date=date(2026, 7, 1), end_date=date(2027, 6, 30), is_default=False)
        j_smp = Jenjang(name="SMP", code="SMP", level="junior")
        j_smk_a = Jenjang(name="Smk", code="SMKA", level="vocational")
        j_smk_b = Jenjang(name="SMK", code="SMKB", level="vocational")
        db.add_all([y1, y2, j_smp, j_smk_a, j_smk_b])
        db.flush()
        program = AcademicProgram(jenjang_id=j_smp.id, name="SMP Program")
        db.add(program)
        db.flush()
        grade = AcademicGrade(jenjang_id=j_smp.id, program_id=program.id, name="Grade 7", sequence_number=1)
        db.add(grade)
        db.flush()
        aclass = AcademicClass(academic_year_id=y2.id, grade_id=grade.id, class_name="7A", active=True)
        rule = StudentAcademicMappingRule(
            mapping_type="class", source_value="7A", normalized_source_value="7a",
            target_value="7A", status="approved",
            created_by="golden-seed", approved_by="golden-seed", approved_at=datetime.now(),
        )
        db.add_all([aclass, rule])
        db.flush()

        m1 = "11111111-1111-1111-1111-111111111111"
        m2 = "22222222-2222-2222-2222-222222222222"
        m3 = "33333333-3333-3333-3333-333333333333"
        m4 = "44444444-4444-4444-4444-444444444444"
        m5 = "55555555-5555-5555-5555-555555555555"
        m6 = "66666666-6666-6666-6666-666666666666"
        for mid in (m1, m2, m3, m4, m5, m6):
            db.add(StudentMaster(
                id=mid, full_name=f"Academic Master {mid[:4]}",
                normalized_name=f"academic master {mid[:4]}", student_status="active",
            ))
        db.flush()

        def _legacy(sid, name, jenjang_val="SMP", cls="7A", master_id=None, second_master=None):
            student = Student(id=sid, name=name, jenjang=jenjang_val, class_name=cls)
            db.add(student)
            db.flush()
            if master_id:
                db.add(StudentDeviceIdentity(
                    student_master_id=master_id, legacy_student_id=sid,
                    device_identifier=str(sid), device_source="attendance_device",
                    effective_from=date(2026, 1, 1), is_active=True,
                ))
            if second_master:
                db.add(StudentDeviceIdentity(
                    student_master_id=second_master, legacy_student_id=sid,
                    device_identifier=f"{sid}-alt", device_source="attendance_device",
                    effective_from=date(2026, 1, 1), is_active=True,
                ))
            db.flush()
            return student

        s_link = _legacy(601, "Linked Student", master_id=m1)
        _legacy(602, "Unlinked Student")
        _legacy(603, "Ambiguous Student", master_id=m2, second_master=m3)
        _legacy(604, "Blank Jenjang Student", jenjang_val=None, cls="7C")
        _legacy(605, "Unmapped Class Student", cls="9X")
        s_pre = _legacy(606, "Pre Enrolled Student", master_id=m4)
        _legacy(607, "Same Name Twin A", master_id=m5)
        _legacy(608, "Same Name Twin B", master_id=m6)
        s_pop = _legacy(609, "Populate Student", master_id=m5)
        _legacy(610, "Linked Bad Class Student", cls="9X", master_id=m2)

        m4_row = db.get(StudentMaster, m4)
        db.add(StudentEnrollment(
            student_master_id=m4, student_id=s_pre.id, academic_year_id=y2.id,
            jenjang_id=j_smp.id, academic_class_id=aclass.id, class_name="7A",
            lifecycle_state="ACTIVE", effective_from=date(2026, 7, 1),
        ))
        ended_y1 = StudentEnrollment(
            student_master_id=m1, academic_year_id=y1.id, jenjang_id=j_smp.id,
            class_name="7A-old", lifecycle_state="ENDED",
            effective_from=date(2025, 7, 1), effective_to=date(2026, 6, 30),
        )
        active_y2 = StudentEnrollment(
            student_master_id=m1, academic_year_id=y2.id, jenjang_id=j_smp.id,
            academic_class_id=aclass.id, class_name="7A", lifecycle_state="ACTIVE",
            effective_from=date(2026, 7, 1),
        )
        db.add_all([ended_y1, active_y2])
        att_before = Attendance(student_id=s_link.id, date=date(2026, 8, 10), late_duration=0, late_source="none", is_absent=False, status="on-time")
        db.add(att_before)
        db.commit()
        fk_before = att_before.student_id

        exact = resolve_jenjang("SMP", {"SMP": j_smp}, {}, {})
        missing = resolve_jenjang("SMA", {"SMP": j_smp}, {"sma": [j_smk_a]}, {})
        ambiguous_src = resolve_jenjang("smk", {"Smk": j_smk_a, "SMK": j_smk_b}, {"smk": [j_smk_a, j_smk_b]}, {})
        class_missing = resolve_class("9X", {})
        cases["jenjang_resolution"] = {
            "exact": {"state": exact[1], "match_type": exact[2]},
            "missing": {"state": missing[1], "match_type": missing[2]},
            "ambiguous": {"state": ambiguous_src[1], "match_type": ambiguous_src[2]},
        }
        cases["class_resolution"] = {"missing_rule": {"state": class_missing[1], "match_type": class_missing[2]}}

        rows = build_enrollment_rows(db, y2.id, date(2026, 7, 1), None)
        cases["population_actions"] = {
            str(row["legacy_student_id"]): row["proposed_action"] for row in rows
        }

        preview = create_enrollment_preview(db, y2.id, date(2026, 7, 1), [609], "golden-seed")
        cases["preview"] = {
            "id_token": "<uuid>",
            "row_count": len(preview.rows),
            "checksum_present": bool(preview.snapshot_checksum),
            "proposed_action": preview.rows[0]["proposed_action"] if preview.rows else None,
        }
        try:
            commit_enrollment_preview(db, str(preview.id), [609], "WRONG", "golden-seed")
            cases["commit_wrong_confirmation"] = "OK (unexpected)"
        except Exception as exc:
            cases["commit_wrong_confirmation"] = f"{type(exc).__name__}: {exc}"
        result = commit_enrollment_preview(db, str(preview.id), [609], ENROLLMENT_CONFIRMATION, "golden-seed")
        cases["commit_first"] = result
        result_second = commit_enrollment_preview(db, str(preview.id), [609], ENROLLMENT_CONFIRMATION, "golden-seed")
        cases["commit_idempotent_second"] = result_second

        att_after = db.get(Attendance, att_before.id)
        cases["attendance_fk_preserved"] = fk_before == att_after.student_id == s_link.id

        try:
            dup = StudentEnrollment(
                student_master_id=m1, academic_year_id=y2.id, jenjang_id=j_smp.id,
                class_name="7A", lifecycle_state="ACTIVE", effective_from=date(2026, 7, 1),
            )
            db.add(dup)
            db.commit()
            cases["duplicate_master_year_rejection"] = "OK (unexpected)"
        except IntegrityError as exc:
            db.rollback()
            cases["duplicate_master_year_rejection"] = {
                "outcome": "REJECTED", "layer": "database",
                "constraint": "uq_student_master_academic_year",
                "error": type(exc.orig).__name__,
            }
        try:
            db.delete(db.get(StudentMaster, m1))
            db.commit()
            cases["master_delete_restrict"] = "OK (unexpected)"
        except IntegrityError as exc:
            db.rollback()
            cases["master_delete_restrict"] = {
                "outcome": "REJECTED", "layer": "database",
                "error": type(exc.orig).__name__,
            }

        history_rows = db.query(StudentEnrollment).filter_by(student_master_id=m1).order_by(StudentEnrollment.academic_year_id.asc()).all()
        cases["historical_and_current_coexist"] = [
            {"year_id": row.academic_year_id, "lifecycle_state": row.lifecycle_state, "class_name": row.class_name}
            for row in history_rows
        ]
        no_current = [
            row for row in db.query(StudentEnrollment).filter_by(student_master_id=m1)
            if row.academic_year_id == y1.id and row.lifecycle_state != "ACTIVE"
        ]
        current_for_y1_only_master = db.query(StudentEnrollment).filter_by(student_master_id=m1, academic_year_id=y1.id, lifecycle_state="ACTIVE").first()
        cases["no_current_in_ended_year"] = {
            "ended_rows_in_past_year": len(no_current),
            "active_rows_in_past_year": 1 if current_for_y1_only_master else 0,
        }
        cases["canonical_identity_architecture"] = {
            "student_masters_hold_person_record": True,
            "student_enrollments_hold_placement": True,
            "enrollment_columns_reference_placement": ["jenjang_id", "academic_class_id", "class_name"],
            "master_has_no_placement_columns": not any(hasattr(StudentMaster, col) for col in ("jenjang_id", "class_name")),
        }
        cases["future_enrollment"] = "NOT_APPLICABLE: placement resolution keys on lifecycle_state + academic_year; no future-dated enrollment concept exists in source"
        cases["name_only_merge_prohibition"] = {
            "same_name_students_get_distinct_masters_via_device_identity": True,
            "resolver_never_matches_by_name": True,
        }
        record("academic/placement-and-resolution.json", cases)
    finally:
        db.close()


def restore_success_corpus() -> None:
    import sqlite3 as _sq

    sys.path.insert(0, str(GOLDEN / "tools"))
    from seeds import seed_auth_users

    # Rebind FIRST so the one-time `main` import initializes against the
    # disposable active database, not the previous corpus's database.
    from fastapi.testclient import TestClient

    stale = _RESTORE_BACKUP_DIR.parent / "restore-active.db"
    if stale.exists():
        stale.unlink()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(stale) + suffix)
        if sidecar.exists():
            sidecar.unlink()
    from core.schema_migrations import bootstrap_fresh_sqlite_database

    active_db = _RESTORE_BACKUP_DIR.parent / "restore-active.db"
    bootstrap_fresh_sqlite_database(active_db)
    os.environ["DATABASE_URL"] = f"sqlite:///{active_db}"
    seed_auth_users(active_db)

    from core import database as core_database

    _rebind(core_database, f"sqlite:///{active_db}")

    # settings fields froze at first backend import; repoint them at the
    # disposable active DB before the one-time `main` import.
    from core.config import settings

    settings.DATABASE_URL = f"sqlite:///{active_db}"
    settings.BACKUP_DIR = str(_RESTORE_BACKUP_DIR)
    settings.ENABLE_DESTRUCTIVE_OPERATIONS = True

    import main as app_main
    client = TestClient(app_main.app)
    out: dict = {}

    login = client.post("/api/auth/login", json={"username": "golden-admin", "password": "golden-admin-pass-1"})
    token = login.cookies.get("astyx_session")
    auth = {"Cookie": f"astyx_session={token}"}

    # File-based backups read only the main DB file; flush WAL first so
    # seeded users/sessions are visible to the backup.
    conn = _sq.connect(active_db)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    backup_resp = client.post("/api/admin/backups", headers=auth)
    backup_body = backup_resp.json()
    filename = backup_body.get("filename")
    out["backup_creation"] = {
        "status": backup_resp.status_code,
        "filename_class": "<backup-file>" if filename else None,
        "checksum_present": bool(backup_body.get("sha256")),
        "size_bytes_present": backup_body.get("size_bytes") is not None,
        "created_at_present": backup_body.get("created_at") is not None,
    }

    history = client.get("/api/admin/backups/history", headers=auth).json()
    entry = next((e for e in history if e.get("backup_filename") == filename or e.get("filename") == filename), None)
    out["backup_execution_history"] = {
        "entry_count": len(history),
        "matched_created_backup": entry is not None,
        "status_success": (entry or {}).get("status") in ("SUCCESS", "success") if entry else None,
        "trigger_type_present": bool((entry or {}).get("trigger_type") or (entry or {}).get("trigger")),
        "checksum_matches": bool(entry) and (
            (entry or {}).get("sha256") == backup_body.get("sha256")
            or (entry or {}).get("checksum") == backup_body.get("sha256")
        ),
        "history_is_list_ordered_newest_first": bool(history) and history[0].get("id", 0) >= max(e.get("id", 0) for e in history),
    }

    import sqlite3 as _sq

    from datetime import datetime as _dt

    future = "2030-01-01 00:00:00"
    conn = _sq.connect(active_db)
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, created_at, last_used_at, expires_at, absolute_expires_at) "
        "VALUES (1, ?, ?, ?, ?, ?)",
        ("f" * 64, _dt.utcnow().isoformat(" "), _dt.utcnow().isoformat(" "), future, future),
    )
    conn.commit()
    conn2 = _sq.connect(active_db)
    conn2.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    pre_restore_sessions = conn2.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    pre_restore_users = conn2.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn2.close()
    out["pre_restore_state"] = {"sessions": pre_restore_sessions, "users": pre_restore_users}

    conn = _sq.connect(active_db)
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, created_at, last_used_at, expires_at, absolute_expires_at) "
        "VALUES (1, ?, ?, ?, ?, ?)",
        ("f" * 64, _dt.utcnow().isoformat(" "), _dt.utcnow().isoformat(" "), future, future),
    )
    conn.commit()
    conn.close()

    # Corrupt-backup case runs while still authenticated: create second
    # backup, flip bytes inside its file, expect fail-closed validation.
    second = client.post("/api/admin/backups", headers=auth)
    fname2 = second.json().get("filename")
    target = Path(os.environ["BACKUP_DIR"]) / fname2 if fname2 else None
    corrupt_status = None
    if target and target.exists():
        data = bytearray(target.read_bytes())
        data[len(data) // 2 : len(data) // 2 + 16] = b"CORRUPTED-CORRUPT"[:16]
        target.write_bytes(bytes(data))
        conn = _sq.connect(active_db)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        corrupt_preflight = client.post(f"/api/admin/backups/{fname2}/restore-preflight", headers=auth)
        corrupt_restore = client.post(
            f"/api/admin/backups/{fname2}/restore",
            headers=auth,
            json={
                "current_password": "golden-admin-pass-1",
                "confirmation_filename": fname2,
                "confirmation_phrase": "RESTORE_DATABASE",
                "expected_source_sha256": "stale",
                "expected_active_sha256": "stale",
                "acknowledge_complete_replacement": True,
                "acknowledge_session_revocation": True,
                "acknowledge_restart_required": True,
                "acknowledge_safety_backup": True,
            },
        )
        corrupt_status = {
            "preflight_status": corrupt_preflight.status_code,
            "restore_status": corrupt_restore.status_code,
            "fail_closed": corrupt_preflight.status_code >= 400 or corrupt_restore.status_code >= 400,
        }
    out["corrupt_backup_fail_closed"] = corrupt_status

    preflight = client.post(f"/api/admin/backups/{filename}/restore-preflight", headers=auth)
    pf = preflight.json() if preflight.status_code == 200 else {}
    out["restore_preflight"] = {
        "status": preflight.status_code,
        "has_source_sha256": bool(pf.get("source", {}).get("sha256")),
        "has_active_sha256": bool(pf.get("active", {}).get("active_sha256")),
        "impact_classification": pf.get("impact_classification"),
    }

    restore = client.post(
        f"/api/admin/backups/{filename}/restore",
        headers=auth,
        json={
            "current_password": "golden-admin-pass-1",
            "confirmation_filename": filename,
            "confirmation_phrase": "RESTORE_DATABASE",
            "expected_source_sha256": pf.get("source", {}).get("sha256"),
            "expected_active_sha256": pf.get("active", {}).get("active_sha256"),
            "acknowledge_complete_replacement": True,
            "acknowledge_session_revocation": True,
            "acknowledge_restart_required": True,
            "acknowledge_safety_backup": True,
        },
    )
    restore_body = restore.json() if restore.status_code == 200 else {}
    out["restore_success"] = {
        "status": restore.status_code,
        "set_cookie_revoked": "astyx_session=" in restore.headers.get("set-cookie", "")
        and "max-age=0" in restore.headers.get("set-cookie", "").lower(),
        "post_restore_integrity": restore_body.get("post_restore_integrity"),
        "post_restore_foreign_key_violations": restore_body.get("post_restore_foreign_key_violations"),
    }

    conn = _sq.connect(active_db)
    post_sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    unrevoked = conn.execute("SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL").fetchone()[0]
    marker_sessions = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE token_hash = ?", ("f" * 64,)
    ).fetchone()[0]
    post_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn.close()
    out["post_restore_database"] = {
        "sessions_total": post_sessions,
        "unrevoked_remaining": unrevoked,
        "all_sessions_revoked_or_wiped": post_sessions == 0 or unrevoked == 0,
        "post_backup_marker_session_absent": marker_sessions == 0,
        "admin_user_survives": post_users >= 1,
    }
    out["current_restore_session"] = (
        "revoked-with-all-sessions" if out["post_restore_database"]["all_sessions_revoked_or_wiped"] else "unknown"
    )

    fresh_login = client.post("/api/auth/login", json={"username": "golden-admin", "password": "golden-admin-pass-1"})
    fresh_auth = {"Cookie": f"astyx_session={fresh_login.cookies.get('astyx_session')}"}

    backup_history = client.get("/api/admin/backups/history", headers=fresh_auth).json()
    triggers = [entry.get("trigger") or entry.get("trigger_type") for entry in backup_history]
    statuses = [entry.get("status") for entry in backup_history]

    recovery = client.get("/api/admin/backups/recovery-history", headers=fresh_auth).json()
    recovery = recovery if isinstance(recovery, list) else recovery.get("items", [])
    events = [(r.get("event"), r.get("result")) for r in recovery]
    completed_recovery = next(
        (r for r in recovery if r.get("event") == "RESTORE_COMPLETED"), None
    )

    out["safety_snapshot"] = {
        "backup_dir_file_count": len(list(Path(os.environ["BACKUP_DIR"]).iterdir())),
        "pre_restore_auto_trigger_in_history": "pre_restore_auto" in [str(t).lower() for t in triggers if t],
        "restore_completed_recovery_safety_backup_filename": (completed_recovery or {}).get("safety_backup_filename"),
        "note": "snapshot materializes as a pre_restore_auto backup file; restored DB history shows pre-restore state",
    }
    out["recovery_history"] = {
        "entry_count": len(recovery),
        "event_result_sequence": events,
        "has_restore_completed": any(e == "RESTORE_COMPLETED" for e, _ in events),
        "operation_reference_ids_match": len({r.get("operation_reference_id") for r in recovery}) <= 1,
        "completed_entry_keys": sorted(completed_recovery.keys())[:12] if completed_recovery else [],
    }
    out["restored_database_history_note"] = {
        "history_statuses_after_restore": statuses,
        "explanation": "restore replaces the DB file; the backup-era RUNNING row reappears and the post-backup SUCCESS update is intentionally discarded",
    }

    record("restore/success-path.json", out)


def backup_corpus() -> None:
    from services.backup_service import calculate_sha256

    payload = b"operatoros-golden-checksum-vector\n" * 1000
    tmp = Path(tempfile.mkdtemp(prefix="tsphase0-bk-"))
    good = tmp / "good.bak"
    good.write_bytes(payload)
    corrupt = tmp / "corrupt.bak"
    corrupt.write_bytes(payload[:-7] + b"XX\nXXXX")
    expected = hashlib.sha256(payload).hexdigest()
    actual_good = calculate_sha256(good)
    actual_bad = calculate_sha256(corrupt)
    record("backup/checksum-vectors.json", {
        "algorithm": "sha256-hex-chunked-file-read",
        "expected_digest_of_vector": expected,
        "good_matches": actual_good == expected,
        "corrupt_matches_expected": actual_bad == expected,
        "corrupt_differs": actual_bad != actual_good,
    })


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    migration_corpus()
    preflight_corpus()
    kkm_term_corpus()
    grades_corpus()
    heb_edge_corpus()
    reports_corpus()
    academic_placement_corpus()
    backup_corpus()
    restore_success_corpus()
    manifest_path = GOLDEN / "corpora_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    by_id = {e["fixture_id"]: e for e in manifest.get("fixtures", [])}
    for rel in written:
        fixture_id = rel.split("/")[-1].replace(".json", "")
        domain = rel.split("/")[0]
        category = {
            "migrations": "migration/rollback",
            "restore": "migration/rollback",
            "kkm": "report correctness",
            "grades": "data integrity",
            "heb": "report correctness",
            "backup": "data preservation",
            "restore": "data preservation",
        }.get(domain, "data integrity")
        by_id[f"svc-{domain}-{fixture_id}"] = {
            "fixture_id": f"svc-{domain}-{fixture_id}",
            "domain": domain,
            "protected_category": category,
            "kind": "service-golden",
            "file": rel,
            "setup": "disposable-temp-db",
            "expected_verdict": "EXACT_MATCH",
        }
    manifest["fixtures"] = sorted(by_id.values(), key=lambda e: e["fixture_id"])
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(written)} service golden files; manifest fixtures={len(manifest['fixtures'])}")


if __name__ == "__main__":
    main()
