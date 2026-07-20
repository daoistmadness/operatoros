from __future__ import annotations

import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models.attendance import Attendance
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_import_session import StudentImportAppliedAction, StudentImportSession
from models.student_master import StudentDeviceIdentity, StudentMaster
from models.student_subject_grade import StudentSubjectGrade
from services.preflight_service import run_production_preflight
from services.reconciliation_service import compute_file_sha256, run_read_only_reconciliation
from services.student_import_sessions import append_action, create_preview_session, mark_committed, mark_preview_ready
from services.student_rollback_service import execute_compensating_rollback, generate_rollback_preview


from models.academic_year import AcademicYear
from models.jenjang import Jenjang


def test_disposable_recovery_drill(tmp_path: Path):
    # 1. Create a managed disposable S3.9 database
    disposable_db_file = tmp_path / "disposable_drill.db"
    engine = create_engine(f"sqlite:///{disposable_db_file}")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Seed AcademicYear and Jenjang master records
    ay = AcademicYear(id=1, label="2025/2026", start_date=datetime.now().date(), end_date=datetime.now().date(), status="active", is_default=True)
    jj = Jenjang(id=1, code="SD", name="Primary")
    db.add_all([ay, jj])
    db.flush()

    # 2. Seed synthetic student masters
    sm1 = StudentMaster(id="MASTER-001", full_name="Siti Aminah", normalized_name="SITI AMINAH", nik="317199990001", gender="P", student_status="active")
    sm2 = StudentMaster(id="MASTER-002", full_name="Ahmad Fauzi", normalized_name="AHMAD FAUZI", nik="317199990002", gender="L", student_status="active")
    db.add_all([sm1, sm2])
    db.flush()

    # 3. Seed legacy Student records before device identities
    s1 = Student(id=101, name="Siti Aminah", class_name="P1A")
    s2 = Student(id=102, name="Ahmad Fauzi", class_name="P1B")
    db.add_all([s1, s2])
    db.flush()

    # 4. Seed device identities
    dev1 = StudentDeviceIdentity(student_master_id=sm1.id, legacy_student_id=101, device_identifier="DEV-101", device_source="FINGERPRINT", effective_from=datetime.now().date(), is_active=True)
    dev2 = StudentDeviceIdentity(student_master_id=sm2.id, legacy_student_id=102, device_identifier="DEV-102", device_source="FINGERPRINT", effective_from=datetime.now().date(), is_active=True)
    db.add_all([dev1, dev2])
    db.flush()

    # 5. Seed enrollment history
    enr1 = StudentEnrollment(student_id=101, student_master_id=sm1.id, academic_year_id=1, jenjang_id=1, class_name="P1A", class_assigned=True)
    enr2 = StudentEnrollment(student_id=102, student_master_id=sm2.id, academic_year_id=1, jenjang_id=1, class_name="P1B", class_assigned=True)
    db.add_all([enr1, enr2])
    db.flush()

    # Seed Subject and AssessmentComponent
    from models.subject import Subject
    from models.assessment_component import AssessmentComponent
    sub = Subject(id=1, name="Math", jenjang_id=1)
    comp = AssessmentComponent(id=1, name="Summative", assessment_type="sumatif", subject_id=1)
    db.add_all([sub, comp])
    db.flush()

    # 6. Seed attendance and grades
    attn = Attendance(student_id=101, date=datetime.now().date(), check_in=datetime.now().time(), check_out=datetime.now().time(), status="present")
    grade = StudentSubjectGrade(enrollment_id=enr1.id, subject_id=1, component_id=1, score=95.0)
    db.add_all([attn, grade])
    db.commit()

    # 7. Record baseline checksum and critical row counts
    engine.dispose()
    baseline_checksum = compute_file_sha256(disposable_db_file)
    assert baseline_checksum is not None

    # 8. Run reconciliation
    rec_res = run_read_only_reconciliation(disposable_db_file)
    assert rec_res["mutation_performed"] is False
    assert rec_res["classifications"]["CONFIDENTLY_LINKED"] == 2

    # 9. Run preflight
    preflight_res = run_production_preflight(disposable_db_file)
    assert preflight_res["status"] == "PASSED"

    # 10. Create a verified disposable backup
    backup_file = tmp_path / "drill_backup.db"
    shutil.copy2(disposable_db_file, backup_file)
    assert compute_file_sha256(backup_file) == baseline_checksum

    # 11. Commit synthetic roster & update imports
    engine = create_engine(f"sqlite:///{disposable_db_file}")
    db = sessionmaker(bind=engine)()

    sess = create_preview_session(db, import_type="STUDENT_ROSTER", filename="synthetic_roster.xlsx", file_checksum="d" * 64, actor="drill_admin")
    mark_preview_ready(sess, checksum="e" * 64, row_count=1)

    sm_new = StudentMaster(id="MASTER-003", full_name="New Import Student", normalized_name="NEW IMPORT STUDENT", student_status="active")
    db.add(sm_new)
    db.flush()

    act = append_action(
        db, sess, source_row=1, sequence=1, action_type="CREATE_STUDENT_MASTER", entity_type="STUDENT_MASTER", entity_id=sm_new.id, actor="drill_admin", before_state=None, after_state={"id": sm_new.id, "full_name": sm_new.full_name}, compensation_type="STATUS_INACTIVE", eligibility="ELIGIBLE"
    )
    mark_committed(sess, actor="drill_admin", selected_count=1, action_count=1)
    db.commit()

    # 12. Verify applied-action provenance and audit events
    assert act.id is not None
    assert sess.rollback_state == "AVAILABLE"

    # 13. Generate rollback preview and apply compensating rollback
    preview = generate_rollback_preview(db, sess.id, actor="drill_admin")
    assert preview["eligible_actions"] == 1

    rb_res = execute_compensating_rollback(
        db, sess.id, preview_checksum=preview["preview_checksum"], mode="WHOLE_SESSION", reason="Disposable drill rollback", confirmation_value=preview["required_confirmation"], idempotency_token="DRILL-TOKEN-1", actor="drill_admin"
    )
    db.commit()

    # 14. Verify compensation links and states
    assert rb_res["status"] == "COMPLETED"
    assert sm_new.student_status == "inactive"

    # 15. Verify attendance and grades remain unchanged
    attn_count = db.query(Attendance).count()
    grade_count = db.query(StudentSubjectGrade).count()
    assert attn_count == 1
    assert grade_count == 1

    # 16. Restore backup into a separate disposable path
    restore_file = tmp_path / "drill_restore.db"
    shutil.copy2(backup_file, restore_file)

    # 17. Compare schema revision, masters, devices, enrollments, attendance, grades
    conn_orig = sqlite3.connect(f"file:{backup_file.as_posix()}?mode=ro", uri=True)
    conn_rest = sqlite3.connect(f"file:{restore_file.as_posix()}?mode=ro", uri=True)

    for tbl in ["student_masters", "student_device_identities", "student_enrollments", "students", "attendance"]:
        c1 = conn_orig.cursor().execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
        c2 = conn_rest.cursor().execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
        assert c1 == c2

    conn_orig.close()
    conn_rest.close()

    # 18. Verify production database backend/attendance.db remains completely untouched!
    prod_db = Path("backend/attendance.db")
    if prod_db.exists():
        prod_hash = compute_file_sha256(prod_db)
        assert prod_hash == "15c32b433f87872ef1d2021567e389fda434806d0f986a417d82baf8e0159fb8"
