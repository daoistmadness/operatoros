"""Service-level Phase 0 goldens: migrations, restore preflight, KKM/terms,
grades constraints, HEB rounding edges, backup checksums.

Usage:
    cd backend && .venv/bin/python ../docs/migration/ts-backend/golden/tools/generate_phase0_corpora.py

Safety: disposable temp-file SQLite only; protected DB never addressed.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import timedelta
import sys
import tempfile
from datetime import date
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
os.environ.setdefault("OPERATOROS_ISOLATED_TEST", "true")
os.environ.setdefault("ALLOW_LEGACY_STARTUP_SCHEMA_MUTATION", "true")

written: list[str] = []


def dump(obj) -> str:
    return json.dumps(obj, indent=2, default=str, sort_keys=True) + "\n"


def _sanitize(value, key: str = ""):
    import re

    if isinstance(value, dict):
        return {k: _sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v, key) for v in value]
    if isinstance(value, str):
        value = re.sub(r"/(?:tmp|home)/[A-Za-z0-9_./-]+", "<path>", value)
        value = re.sub(r"Free bytes: \d+", "Free bytes: <free>", value)
        keep_digest = any(t in key.lower() for t in ("digest", "checksum", "sha"))
        if not keep_digest:
            value = re.sub(r"\b[0-9a-f]{64}\b", "<sha256>", value)
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
    backup_corpus()
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
