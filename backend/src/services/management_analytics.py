from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from models.absence_reason import AbsenceReason
from models.academic_year import AcademicYear
from models.assessment_component import AssessmentComponent
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_subject_grade import StudentSubjectGrade
from models.subject import Subject


def _month_pairs_in_range(start_date: date, end_date: date) -> list[tuple[int, int]]:
    pairs = []
    year = start_date.year
    month = start_date.month

    while (year, month) <= (end_date.year, end_date.month):
        pairs.append((year, month))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1

    return pairs


def _format_late_duration_label(minutes: int) -> str:
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}:{mins:02d}"


def _resolve_term_range(academic_year: AcademicYear, term: str | None) -> tuple[date, date, list[str]]:
    start_date = academic_year.start_date
    end_date = academic_year.end_date
    warnings = [
        "KKM thresholds are static in this phase.",
        "Null grade cells are ignored and are not calculated as zero.",
    ]

    if not term:
        warnings.insert(0, "No Term filter selected. This report aggregates the full academic year.")
        return start_date, end_date, warnings

    try:
        term_num = int(term.split("_")[1])
        if term_num == 1:
            term_start = date(academic_year.start_date.year, 7, 1)
            term_end = date(academic_year.start_date.year, 9, 30)
        elif term_num == 2:
            term_start = date(academic_year.start_date.year, 10, 1)
            term_end = date(academic_year.start_date.year, 12, 31)
        elif term_num == 3:
            term_start = date(academic_year.end_date.year, 1, 1)
            term_end = date(academic_year.end_date.year, 3, 31)
        elif term_num == 4:
            term_start = date(academic_year.end_date.year, 4, 1)
            term_end = date(academic_year.end_date.year, 6, 30)
        else:
            raise ValueError("Invalid term number")

        return max(start_date, term_start), min(end_date, term_end), warnings
    except Exception:
        warnings.insert(0, f"Term format '{term}' is invalid. Calculating for the whole academic year.")
        return academic_year.start_date, academic_year.end_date, warnings


def build_management_summary(
    db: Session,
    academic_year_id: int,
    jenjang_id: int | None = None,
    class_name: str | None = None,
    term: str | None = None,
    subject_id: int | None = None,
) -> dict:
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if not academic_year:
        raise HTTPException(status_code=404, detail="Academic year not found")

    jenjang_name = None
    if jenjang_id is not None:
        jenjang = db.query(Jenjang).filter(Jenjang.id == jenjang_id).first()
        if not jenjang:
            raise HTTPException(status_code=404, detail="Jenjang not found")
        jenjang_name = jenjang.name

    subject_name = None
    if subject_id is not None:
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found")
        subject_name = subject.name

    start_date, end_date, warnings = _resolve_term_range(academic_year, term)
    month_pairs = _month_pairs_in_range(start_date, end_date)

    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)
    q_attendance = (
        db.query(
            effective_status.label("status"),
            func.count(Attendance.id).label("count"),
        )
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)
    )
    if jenjang_name:
        q_attendance = q_attendance.filter(Student.jenjang == jenjang_name)
    if class_name:
        q_attendance = q_attendance.filter(Student.class_name == class_name)

    hadir_count = 0
    for status, count in q_attendance.group_by(effective_status).all():
        if status in ("on-time", "late"):
            hadir_count += int(count or 0)

    q_absence = (
        db.query(
            func.sum(AbsenceReason.sakit).label("sakit"),
            func.sum(AbsenceReason.izin).label("izin"),
            func.sum(AbsenceReason.alfa).label("alfa"),
        )
        .join(Student, Student.id == AbsenceReason.student_id)
    )
    if month_pairs:
        q_absence = q_absence.filter(
            or_(*[and_(AbsenceReason.year == y, AbsenceReason.month == m) for y, m in month_pairs])
        )
    else:
        q_absence = q_absence.filter(False)

    if jenjang_name:
        q_absence = q_absence.filter(Student.jenjang == jenjang_name)
    if class_name:
        q_absence = q_absence.filter(Student.class_name == class_name)

    absence_res = q_absence.first()
    sakit_count = int(absence_res.sakit or 0) if absence_res else 0
    izin_count = int(absence_res.izin or 0) if absence_res else 0
    alfa_count = int(absence_res.alfa or 0) if absence_res else 0

    total_records = hadir_count + sakit_count + izin_count + alfa_count
    status_percentages = {
        "hadir": round((hadir_count / total_records) * 100, 1) if total_records else 0.0,
        "sakit": round((sakit_count / total_records) * 100, 1) if total_records else 0.0,
        "izin": round((izin_count / total_records) * 100, 1) if total_records else 0.0,
        "alfa": round((alfa_count / total_records) * 100, 1) if total_records else 0.0,
    }

    attendance_summary = {
        "total_records": total_records,
        "status_counts": {
            "hadir": hadir_count,
            "sakit": sakit_count,
            "izin": izin_count,
            "alfa": alfa_count,
        },
        "status_percentages": status_percentages,
    }

    q_lateness = (
        db.query(
            Student.class_name.label("class_name"),
            func.count(Attendance.id).label("late_days"),
            func.sum(Attendance.late_duration).label("late_minutes"),
        )
        .join(Student, Student.id == Attendance.student_id)
        .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
        .filter(Attendance.date >= start_date, Attendance.date <= end_date)
        .filter(effective_status == "late")
    )
    if jenjang_name:
        q_lateness = q_lateness.filter(Student.jenjang == jenjang_name)
    if class_name:
        q_lateness = q_lateness.filter(Student.class_name == class_name)

    lateness_rows = q_lateness.group_by(Student.class_name).all()
    total_late_days = sum(int(row.late_days or 0) for row in lateness_rows)
    total_late_minutes = sum(int(row.late_minutes or 0) for row in lateness_rows)

    lateness_by_class = []
    for row in lateness_rows:
        late_days = int(row.late_days or 0)
        late_minutes = int(row.late_minutes or 0)
        lateness_by_class.append(
            {
                "class_name": row.class_name or "Unknown",
                "late_days": late_days,
                "late_minutes": late_minutes,
                "late_duration_label": _format_late_duration_label(late_minutes),
                "late_day_percentage": round((late_days / total_late_days) * 100, 1) if total_late_days else 0.0,
                "late_duration_percentage": round((late_minutes / total_late_minutes) * 100, 1)
                if total_late_minutes
                else 0.0,
            }
        )
    lateness_by_class.sort(key=lambda item: item["class_name"])

    q_students_by_class = (
        db.query(
            StudentEnrollment.class_name.label("class_name"),
            func.count(func.distinct(StudentEnrollment.student_id)).label("student_count"),
        )
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )
    if jenjang_id:
        q_students_by_class = q_students_by_class.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_students_by_class = q_students_by_class.filter(StudentEnrollment.class_name == class_name)

    student_counts = {
        row.class_name: int(row.student_count or 0)
        for row in q_students_by_class.group_by(StudentEnrollment.class_name).all()
    }

    q_grades_by_class = (
        db.query(
            StudentEnrollment.class_name.label("class_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_class = q_grades_by_class.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_class = q_grades_by_class.filter(StudentEnrollment.class_name == class_name)
    if subject_id:
        q_grades_by_class = q_grades_by_class.filter(StudentSubjectGrade.subject_id == subject_id)

    grade_class_map: dict[str, dict[str, float | None]] = {}
    for row in q_grades_by_class.group_by(StudentEnrollment.class_name, AssessmentComponent.assessment_type).all():
        class_label = row.class_name or "Unknown"
        if class_label not in grade_class_map:
            grade_class_map[class_label] = {"sumatif": None, "formatif": None}
        if row.assessment_type in grade_class_map[class_label]:
            grade_class_map[class_label][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )

    grade_by_class = [
        {
            "class_name": class_label,
            "sumatif_average": values["sumatif"],
            "formatif_average": values["formatif"],
            "student_count": student_counts.get(class_label, 0),
            "subject_context": subject_name,
        }
        for class_label, values in grade_class_map.items()
    ]
    grade_by_class.sort(key=lambda item: item["class_name"])

    q_grades_by_subject = (
        db.query(
            Subject.id.label("subject_id"),
            Subject.name.label("subject_name"),
            Jenjang.name.label("jenjang_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
            func.count(func.distinct(StudentEnrollment.student_id)).label("graded_student_count"),
        )
        .join(StudentSubjectGrade, StudentSubjectGrade.subject_id == Subject.id)
        .join(StudentEnrollment, StudentEnrollment.id == StudentSubjectGrade.enrollment_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_subject = q_grades_by_subject.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_subject = q_grades_by_subject.filter(StudentEnrollment.class_name == class_name)
    if subject_id:
        q_grades_by_subject = q_grades_by_subject.filter(Subject.id == subject_id)

    grade_subject_map = {}
    for row in q_grades_by_subject.group_by(
        Subject.id,
        Subject.name,
        Jenjang.name,
        AssessmentComponent.assessment_type,
    ).all():
        key = (row.subject_id, row.jenjang_name)
        if key not in grade_subject_map:
            grade_subject_map[key] = {
                "name": row.subject_name,
                "jenjang": row.jenjang_name,
                "sumatif": None,
                "formatif": None,
                "graded_student_count": 0,
            }
        if row.assessment_type in ("sumatif", "formatif"):
            grade_subject_map[key][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )
        grade_subject_map[key]["graded_student_count"] = max(
            grade_subject_map[key]["graded_student_count"],
            int(row.graded_student_count or 0),
        )

    grade_by_subject = [
        {
            "subject_id": subject_key[0],
            "subject_name": values["name"],
            "jenjang": values["jenjang"],
            "sumatif_average": values["sumatif"],
            "formatif_average": values["formatif"],
            "graded_student_count": values["graded_student_count"],
        }
        for subject_key, values in grade_subject_map.items()
    ]
    grade_by_subject.sort(key=lambda item: (item["subject_name"], item["jenjang"]))

    q_grades_by_student = (
        db.query(
            Student.id.label("student_id"),
            Student.name.label("student_name"),
            StudentEnrollment.class_name.label("class_name"),
            Subject.id.label("subject_id"),
            Subject.name.label("subject_name"),
            AssessmentComponent.assessment_type.label("assessment_type"),
            func.avg(StudentSubjectGrade.score).label("average_score"),
        )
        .join(StudentEnrollment, StudentEnrollment.student_id == Student.id)
        .join(StudentSubjectGrade, StudentSubjectGrade.enrollment_id == StudentEnrollment.id)
        .join(Subject, Subject.id == StudentSubjectGrade.subject_id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .filter(StudentSubjectGrade.score.isnot(None))
    )
    if jenjang_id:
        q_grades_by_student = q_grades_by_student.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_name:
        q_grades_by_student = q_grades_by_student.filter(StudentEnrollment.class_name == class_name)
    if subject_id:
        q_grades_by_student = q_grades_by_student.filter(StudentSubjectGrade.subject_id == subject_id)

    grade_student_map = {}
    threshold_edelweiss = 85.0
    threshold_national = 75.0

    for row in q_grades_by_student.group_by(
        Student.id,
        Student.name,
        StudentEnrollment.class_name,
        Subject.id,
        Subject.name,
        AssessmentComponent.assessment_type,
    ).all():
        key = (
            row.student_id,
            row.student_name,
            row.class_name or "Unknown",
            row.subject_id,
            row.subject_name,
        )
        if key not in grade_student_map:
            grade_student_map[key] = {"sumatif": None, "formatif": None}
        if row.assessment_type in grade_student_map[key]:
            grade_student_map[key][row.assessment_type] = (
                round(float(row.average_score), 1) if row.average_score is not None else None
            )

    grade_by_student = []
    below_kkm_alerts = []
    for key, values in grade_student_map.items():
        student_id, student_name, class_label, subject_key, subject_label = key
        sumatif_average = values["sumatif"]
        formatif_average = values["formatif"]

        below = False
        for assessment_type, average_score in (
            ("sumatif", sumatif_average),
            ("formatif", formatif_average),
        ):
            if average_score is not None and average_score < threshold_edelweiss:
                below = True
                below_kkm_alerts.append(
                    {
                        "student_id": student_id,
                        "student_name": student_name,
                        "class_name": class_label,
                        "subject_id": subject_key,
                        "subject_name": subject_label,
                        "assessment_type": assessment_type,
                        "average_score": average_score,
                        "kkm_threshold": threshold_edelweiss,
                        "gap_from_threshold": round(threshold_edelweiss - average_score, 1),
                    }
                )

        grade_by_student.append(
            {
                "student_id": student_id,
                "student_name": student_name,
                "class_name": class_label,
                "subject_id": subject_key,
                "subject_name": subject_label,
                "sumatif_average": sumatif_average,
                "formatif_average": formatif_average,
                "below_threshold": below,
            }
        )

    grade_by_student.sort(key=lambda item: (item["student_name"], item["subject_name"]))
    below_kkm_alerts.sort(key=lambda item: (item["student_name"], item["subject_name"], item["assessment_type"]))

    return {
        "filters": {
            "academic_year_id": academic_year_id,
            "academic_year_label": academic_year.label,
            "jenjang_id": jenjang_id,
            "jenjang_name": jenjang_name,
            "class_name": class_name,
            "term": term,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "date_start": start_date.isoformat(),
            "date_end": end_date.isoformat(),
        },
        "attendance_summary": attendance_summary,
        "lateness_by_class": lateness_by_class,
        "grade_by_class": grade_by_class,
        "grade_by_subject": grade_by_subject,
        "grade_by_student": grade_by_student,
        "below_kkm_alerts": below_kkm_alerts,
        "thresholds": {
            "kkm_edelweiss": threshold_edelweiss,
            "kkm_national": threshold_national,
        },
        "warnings": warnings,
    }
