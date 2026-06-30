import importlib
import sys
from datetime import date, time
from pathlib import Path
import pytest
import pandas as pd
import io
import threading

MODULE_PREFIXES = ("src", "api", "core", "models", "services")
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"

if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

def unload_app_modules() -> None:
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)

@pytest.fixture
def clean_db(monkeypatch, tmp_path):
    db_path = tmp_path / "exports_stability.db"
    monkeypatch.syspath_prepend(str(SOURCE_ROOT))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    unload_app_modules()

    db_module = importlib.import_module("core.database")
    db_module.init_db()

    db = db_module.SessionLocal()

    # Import models dynamically after unloading
    AcademicYear = importlib.import_module("models.academic_year").AcademicYear
    Jenjang = importlib.import_module("models.jenjang").Jenjang
    Student = importlib.import_module("models.student").Student
    StudentEnrollment = importlib.import_module("models.student_enrollment").StudentEnrollment
    Attendance = importlib.import_module("models.attendance").Attendance
    Subject = importlib.import_module("models.subject").Subject
    AssessmentComponent = importlib.import_module("models.assessment_component").AssessmentComponent
    StudentSubjectGrade = importlib.import_module("models.student_subject_grade").StudentSubjectGrade
    AcademicIntervention = importlib.import_module("models.academic_intervention").AcademicIntervention

    yield {
        "db": db,
        "AcademicYear": AcademicYear,
        "Jenjang": Jenjang,
        "Student": Student,
        "StudentEnrollment": StudentEnrollment,
        "Attendance": Attendance,
        "Subject": Subject,
        "AssessmentComponent": AssessmentComponent,
        "StudentSubjectGrade": StudentSubjectGrade,
        "AcademicIntervention": AcademicIntervention,
    }
    db.close()


def test_insights_generation_rules(clean_db):
    db = clean_db["db"]
    AcademicYear = clean_db["AcademicYear"]
    Jenjang = clean_db["Jenjang"]
    Student = clean_db["Student"]
    StudentEnrollment = clean_db["StudentEnrollment"]
    Attendance = clean_db["Attendance"]
    Subject = clean_db["Subject"]
    AssessmentComponent = clean_db["AssessmentComponent"]
    StudentSubjectGrade = clean_db["StudentSubjectGrade"]
    AcademicIntervention = clean_db["AcademicIntervention"]

    # Import service functions dynamically to use loaded models/session
    management_analytics = importlib.import_module("services.management_analytics")
    build_management_summary = management_analytics.build_management_summary

    # Seed basic metadata
    ay = db.query(AcademicYear).filter_by(label="2025/2026").first()
    if not ay:
        ay = AcademicYear(label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30))
        db.add(ay)
        db.flush()

    jen = db.query(Jenjang).filter_by(name="Primary").first()
    if not jen:
        jen = Jenjang(name="Primary")
        db.add(jen)
        db.flush()

    # Test 1: Empty grades / No grade records warning
    summary = build_management_summary(db, academic_year_id=ay.id, jenjang_id=jen.id)
    insights = summary["executive_insights"]

    # Should contain "Data Nilai Siswa Kosong" critical insight
    assert any(i["title"] == "Data Nilai Siswa Kosong" and i["severity"] == "critical" for i in insights)
    assert any(i["title"] == "Laporan Tahunan Penuh" and i["severity"] == "info" for i in insights)

    # Test 2: Add attendance records to check low attendance and lateness
    std1 = Student(name="Student A", jenjang="Primary", class_name="P1A")
    std2 = Student(name="Student B", jenjang="Primary", class_name="Unknown") # Unknown class bucket
    db.add_all([std1, std2])
    db.flush()

    en1 = StudentEnrollment(student_id=std1.id, academic_year_id=ay.id, jenjang_id=jen.id, class_name="P1A", class_assigned=True)
    en2 = StudentEnrollment(student_id=std2.id, academic_year_id=ay.id, jenjang_id=jen.id, class_name="Unknown", class_assigned=True)
    db.add_all([en1, en2])
    db.flush()

    # 10 days check-ins. std1 has 6 on-time, 4 late. std2 has 10 absent/late
    # Total hadir pct below target
    db.add_all([
        Attendance(student_id=std1.id, date=date(2025, 10, i), check_in=time(8, 30), status="late", late_duration=30)
        for i in range(1, 6)
    ])
    db.add_all([
        Attendance(student_id=std2.id, date=date(2025, 10, i), check_in=time(7, 30), status="on-time")
        for i in range(1, 5)
    ])
    db.add_all([
        Attendance(student_id=std2.id, date=date(2025, 10, i), check_in=time(9, 0), status="late", late_duration=90)
        for i in range(5, 11)
    ])
    db.flush()

    # Add a Subject
    sub = Subject(name="Math", jenjang_id=jen.id, supports_sumatif=True, supports_formatif=True)
    db.add(sub)
    db.flush()

    # Add interventions
    interv1 = AcademicIntervention(
        student_id=std1.id,
        academic_year_id=ay.id,
        jenjang_id=jen.id,
        subject_id=sub.id,
        class_name="P1A",
        student_name=std1.name,
        subject_name="Math",
        assessment_type="sumatif",
        effective_threshold=85.0,
        threshold_source="kkm_national",
        status="open",
        priority="high",
        follow_up_date=date(2025, 6, 1), # Overdue
    )
    db.add(interv1)
    db.flush()

    comp_sum = AssessmentComponent(name="Sumatif Math", assessment_type="sumatif", subject_id=sub.id)
    comp_for = AssessmentComponent(name="Formatif Math", assessment_type="formatif", subject_id=sub.id)
    db.add_all([comp_sum, comp_for])
    db.flush()

    # std1 got 70 (below fallback KKM 85.0)
    db.add(StudentSubjectGrade(enrollment_id=en1.id, subject_id=sub.id, component_id=comp_sum.id, score=70.0))
    db.add(StudentSubjectGrade(enrollment_id=en1.id, subject_id=sub.id, component_id=comp_for.id, score=90.0)) # gap > 5
    db.flush()

    db.commit()

    summary = build_management_summary(db, academic_year_id=ay.id, jenjang_id=jen.id)
    insights = summary["executive_insights"]

    # Verify Lateness warning is triggered
    assert any("Keterlambatan" in i["title"] for i in insights)
    # Verify Unknown class warning is triggered
    assert any("Unknown" in i["message"] for i in insights)
    # Verify Overdue intervention is critical
    assert any("Tindak Lanjut" in i["title"] and i["severity"] == "critical" for i in insights)
    # Verify Sumatif vs Formatif gap warning is triggered
    assert any("Kesenjangan Nilai" in i["title"] for i in insights)
    # Verify below-KKM alert is present
    assert any("Keterlambatan Akademik" in i["title"] for i in insights)


def test_in_memory_exports_no_disk_output(clean_db):
    db = clean_db["db"]
    AcademicYear = clean_db["AcademicYear"]
    Jenjang = clean_db["Jenjang"]
    Student = clean_db["Student"]
    StudentEnrollment = clean_db["StudentEnrollment"]

    # Import dynamically
    management_analytics = importlib.import_module("services.management_analytics")
    build_management_summary = management_analytics.build_management_summary

    management_report_export = importlib.import_module("services.management_report_export")
    build_management_summary_pdf = management_report_export.build_management_summary_pdf
    build_management_summary_excel = management_report_export.build_management_summary_excel

    ay = db.query(AcademicYear).filter_by(label="2025/2026").first()
    if not ay:
        ay = AcademicYear(label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30))
        db.add(ay)
        db.flush()

    jen = db.query(Jenjang).filter_by(name="Primary").first()
    if not jen:
        jen = Jenjang(name="Primary")
        db.add(jen)
        db.flush()

    std1 = Student(name="St A", jenjang="Primary", class_name="P1A")
    db.add(std1)
    db.flush()

    en1 = StudentEnrollment(student_id=std1.id, academic_year_id=ay.id, jenjang_id=jen.id, class_name="P1A", class_assigned=True)
    db.add(en1)
    db.flush()

    db.commit()

    summary = build_management_summary(db, academic_year_id=ay.id, jenjang_id=jen.id)

    # Test PDF export in-memory bytes
    pdf_bytes = build_management_summary_pdf(summary)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b"%PDF")

    # PDF should contain the printed insights strings
    assert b"REPORT FILTER & CONTEXT PARAMETERS" in pdf_bytes
    assert b"EXECUTIVE ANALYTICS INSIGHTS" in pdf_bytes

    # Test Excel export in-memory bytes
    excel_bytes = build_management_summary_excel(summary, {"mode": "editable"})
    assert len(excel_bytes) > 0

    # Load back with pandas via io.BytesIO (verifies correct in-memory stream signature)
    excel_stream = io.BytesIO(excel_bytes)
    excel_file = pd.ExcelFile(excel_stream, engine="openpyxl")

    # Verify deterministic sheets list
    expected_sheets = ["README", "Config", "Insights", "Attendance_Data", "Lateness_Data", "Grade_Class_Data", "Grade_Subject_Data", "Grade_Student_Data", "Below_KKM_Data", "Interventions_Data", "Charts"]
    for sheet in expected_sheets:
        assert sheet in excel_file.sheet_names

    # Verify Insights sheet content rows
    insights_df = pd.read_excel(excel_stream, sheet_name="Insights", engine="openpyxl")
    assert "Tingkat Keparahan" in insights_df.columns
    assert "Deskripsi Analisis" in insights_df.columns


def test_concurrent_exports_do_not_collide(clean_db):
    db = clean_db["db"]
    AcademicYear = clean_db["AcademicYear"]
    Jenjang = clean_db["Jenjang"]

    # Import dynamically
    management_analytics = importlib.import_module("services.management_analytics")
    build_management_summary = management_analytics.build_management_summary

    management_report_export = importlib.import_module("services.management_report_export")
    build_management_summary_pdf = management_report_export.build_management_summary_pdf
    build_management_summary_excel = management_report_export.build_management_summary_excel

    ay = db.query(AcademicYear).filter_by(label="2025/2026").first()
    if not ay:
        ay = AcademicYear(label="2025/2026", start_date=date(2025, 7, 1), end_date=date(2026, 6, 30))
        db.add(ay)
        db.flush()

    jen = db.query(Jenjang).filter_by(name="Primary").first()
    if not jen:
        jen = Jenjang(name="Primary")
        db.add(jen)
        db.flush()

    db.commit()

    summary = build_management_summary(db, academic_year_id=ay.id, jenjang_id=jen.id)

    errors = []
    def export_worker():
        try:
            p_bytes = build_management_summary_pdf(summary)
            x_bytes = build_management_summary_excel(summary, {"mode": "editable"})
            assert len(p_bytes) > 0
            assert len(x_bytes) > 0
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=export_worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0, f"Concurrency errors detected: {errors}"
