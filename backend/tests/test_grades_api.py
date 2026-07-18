import importlib
import sqlite3
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


MODULE_PREFIXES = ("src", "api", "core", "models", "services")
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"


def unload_app_modules() -> None:
    for name in list(sys.modules):
        if name == "src" or name.startswith(MODULE_PREFIXES):
            sys.modules.pop(name, None)


def prepare_source_imports(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(SOURCE_ROOT))


def create_legacy_grade_table(db_path: Path) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            """
            CREATE TABLE student_term_grades (
                id INTEGER PRIMARY KEY,
                student_id INTEGER NOT NULL,
                academic_year VARCHAR NOT NULL,
                term_1 FLOAT,
                term_2 FLOAT,
                term_3 FLOAT,
                term_4 FLOAT
            )
            """
        )
        connection.execute(
            "INSERT INTO student_term_grades (student_id, academic_year, term_1) VALUES (10001, '2025/2026', 84.0)"
        )
        connection.commit()
    finally:
        connection.close()


@pytest.fixture
def app_context(monkeypatch, tmp_path):
    db_path = tmp_path / "attendance-test.db"
    create_legacy_grade_table(db_path)
    prepare_source_imports(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    unload_app_modules()

    main_module = importlib.import_module("src.main")
    db_module = importlib.import_module("core.database")
    grades_module = importlib.import_module("api.grades")
    students_module = importlib.import_module("api.students")
    student_module = importlib.import_module("models.student")
    academic_year_module = importlib.import_module("models.academic_year")
    jenjang_module = importlib.import_module("models.jenjang")
    subject_module = importlib.import_module("models.subject")
    component_module = importlib.import_module("models.assessment_component")
    enrollment_module = importlib.import_module("models.student_enrollment")
    grade_module = importlib.import_module("models.student_subject_grade")

    return {
        "app": main_module.app,
        "db_module": db_module,
        "grades": grades_module,
        "students": students_module,
        "Student": student_module.Student,
        "AcademicYear": academic_year_module.AcademicYear,
        "Jenjang": jenjang_module.Jenjang,
        "Subject": subject_module.Subject,
        "AssessmentComponent": component_module.AssessmentComponent,
        "StudentEnrollment": enrollment_module.StudentEnrollment,
        "StudentSubjectGrade": grade_module.StudentSubjectGrade,
    }


def seed_grade_masters(context):
    db_module = context["db_module"]
    Student = context["Student"]
    AcademicYear = context["AcademicYear"]
    Jenjang = context["Jenjang"]
    Subject = context["Subject"]
    AssessmentComponent = context["AssessmentComponent"]
    StudentEnrollment = context["StudentEnrollment"]

    session = db_module.SessionLocal()
    try:
        student = Student(id=10001, name="ARK", jenjang="primary", class_name="1A")
        academic_year = AcademicYear(
            label="2026/2027",
            start_date=date(2025, 7, 1),
            end_date=date(2026, 6, 30),
            status="active",
            is_default=False,
        )
        jenjang = Jenjang(name="Test Primary")
        session.add_all([student, academic_year, jenjang])
        session.flush()

        subject = Subject(name="Mathematics", jenjang_id=jenjang.id)
        session.add(subject)
        session.flush()

        component = AssessmentComponent(name="kuis", assessment_type="sumatif", subject_id=None)
        scoped_component = AssessmentComponent(name="project", assessment_type="formatif", subject_id=subject.id)
        session.add_all([component, scoped_component])
        session.flush()

        enrollment = StudentEnrollment(
            student_id=student.id,
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            class_name="1A",
            class_assigned=True,
        )
        session.add(enrollment)
        session.commit()

        return {
            "academic_year_id": academic_year.id,
            "jenjang_id": jenjang.id,
            "subject_id": subject.id,
            "component_id": component.id,
            "scoped_component_id": scoped_component.id,
            "enrollment_id": enrollment.id,
        }
    finally:
        session.close()


def test_dynamic_grade_models_are_created_seeded_and_legacy_table_is_preserved(app_context):
    db_module = app_context["db_module"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]
    Subject = app_context["Subject"]
    AssessmentComponent = app_context["AssessmentComponent"]
    inspector = db_module.inspect(db_module.engine)
    table_names = set(inspector.get_table_names())

    assert "academic_years" in table_names
    assert "jenjangs" in table_names
    assert "subjects" in table_names
    assert "assessment_components" in table_names
    assert "student_enrollments" in table_names
    assert "student_subject_grades" in table_names
    assert "student_term_grades" not in table_names
    assert "student_term_grades_legacy" in table_names

    indexes = {index["name"] for index in inspector.get_indexes("academic_years")}
    assert "uq_academic_year_default" in indexes

    session = db_module.SessionLocal()
    try:
        components = {
            (row.name, row.assessment_type, row.subject_id)
            for row in session.query(AssessmentComponent).all()
        }
        assert ("kuis", "sumatif", None) in components
        assert ("tes", "sumatif", None) in components
        assert ("total", "sumatif", None) in components
        assert ("total", "formatif", None) in components

        primary = session.query(Jenjang).filter(Jenjang.name == "Primary").one_or_none()
        assert primary is not None

        academic_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one_or_none()
        assert academic_year is not None
        assert academic_year.status == "active"
        assert academic_year.is_default is True

        subject = (
            session.query(Subject)
            .filter(Subject.name == "Language", Subject.jenjang_id == primary.id)
            .one_or_none()
        )
        assert subject is not None
        assert subject.supports_sumatif is True
        assert subject.supports_formatif is True
    finally:
        session.close()


def test_grade_routes_are_registered_without_legacy_import_endpoint(app_context):
    route_paths = {route.path for route in app_context["app"].routes}

    assert "/api/grades/ledger" in route_paths
    assert "/api/grades/save" in route_paths
    assert "/api/grades/analytics" in route_paths
    assert "/api/grades/academic-years" in route_paths
    assert "/api/grades/subjects" in route_paths
    assert "/api/grades/components" in route_paths
    assert "/api/grades/jenjangs" in route_paths
    assert "/api/grades/enrollment/candidates" in route_paths
    assert "/api/grades/enrollment/source-classes" in route_paths
    assert "/api/grades/enrollment" in route_paths
    assert "/api/grades/enrollment/bulk" in route_paths
    assert "/api/grades/enrollment/{enrollment_id}" in route_paths
    assert "/api/grades/import" not in route_paths


def test_student_delete_route_is_not_exposed(app_context):
    methods_by_path = {}
    for route in app_context["app"].routes:
        methods_by_path.setdefault(route.path, set()).update(getattr(route, "methods", set()))

    student_delete_paths = {
        path: methods
        for path, methods in methods_by_path.items()
        if path.startswith("/students")
    }

    assert all("DELETE" not in methods for methods in student_delete_paths.values())
    assert "/students/{student_id}" not in student_delete_paths
    assert "/students/{id}" not in student_delete_paths


def test_mapping_class_update_preserves_grade_history(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    students_api = app_context["students"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
      # add one grade row so the ledger has persisted history before mapping changes
        session.add(
            StudentSubjectGrade(
                enrollment_id=ids["enrollment_id"],
                subject_id=ids["subject_id"],
                component_id=ids["component_id"],
                score=88.0,
            )
        )
        session.commit()

        result = students_api.set_class(
            students_api.SetClassBody(
                student_id=10001,
                class_name="2B",
                jenjang="primary",
            ),
            db=session,
        )
        assert "2B" in result["message"]

        ledger = grades_api.get_grade_ledger(academic_year_id=ids["academic_year_id"], jenjang_id=None, db=session)
        assert len(ledger) == 1
        assert ledger[0]["student_id"] == 10001
        assert ledger[0]["grades"][0]["score"] == 88.0
        assert (
            session.query(StudentSubjectGrade)
            .filter(StudentSubjectGrade.enrollment_id == ids["enrollment_id"])
            .count()
            == 1
        )
    finally:
        session.close()


def test_grade_metadata_routes_are_registered_through_main_app(app_context):
    methods_by_path = {}
    for route in app_context["app"].routes:
        methods_by_path.setdefault(route.path, set()).update(getattr(route, "methods", set()))

    assert "GET" in methods_by_path["/api/grades/academic-years"]
    assert "POST" in methods_by_path["/api/grades/academic-years"]
    assert "GET" in methods_by_path["/api/grades/subjects"]
    assert "POST" in methods_by_path["/api/grades/subjects"]
    assert "GET" in methods_by_path["/api/grades/components"]

    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Jenjang = app_context["Jenjang"]

    session = db_module.SessionLocal()
    try:
        primary = session.query(Jenjang).filter(Jenjang.name == "Primary").one()
        jenjang_id = primary.id
        years = grades_api.get_academic_years(db=session)
        subjects = grades_api.get_subjects(jenjang_id=jenjang_id, db=session)
        components = grades_api.get_components(db=session)

        assert any(year["label"] == "2025/2026" and year["status"] == "active" and year["is_default"] for year in years)
        assert any(subject["name"] == "Language" and subject["jenjang_id"] == jenjang_id for subject in subjects)
        assert any(component["name"] == "kuis" and component["assessment_type"] == "sumatif" for component in components)
    finally:
        session.close()


def test_create_academic_year_rejects_duplicates_and_preserves_single_default(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    AcademicYear = app_context["AcademicYear"]

    session = db_module.SessionLocal()
    try:
        first = grades_api.create_academic_year(
            grades_api.AcademicYearCreateRequest(
                label="2027/2028",
                start_date=date(2027, 7, 1),
                end_date=date(2028, 6, 30),
                status="active",
                is_default=False,
            ),
            db=session,
        )
        assert first["label"] == "2027/2028"
        assert first["is_default"] is False

        with pytest.raises(HTTPException) as duplicate_error:
            grades_api.create_academic_year(
                grades_api.AcademicYearCreateRequest(
                    label="2027/2028",
                    start_date=date(2027, 7, 1),
                    end_date=date(2028, 6, 30),
                    status="active",
                    is_default=False,
                ),
                db=session,
            )
        assert duplicate_error.value.status_code == 409

        second_default = grades_api.create_academic_year(
            grades_api.AcademicYearCreateRequest(
                label="2028/2029",
                start_date=date(2028, 7, 1),
                end_date=date(2029, 6, 30),
                status="active",
                is_default=True,
            ),
            db=session,
        )
        assert second_default["is_default"] is True

        default_years = session.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).all()
        assert len(default_years) == 1
        assert default_years[0].label == "2028/2029"

        bootstrap_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one()
        assert bootstrap_year.is_default is False
    finally:
        session.close()


def test_create_academic_year_rejects_invalid_date_range(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]

    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as invalid_error:
            grades_api.create_academic_year(
                grades_api.AcademicYearCreateRequest(
                    label="2030/2029",
                    start_date=date(2030, 7, 1),
                    end_date=date(2029, 6, 30),
                    status="active",
                    is_default=False,
                ),
                db=session,
            )
        assert invalid_error.value.status_code == 400
    finally:
        session.close()


def test_create_subject_validates_jenjang_and_duplicate_compound_key(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Jenjang = app_context["Jenjang"]

    session = db_module.SessionLocal()
    try:
        primary = session.query(Jenjang).filter(Jenjang.name == "Primary").one()
        created = grades_api.create_subject(
            grades_api.SubjectCreateRequest(
                name="Science",
                jenjang_id=primary.id,
                supports_sumatif=True,
                supports_formatif=False,
            ),
            db=session,
        )
        assert created["name"] == "Science"
        assert created["jenjang_id"] == primary.id
        assert created["supports_sumatif"] is True
        assert created["supports_formatif"] is False

        subjects = grades_api.get_subjects(jenjang_id=primary.id, db=session)
        assert any(subject["name"] == "Science" for subject in subjects)

        with pytest.raises(HTTPException) as duplicate_error:
            grades_api.create_subject(
                grades_api.SubjectCreateRequest(
                    name="Science",
                    jenjang_id=primary.id,
                    supports_sumatif=True,
                    supports_formatif=True,
                ),
                db=session,
            )
        assert duplicate_error.value.status_code == 409

        with pytest.raises(HTTPException) as missing_jenjang_error:
            grades_api.create_subject(
                grades_api.SubjectCreateRequest(
                    name="Science",
                    jenjang_id=99999,
                    supports_sumatif=True,
                    supports_formatif=True,
                ),
                db=session,
            )
        assert missing_jenjang_error.value.status_code == 404
    finally:
        session.close()


def test_enrollment_candidates_exclude_students_already_enrolled(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Student = app_context["Student"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]
    StudentEnrollment = app_context["StudentEnrollment"]

    session = db_module.SessionLocal()
    try:
        from models.academic_master import AcademicProgram, AcademicGrade, AcademicClass
        from models.student_master import StudentMaster, StudentDeviceIdentity
        import uuid
        academic_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one()
        jenjang = session.query(Jenjang).filter(Jenjang.name == "Primary").one()

        program = AcademicProgram(
            jenjang_id=jenjang.id,
            name="General Program",
            active=True
        )
        session.add(program)
        session.flush()

        grade = AcademicGrade(
            jenjang_id=jenjang.id,
            program_id=program.id,
            name="Grade 1",
            sequence_number=1,
            active=True
        )
        session.add(grade)
        session.flush()

        class_row = AcademicClass(
            academic_year_id=academic_year.id,
            grade_id=grade.id,
            class_name="1-A",
            active=True
        )
        session.add(class_row)
        session.flush()

        def create_master(student_obj):
            m = StudentMaster(
                id=str(uuid.uuid4()),
                full_name=student_obj.name,
                normalized_name=student_obj.name.strip().casefold(),
                gender="L",
                student_status="active"
            )
            session.add(m)
            session.flush()
            device_id = StudentDeviceIdentity(
                student_master_id=m.id,
                legacy_student_id=student_obj.id,
                device_identifier=str(student_obj.id),
                device_source="tap",
                effective_from=date(2025, 7, 1),
                is_active=True
            )
            session.add(device_id)
            session.flush()
            return m

        enrolled = Student(id=20001, name="Already Enrolled", jenjang="primary", class_name="P1A")
        candidate_p1a = Student(id=20002, name="Candidate Student P1A", jenjang="primary", class_name="P1A")
        candidate_p3 = Student(id=20003, name="Candidate Student P3", jenjang="primary", class_name="P3")
        session.add_all([enrolled, candidate_p1a, candidate_p3])
        session.flush()

        enrolled_master = create_master(enrolled)
        candidate_p1a_master = create_master(candidate_p1a)
        candidate_p3_master = create_master(candidate_p3)

        session.add(
            StudentEnrollment(
                student_id=enrolled.id,
                student_master_id=enrolled_master.id,
                academic_year_id=academic_year.id,
                academic_class_id=class_row.id,
                jenjang_id=jenjang.id,
                class_name="1-A",
                class_assigned=True,
            )
        )
        session.commit()

        candidates = grades_api.get_enrollment_candidates(
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            db=session,
        )
        candidate_ids = {row["id"] for row in candidates}
        assert candidate_p1a_master.id in candidate_ids
        assert candidate_p3_master.id in candidate_ids
        assert enrolled_master.id not in candidate_ids

        p1a_candidates = grades_api.get_enrollment_candidates(
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            source_class="P1A",
            db=session,
        )
        assert [row["id"] for row in p1a_candidates] == [candidate_p1a_master.id]
        assert all(row["class_name"] == "P1A" for row in p1a_candidates)

        missing_class_candidates = grades_api.get_enrollment_candidates(
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            source_class="P9",
            db=session,
        )
        assert missing_class_candidates == []

        source_classes = grades_api.get_enrollment_source_classes(
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            db=session,
        )
        assert source_classes == ["P1A", "P3"]
    finally:
        session.close()


def test_bulk_enrollment_lists_and_skips_duplicates(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Student = app_context["Student"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]

    session = db_module.SessionLocal()
    try:
        from models.academic_master import AcademicProgram, AcademicGrade, AcademicClass
        from models.student_master import StudentMaster, StudentDeviceIdentity
        import uuid
        academic_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one()
        jenjang = session.query(Jenjang).filter(Jenjang.name == "Primary").one()

        program = AcademicProgram(
            jenjang_id=jenjang.id,
            name="General Program",
            active=True
        )
        session.add(program)
        session.flush()

        grade = AcademicGrade(
            jenjang_id=jenjang.id,
            program_id=program.id,
            name="Grade 1",
            sequence_number=1,
            active=True
        )
        session.add(grade)
        session.flush()

        class_row = AcademicClass(
            academic_year_id=academic_year.id,
            grade_id=grade.id,
            class_name="1-A",
            active=True
        )
        session.add(class_row)
        session.flush()

        students = [
            Student(id=20101, name="Bulk A", jenjang="primary", class_name="1-A"),
            Student(id=20102, name="Bulk B", jenjang="primary", class_name="1-A"),
        ]
        session.add_all(students)
        session.flush()

        masters = []
        for s in students:
            m = StudentMaster(
                id=str(uuid.uuid4()),
                full_name=s.name,
                normalized_name=s.name.strip().casefold(),
                gender="L",
                student_status="active"
            )
            session.add(m)
            session.flush()
            device_id = StudentDeviceIdentity(
                student_master_id=m.id,
                legacy_student_id=s.id,
                device_identifier=str(s.id),
                device_source="tap",
                effective_from=date(2025, 7, 1),
                is_active=True
            )
            session.add(device_id)
            session.flush()
            masters.append(m)

        first = grades_api.bulk_enroll_students(
            grades_api.EnrollmentBulkRequest(
                academic_year_id=academic_year.id,
                jenjang_id=jenjang.id,
                academic_class_id=class_row.id,
                student_master_ids=[m.id for m in masters],
            ),
            db=session,
        )
        assert first["created"] == 2
        assert first["skipped_existing"] == 0
        assert len(first["enrollment_ids"]) == 2

        second = grades_api.bulk_enroll_students(
            grades_api.EnrollmentBulkRequest(
                academic_year_id=academic_year.id,
                jenjang_id=jenjang.id,
                academic_class_id=class_row.id,
                student_master_ids=[m.id for m in masters],
            ),
            db=session,
        )
        assert second["created"] == 0
        assert second["skipped_existing"] == 2

        enrollments = grades_api.get_enrollments(
            academic_year_id=academic_year.id,
            jenjang_id=jenjang.id,
            class_name="1-A",
            db=session,
        )
        enrolled_student_ids = {row["student_id"] for row in enrollments}
        assert {student.id for student in students}.issubset(enrolled_student_ids)
    finally:
        session.close()


def test_delete_enrollment_removes_only_enrollment_not_student(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Student = app_context["Student"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]
    StudentEnrollment = app_context["StudentEnrollment"]

    session = db_module.SessionLocal()
    try:
        from models.academic_master import AcademicProgram, AcademicGrade, AcademicClass
        from models.student_master import StudentMaster, StudentDeviceIdentity
        import uuid
        academic_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one()
        jenjang = session.query(Jenjang).filter(Jenjang.name == "Primary").one()

        program = AcademicProgram(
            jenjang_id=jenjang.id,
            name="General Program",
            active=True
        )
        session.add(program)
        session.flush()

        grade = AcademicGrade(
            jenjang_id=jenjang.id,
            program_id=program.id,
            name="Grade 1",
            sequence_number=1,
            active=True
        )
        session.add(grade)
        session.flush()

        class_row = AcademicClass(
            academic_year_id=academic_year.id,
            grade_id=grade.id,
            class_name="1-A",
            active=True
        )
        session.add(class_row)
        session.flush()

        student = Student(id=20201, name="Delete Enrollment Only", jenjang="primary", class_name="1-A")
        session.add(student)
        session.flush()

        master = StudentMaster(
            id=str(uuid.uuid4()),
            full_name=student.name,
            normalized_name=student.name.strip().casefold(),
            gender="L",
            student_status="active"
        )
        session.add(master)
        session.flush()

        device_id = StudentDeviceIdentity(
            student_master_id=master.id,
            legacy_student_id=student.id,
            device_identifier=str(student.id),
            device_source="tap",
            effective_from=date(2025, 7, 1),
            is_active=True
        )
        session.add(device_id)
        session.flush()

        enrollment = StudentEnrollment(
            student_id=student.id,
            student_master_id=master.id,
            academic_year_id=academic_year.id,
            academic_class_id=class_row.id,
            jenjang_id=jenjang.id,
            class_name="1-A",
            class_assigned=True,
        )
        session.add(enrollment)
        session.commit()
        enrollment_id = enrollment.id

        result = grades_api.delete_enrollment(enrollment_id=enrollment_id, db=session)
        assert result["deleted"] == 1
        assert session.query(StudentEnrollment).filter(StudentEnrollment.id == enrollment_id).first() is None
        assert session.query(Student).filter(Student.id == student.id).one().name == student.name
    finally:
        session.close()


def test_bulk_enrollment_rejects_invalid_ids(app_context):
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]

    session = db_module.SessionLocal()
    try:
        from models.academic_master import AcademicProgram, AcademicGrade, AcademicClass
        academic_year = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").one()
        jenjang = session.query(Jenjang).filter(Jenjang.name == "Primary").one()

        program = AcademicProgram(
            jenjang_id=jenjang.id,
            name="General Program",
            active=True
        )
        session.add(program)
        session.flush()

        grade = AcademicGrade(
            jenjang_id=jenjang.id,
            program_id=program.id,
            name="Grade 1",
            sequence_number=1,
            active=True
        )
        session.add(grade)
        session.flush()

        class_row = AcademicClass(
            academic_year_id=academic_year.id,
            grade_id=grade.id,
            class_name="1-A",
            active=True
        )
        session.add(class_row)
        session.commit()

        with pytest.raises(HTTPException) as missing_student:
            grades_api.bulk_enroll_students(
                grades_api.EnrollmentBulkRequest(
                    academic_year_id=academic_year.id,
                    jenjang_id=jenjang.id,
                    academic_class_id=class_row.id,
                    student_master_ids=["999999-invalid-uuid"],
                ),
                db=session,
            )
        assert missing_student.value.status_code == 404

        with pytest.raises(HTTPException) as missing_year:
            grades_api.get_enrollment_candidates(academic_year_id=999999, jenjang_id=jenjang.id, db=session)
        assert missing_year.value.status_code == 404

        with pytest.raises(HTTPException) as missing_jenjang:
            grades_api.get_enrollments(academic_year_id=academic_year.id, jenjang_id=999999, db=session)
        assert missing_jenjang.value.status_code == 404
    finally:
        session.close()


def test_grade_minimum_bootstrap_is_idempotent(app_context):
    db_module = app_context["db_module"]
    AcademicYear = app_context["AcademicYear"]
    Jenjang = app_context["Jenjang"]
    Subject = app_context["Subject"]

    for _ in range(2):
        db_module.run_grade_ledger_patches(db_module.engine)
        db_module._seed_grade_ledger_minimum(db_module.engine)

    session = db_module.SessionLocal()
    try:
        primary_rows = session.query(Jenjang).filter(Jenjang.name == "Primary").all()
        year_rows = session.query(AcademicYear).filter(AcademicYear.label == "2025/2026").all()
        assert len(primary_rows) == 1
        assert len(year_rows) == 1

        language_rows = (
            session.query(Subject)
            .filter(Subject.name == "Language", Subject.jenjang_id == primary_rows[0].id)
            .all()
        )
        assert len(language_rows) == 1
        assert session.query(AcademicYear).filter(AcademicYear.is_default.is_(True)).count() == 1
    finally:
        session.close()


def test_grade_grid_save_inserts_and_updates_component_scores(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        first_payload = grades_api.save_grade_ledger(
            grades_api.GradeGridSaveRequest(
                enrollment_id=ids["enrollment_id"],
                grades=[
                    grades_api.GradeLineItem(
                        subject_id=ids["subject_id"],
                        component_id=ids["component_id"],
                        score=85.5,
                    )
                ],
            ),
            db=session,
        )

        assert first_payload["inserted"] == 1
        assert first_payload["updated"] == 0
        assert first_payload["saved"] == 1

        first_ledger = grades_api.get_grade_ledger(
            academic_year_id=ids["academic_year_id"],
            jenjang_id=None,
            db=session,
        )
        assert len(first_ledger) == 1
        assert first_ledger[0]["enrollment_id"] == ids["enrollment_id"]
        assert first_ledger[0]["student_id"] == 10001
        assert first_ledger[0]["student_name"] == "ARK"
        assert isinstance(first_ledger[0]["grades"], list)
        assert first_ledger[0]["grades"][0]["score"] == 85.5

        update_payload = grades_api.save_grade_ledger(
            grades_api.GradeGridSaveRequest(
                enrollment_id=ids["enrollment_id"],
                grades=[
                    grades_api.GradeLineItem(
                        subject_id=ids["subject_id"],
                        component_id=ids["component_id"],
                        score=None,
                    )
                ],
            ),
            db=session,
        )

        assert update_payload["inserted"] == 0
        assert update_payload["updated"] == 1
        updated_ledger = grades_api.get_grade_ledger(
            academic_year_id=ids["academic_year_id"],
            jenjang_id=None,
            db=session,
        )
        assert updated_ledger[0]["grades"][0]["score"] is None
        row = session.query(StudentSubjectGrade).one()
        assert row.score is None
    finally:
        session.close()


def test_grade_grid_save_reloads_null_score_without_fallback_to_zero(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        result = grades_api.save_grade_ledger(
            grades_api.GradeGridSaveRequest(
                enrollment_id=ids["enrollment_id"],
                grades=[
                    grades_api.GradeLineItem(
                        subject_id=ids["subject_id"],
                        component_id=ids["component_id"],
                        score=None,
                    )
                ],
            ),
            db=session,
        )

        assert result["saved"] == 1
        ledger = grades_api.get_grade_ledger(academic_year_id=ids["academic_year_id"], jenjang_id=None, db=session)
        assert ledger[0]["grades"][0]["score"] is None
        assert session.query(StudentSubjectGrade).filter(StudentSubjectGrade.enrollment_id == ids["enrollment_id"]).count() == 1
    finally:
        session.close()


def test_grade_grid_save_validates_empty_payload_and_score_bounds(app_context):
    grades_api = app_context["grades"]

    with pytest.raises(ValidationError):
        grades_api.GradeGridSaveRequest(enrollment_id=1, grades=[])

    with pytest.raises(ValidationError):
        grades_api.GradeLineItem(subject_id=1, component_id=1, score=101.0)

    with pytest.raises(ValidationError):
        grades_api.GradeLineItem(subject_id=1, component_id=1, score=-0.1)


def test_grade_grid_save_rejects_missing_enrollment_and_scoped_component_mismatch(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]

    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as missing_enrollment:
            grades_api.save_grade_ledger(
                grades_api.GradeGridSaveRequest(
                    enrollment_id=99999,
                    grades=[
                        grades_api.GradeLineItem(
                            subject_id=ids["subject_id"],
                            component_id=ids["component_id"],
                            score=80,
                        )
                    ],
                ),
                db=session,
            )
        assert missing_enrollment.value.status_code == 404

        with pytest.raises(HTTPException) as component_mismatch:
            grades_api.save_grade_ledger(
                grades_api.GradeGridSaveRequest(
                    enrollment_id=ids["enrollment_id"],
                    grades=[
                        grades_api.GradeLineItem(
                            subject_id=ids["subject_id"] + 100,
                            component_id=ids["scoped_component_id"],
                            score=80,
                        )
                    ],
                ),
                db=session,
            )
        assert component_mismatch.value.status_code == 404
    finally:
        session.close()


def test_grade_ledger_excludes_unenrolled_students(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    Student = app_context["Student"]

    session = db_module.SessionLocal()
    try:
        unenrolled = Student(id=30001, name="Unenrolled Student", jenjang="primary", class_name="P1A")
        session.add(unenrolled)
        session.commit()

        ledger = grades_api.get_grade_ledger(academic_year_id=ids["academic_year_id"], jenjang_id=None, db=session)
        student_ids = {row["student_id"] for row in ledger}

        assert ids["enrollment_id"] is not None
        assert 10001 in student_ids
        assert unenrolled.id not in student_ids
        assert len(ledger) == 1
        assert isinstance(ledger[0]["grades"], list)
    finally:
        session.close()


def test_grade_grid_save_duplicate_upsert_keeps_single_row(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        first = grades_api.save_grade_ledger(
            grades_api.GradeGridSaveRequest(
                enrollment_id=ids["enrollment_id"],
                grades=[
                    grades_api.GradeLineItem(
                        subject_id=ids["subject_id"],
                        component_id=ids["component_id"],
                        score=80.0,
                    )
                ],
            ),
            db=session,
        )
        assert first["saved"] == 1

        second = grades_api.save_grade_ledger(
            grades_api.GradeGridSaveRequest(
                enrollment_id=ids["enrollment_id"],
                grades=[
                    grades_api.GradeLineItem(
                        subject_id=ids["subject_id"],
                        component_id=ids["component_id"],
                        score=90.0,
                    )
                ],
            ),
            db=session,
        )
        assert second["saved"] == 1

        ledger = grades_api.get_grade_ledger(academic_year_id=ids["academic_year_id"], jenjang_id=None, db=session)
        assert ledger[0]["grades"][0]["score"] == 90.0
        assert (
            session.query(StudentSubjectGrade)
            .filter(
                StudentSubjectGrade.enrollment_id == ids["enrollment_id"],
                StudentSubjectGrade.subject_id == ids["subject_id"],
                StudentSubjectGrade.component_id == ids["component_id"],
            )
            .count()
            == 1
        )
    finally:
        session.close()


def test_grade_grid_save_atomic_rejects_mixed_payload(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        payload = grades_api.GradeGridSaveRequest(
            enrollment_id=ids["enrollment_id"],
            grades=[
                grades_api.GradeLineItem(
                    subject_id=ids["subject_id"],
                    component_id=ids["component_id"],
                    score=88.0,
                ),
                grades_api.GradeLineItem(
                    subject_id=ids["subject_id"] + 9999,
                    component_id=ids["component_id"],
                    score=77.0,
                ),
            ],
        )

        with pytest.raises(HTTPException) as mixed_error:
            grades_api.save_grade_ledger(payload, db=session)
        assert mixed_error.value.status_code == 404
        assert (
            session.query(StudentSubjectGrade)
            .filter(StudentSubjectGrade.enrollment_id == ids["enrollment_id"])
            .count()
            == 0
        )
    finally:
        session.close()


def test_grade_grid_save_rejects_invalid_foreign_keys_without_orphans(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        with pytest.raises(HTTPException) as missing_enrollment:
            grades_api.save_grade_ledger(
                grades_api.GradeGridSaveRequest(
                    enrollment_id=99999,
                    grades=[
                        grades_api.GradeLineItem(
                            subject_id=ids["subject_id"],
                            component_id=ids["component_id"],
                            score=80.0,
                        )
                    ],
                ),
                db=session,
            )
        assert missing_enrollment.value.status_code == 404

        with pytest.raises(HTTPException) as missing_subject:
            grades_api.save_grade_ledger(
                grades_api.GradeGridSaveRequest(
                    enrollment_id=ids["enrollment_id"],
                    grades=[
                        grades_api.GradeLineItem(
                            subject_id=ids["subject_id"] + 9999,
                            component_id=ids["component_id"],
                            score=80.0,
                        )
                    ],
                ),
                db=session,
            )
        assert missing_subject.value.status_code == 404

        with pytest.raises(HTTPException) as missing_component:
            grades_api.save_grade_ledger(
                grades_api.GradeGridSaveRequest(
                    enrollment_id=ids["enrollment_id"],
                    grades=[
                        grades_api.GradeLineItem(
                            subject_id=ids["subject_id"],
                            component_id=ids["component_id"] + 9999,
                            score=80.0,
                        )
                    ],
                ),
                db=session,
            )
        assert missing_component.value.status_code == 404

        assert (
            session.query(StudentSubjectGrade)
            .filter(StudentSubjectGrade.enrollment_id == ids["enrollment_id"])
            .count()
            == 0
        )
    finally:
        session.close()


def test_grade_ledger_and_analytics_read_dynamic_grade_rows(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]
    StudentSubjectGrade = app_context["StudentSubjectGrade"]

    session = db_module.SessionLocal()
    try:
        session.add(
            StudentSubjectGrade(
                enrollment_id=ids["enrollment_id"],
                subject_id=ids["subject_id"],
                component_id=ids["component_id"],
                score=90.0,
            )
        )
        session.commit()

        ledger = grades_api.get_grade_ledger(academic_year_id=ids["academic_year_id"], jenjang_id=None, db=session)
        assert len(ledger) == 1
        assert ledger[0]["enrollment_id"] == ids["enrollment_id"]
        assert ledger[0]["grades"][0]["score"] == 90.0

        analytics = grades_api.get_grade_analytics(
            academic_year_id=ids["academic_year_id"],
            jenjang_id=None,
            db=session,
        )
        assert analytics["grade_count"] == 1
        assert analytics["average_score"] == 90.0
        assert analytics["cohorts"][0]["jenjang"] == "Test Primary"
    finally:
        session.close()


def test_new_read_endpoints(app_context):
    ids = seed_grade_masters(app_context)
    db_module = app_context["db_module"]
    grades_api = app_context["grades"]

    session = db_module.SessionLocal()
    try:
        # 1. Test academic-years
        years = grades_api.get_academic_years(db=session)
        assert len(years) >= 1
        assert any(y["id"] == ids["academic_year_id"] and y["label"] == "2026/2027" for y in years)

        # 2. Test subjects with correct jenjang_id
        subjects = grades_api.get_subjects(jenjang_id=ids["jenjang_id"], db=session)
        assert len(subjects) == 1
        assert subjects[0]["name"] == "Mathematics"

        # Test subjects with non-existent/different jenjang_id
        empty_subjects = grades_api.get_subjects(jenjang_id=99999, db=session)
        assert len(empty_subjects) == 0

        # 3. Test components
        components = grades_api.get_components(db=session)
        # Seed has kuis, tes, total, total (default ones from database patching) + custom ones from seed
        assert len(components) >= 2
        # Check global component (None subject_id)
        assert any(c["id"] == ids["component_id"] and c["subject_id"] is None for c in components)
        # Check scoped component
        assert any(c["id"] == ids["scoped_component_id"] and c["subject_id"] == ids["subject_id"] for c in components)
    finally:
        session.close()
