import calendar
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from models.absence_reason import AbsenceReason
from models.academic_year import AcademicYear
from models.academic_master import AcademicClass
from models.assessment_component import AssessmentComponent
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_subject_grade import StudentSubjectGrade
from models.subject import Subject
from services.academic_config import resolve_effective_kkm
from services.report_grouping import ReportScope, canonical_scope_for_level, level_matches_scope, scope_options


def _round_rate(numerator: int | float, denominator: int | float) -> float | None:
    return round(numerator / denominator * 100, 1) if denominator else None


def _round_average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _month_period(month: str) -> tuple[date, date]:
    try:
        if len(month) != 7 or month[4] != "-":
            raise ValueError
        year, month_number = int(month[:4]), int(month[5:])
        start = date(year, month_number, 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="month must use the YYYY-MM format")
    return start, date(year, month_number, calendar.monthrange(year, month_number)[1])


def _months_for_year(academic_year: AcademicYear) -> list[dict[str, str]]:
    cursor = academic_year.start_date.replace(day=1)
    final = academic_year.end_date.replace(day=1)
    rows = []
    while cursor <= final:
        rows.append({"value": cursor.strftime("%Y-%m"), "label": cursor.strftime("%B %Y")})
        cursor = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)
    return rows


def _scoped_enrollments(db: Session, academic_year_id: int, scope: ReportScope, class_name: str | None):
    rows = (
        db.query(StudentEnrollment, Student, Jenjang)
        .join(Student, Student.id == StudentEnrollment.student_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
        .all()
    )
    class_filter = " ".join(class_name.strip().split()) if class_name else None
    selected = []
    unmapped = set()
    for enrollment, student, jenjang in rows:
        if canonical_scope_for_level(jenjang.name) is None:
            unmapped.add(jenjang.name.strip() or "Unknown")
            continue
        if not level_matches_scope(jenjang.name, scope):
            continue
        resolved_class = enrollment.academic_class.class_name if enrollment.academic_class_id and enrollment.academic_class else enrollment.class_name
        normalized_class = " ".join((resolved_class or "").strip().split())
        if class_filter is not None and normalized_class != class_filter:
            continue
        selected.append((enrollment, student, jenjang, normalized_class or "Unknown / Not Provided"))
    return selected, sorted(unmapped, key=str.casefold)


def build_report_filters(
    db: Session,
    academic_year_id: int | None = None,
    scope: ReportScope = "combined",
) -> dict:
    years = db.query(AcademicYear).order_by(AcademicYear.start_date.asc(), AcademicYear.id.asc()).all()
    selected_year = None
    if academic_year_id is not None:
        selected_year = next((row for row in years if row.id == academic_year_id), None)
        if selected_year is None:
            raise HTTPException(status_code=404, detail="Academic year not found")
    else:
        selected_year = next((row for row in years if row.is_default), years[-1] if years else None)

    classes: list[str] = []
    if selected_year:
        enrollments, _ = _scoped_enrollments(db, selected_year.id, scope, None)
        classes = sorted({row[3] for row in enrollments}, key=str.casefold)

    subjects = (
        db.query(Subject, Jenjang)
        .join(Jenjang, Jenjang.id == Subject.jenjang_id)
        .order_by(Subject.name.asc(), Jenjang.name.asc(), Subject.id.asc())
        .all()
    )
    subject_rows = [
        {"id": subject.id, "name": subject.name, "jenjang_id": jenjang.id, "jenjang_name": jenjang.name}
        for subject, jenjang in subjects
        if level_matches_scope(jenjang.name, scope)
    ]
    return {
        "academic_years": [
            {
                "id": row.id,
                "name": row.label,
                "start_date": row.start_date,
                "end_date": row.end_date,
                "is_default": row.is_default,
            }
            for row in years
        ],
        "default_academic_year_id": next((row.id for row in years if row.is_default), None),
        "months": _months_for_year(selected_year) if selected_year else [],
        "scopes": scope_options(),
        "classes": classes,
        "subjects": subject_rows,
    }


def _empty_attendance() -> dict:
    return {"present": 0, "sakit": 0, "izin": 0, "alfa": 0, "incomplete": 0, "late_days": 0, "late_minutes": 0}


def _finalize_attendance(counts: dict) -> dict:
    denominator = counts["present"] + counts["sakit"] + counts["izin"] + counts["alfa"]
    return {
        **counts,
        "attendance_rate": _round_rate(counts["present"], denominator),
        "late_rate": _round_rate(counts["late_days"], counts["present"]),
    }


def build_monthly_report(
    db: Session,
    academic_year_id: int,
    month: str,
    scope: ReportScope,
    class_name: str | None = None,
    subject_id: int | None = None,
) -> dict:
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")
    start_date, end_date = _month_period(month)
    if start_date < academic_year.start_date or end_date > academic_year.end_date:
        raise HTTPException(status_code=422, detail="Selected month falls outside the academic year")
    if subject_id is not None and db.query(Subject.id).filter(Subject.id == subject_id).first() is None:
        raise HTTPException(status_code=404, detail="Subject not found")

    enrollments, unmapped_levels = _scoped_enrollments(db, academic_year_id, scope, class_name)
    enrollment_by_student = {row[1].id: row for row in enrollments}
    student_ids = list(enrollment_by_student)
    total_students = len(student_ids)

    level_counts: dict[str, int] = defaultdict(int)
    class_counts: dict[str, int] = defaultdict(int)
    for _, _, jenjang, class_label in enrollments:
        level_counts[jenjang.name.strip()] += 1
        class_counts[class_label] += 1

    attendance_by_level: dict[str, dict] = defaultdict(_empty_attendance)
    unmatched_absent = 0
    malformed_lateness = 0
    if student_ids:
        effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)
        attendance_rows = (
            db.query(Attendance, effective_status.label("effective_status"))
            .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
            .filter(Attendance.student_id.in_(student_ids), Attendance.date >= start_date, Attendance.date <= end_date)
            .all()
        )
        for attendance, status in attendance_rows:
            level_name = enrollment_by_student[attendance.student_id][2].name.strip()
            bucket = attendance_by_level[level_name]
            if status in ("on-time", "late"):
                bucket["present"] += 1
            if status == "late":
                bucket["late_days"] += 1
                if isinstance(attendance.late_duration, int) and attendance.late_duration >= 0:
                    bucket["late_minutes"] += attendance.late_duration
                else:
                    malformed_lateness += 1
            elif status == "incomplete":
                bucket["incomplete"] += 1
            elif status == "absent":
                unmatched_absent += 1

        absence_rows = (
            db.query(AbsenceReason)
            .filter(
                AbsenceReason.student_id.in_(student_ids),
                AbsenceReason.year == start_date.year,
                AbsenceReason.month == start_date.month,
            )
            .all()
        )
        for absence in absence_rows:
            level_name = enrollment_by_student[absence.student_id][2].name.strip()
            bucket = attendance_by_level[level_name]
            bucket["sakit"] += int(absence.sakit or 0)
            bucket["izin"] += int(absence.izin or 0)
            bucket["alfa"] += int(absence.alfa or 0)

    overall = _empty_attendance()
    for bucket in attendance_by_level.values():
        for key in overall:
            overall[key] += bucket[key]
    finalized_attendance = _finalize_attendance(overall)
    by_level_rows = [
        {"level": level, **_finalize_attendance(attendance_by_level[level])}
        for level in sorted(level_counts, key=str.casefold)
    ]

    grade_values = {"sumatif": [], "formatif": []}
    subject_values: dict[tuple[int, str, str], dict[str, list[float]]] = defaultdict(lambda: {"sumatif": [], "formatif": []})
    empty_grade_cells = 0
    below_rows: list[tuple[int, int, str]] = []
    if enrollments:
        enrollment_ids = [row[0].id for row in enrollments]
        grade_query = (
            db.query(StudentSubjectGrade, AssessmentComponent, Subject, Jenjang, StudentEnrollment.student_id)
            .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
            .join(Subject, Subject.id == StudentSubjectGrade.subject_id)
            .join(Jenjang, Jenjang.id == Subject.jenjang_id)
            .join(StudentEnrollment, StudentEnrollment.id == StudentSubjectGrade.enrollment_id)
            .filter(StudentSubjectGrade.enrollment_id.in_(enrollment_ids))
        )
        if subject_id is not None:
            grade_query = grade_query.filter(StudentSubjectGrade.subject_id == subject_id)
        grade_rows = grade_query.all()
        grouped: dict[tuple[int, int, int, str], list[float]] = defaultdict(list)
        group_meta = {}
        for grade, component, subject, jenjang, student_id in grade_rows:
            key = (student_id, grade.enrollment_id, subject.id, component.assessment_type)
            group_meta[key] = (subject, jenjang)
            if grade.score is None:
                empty_grade_cells += 1
                continue
            value = float(grade.score)
            grade_values[component.assessment_type].append(value)
            subject_values[(subject.id, subject.name, jenjang.name)][component.assessment_type].append(value)
            grouped[key].append(value)
        for key, values in grouped.items():
            student_id, _, subject_key, assessment_type = key
            subject, jenjang = group_meta[key]
            average = sum(values) / len(values)
            threshold = resolve_effective_kkm(
                db, academic_year_id, enrollment_by_student[student_id][0].jenjang_id, subject_key, assessment_type
            ).threshold
            if average < threshold:
                below_rows.append((student_id, subject_key, assessment_type))

    subject_summaries = []
    for (sid, name, level), values in sorted(subject_values.items(), key=lambda item: (item[0][1].casefold(), item[0][2].casefold())):
        subject_below = sum(1 for _, row_subject, _ in below_rows if row_subject == sid)
        subject_summaries.append({
            "subject_id": sid,
            "subject_name": name,
            "jenjang": level,
            "sumatif_average": _round_average(values["sumatif"]),
            "formatif_average": _round_average(values["formatif"]),
            "below_kkm_count": subject_below,
        })
    academic_available = bool(grade_values["sumatif"] or grade_values["formatif"])
    academic_summary = {
        "availability": academic_available,
        "reason": None if academic_available else "Academic data is not available for the selected report context.",
        "sumatif_average": _round_average(grade_values["sumatif"]),
        "formatif_average": _round_average(grade_values["formatif"]),
        "below_kkm_count": len(below_rows),
        "by_subject": subject_summaries,
    }

    warnings = [
        "Student gender, religion, and domicile fields are not available in the current Student master schema.",
        "Student population is the selected academic year's enrollment snapshot; within-year enrollment history is not available.",
    ]
    if not academic_available:
        warnings.append("Academic data is not available for the selected report context.")
    if unmapped_levels:
        warnings.append("Unmapped Jenjang values were excluded from report scope calculations: " + ", ".join(unmapped_levels) + ".")
    if unmatched_absent:
        warnings.append(f"{unmatched_absent} effective absent attendance record(s) were not reinterpreted as Sakit, Izin, or Alfa; absence totals use AbsenceReason data.")
    if malformed_lateness:
        warnings.append(f"{malformed_lateness} malformed lateness duration value(s) were ignored.")

    denominator = overall["present"] + overall["sakit"] + overall["izin"] + overall["alfa"]
    completeness = _round_rate(denominator, denominator + overall["incomplete"])
    named_counts = lambda values: [
        {"name": name, "count": count, "percentage": _round_rate(count, total_students)}
        for name, count in sorted(values.items(), key=lambda item: item[0].casefold())
    ]
    return {
        "meta": {
            "report_type": "monthly",
            "scope": scope,
            "academic_year": {"id": academic_year.id, "name": academic_year.label},
            "period": {"start": start_date, "end": end_date},
            "generated_at": datetime.now(timezone.utc),
        },
        "executive_summary": {
            "total_students": total_students,
            "male_students": 0,
            "female_students": 0,
            "attendance_rate": finalized_attendance["attendance_rate"],
            "late_rate": finalized_attendance["late_rate"],
            "late_minutes": overall["late_minutes"],
            "below_kkm_count": len(below_rows),
            "data_completeness_rate": completeness,
        },
        "student_distribution": {
            "by_level": named_counts(level_counts),
            "by_class": named_counts(class_counts),
            "by_gender": [], "by_religion": [], "by_domicile": [],
        },
        "attendance_summary": finalized_attendance,
        "attendance_by_level": by_level_rows,
        "academic_summary": academic_summary,
        "trends": [],
        "data_quality": {
            "missing_gender": total_students,
            "missing_religion": total_students,
            "missing_domicile": total_students,
            "incomplete_attendance": overall["incomplete"],
            "empty_grade_cells": empty_grade_cells,
            "unmapped_levels": unmapped_levels,
            "warnings": warnings,
        },
    }


def _comparison(rows: list[dict], highest: bool) -> dict | None:
    valid = [row for row in rows if row["attendance_denominator"] > 0 and row["attendance_rate"] is not None]
    if not valid:
        return None
    # Chronological/name order is the deterministic tie-breaker because rows are
    # supplied in stable order.
    best_rate = (max if highest else min)(row["attendance_rate"] for row in valid)
    row = next(row for row in valid if row["attendance_rate"] == best_rate)
    return {
        "name": row["name"],
        "attendance_rate": row["attendance_rate"],
        "attendance_denominator": row["attendance_denominator"],
    }


def build_annual_report(
    db: Session,
    academic_year_id: int,
    scope: ReportScope,
    class_name: str | None = None,
    subject_id: int | None = None,
) -> dict:
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")

    month_options = _months_for_year(academic_year)
    monthly_reports = [
        build_monthly_report(
            db,
            academic_year_id=academic_year_id,
            month=option["value"],
            scope=scope,
            class_name=class_name,
            subject_id=subject_id,
        )
        for option in month_options
    ]

    attendance = _empty_attendance()
    level_totals: dict[str, dict] = defaultdict(_empty_attendance)
    trends = []
    for option, report in zip(month_options, monthly_reports):
        row = report["attendance_summary"]
        for key in attendance:
            attendance[key] += row[key]
        denominator = row["present"] + row["sakit"] + row["izin"] + row["alfa"]
        trends.append({
            "month": option["value"],
            "label": option["label"],
            "present": row["present"],
            "sakit": row["sakit"],
            "izin": row["izin"],
            "alfa": row["alfa"],
            "incomplete": row["incomplete"],
            "attendance_denominator": denominator,
            "attendance_rate": _round_rate(row["present"], denominator),
            "late_days": row["late_days"],
            "late_minutes": row["late_minutes"],
            "late_rate": _round_rate(row["late_days"], row["present"]),
            # Grade Ledger has no assessment date/month relationship. Assigning
            # annual ledger values to a month would fabricate a historical trend.
            "sumatif_average": None,
            "formatif_average": None,
            "below_kkm_count": 0,
        })
        for level_row in report["attendance_by_level"]:
            bucket = level_totals[level_row["level"]]
            for key in bucket:
                bucket[key] += level_row[key]

    finalized = _finalize_attendance(attendance)
    denominator = attendance["present"] + attendance["sakit"] + attendance["izin"] + attendance["alfa"]
    completeness = _round_rate(denominator, denominator + attendance["incomplete"])
    annual_levels = [
        {"level": level, **_finalize_attendance(level_totals[level])}
        for level in sorted(level_totals, key=str.casefold)
    ]

    # Grade Ledger is academic-year scoped. Every monthly report deliberately
    # sees the same raw ledger rows, so use one independently calculated result
    # rather than combining or averaging repeated monthly values.
    base = monthly_reports[0] if monthly_reports else build_monthly_report(
        db, academic_year_id, academic_year.start_date.strftime("%Y-%m"), scope, class_name, subject_id
    )
    academic_summary = base["academic_summary"]
    population = base["executive_summary"]
    warnings = list(base["data_quality"]["warnings"])
    warnings = [
        warning.replace(
            "Student population is the selected academic year's enrollment snapshot; within-year enrollment history is not available.",
            "Historical enrollment snapshots are not available; student population represents the selected academic year's enrollment snapshot.",
        )
        for warning in warnings
    ]
    warnings.append(
        "Monthly academic trends are unavailable because Grade Ledger scores do not have an assessment-month field."
    )
    for report in monthly_reports:
        for warning in report["data_quality"]["warnings"]:
            if warning not in warnings and "Student population" not in warning:
                warnings.append(warning)

    month_comparison_rows = [
        {
            "name": row["month"],
            "attendance_rate": row["attendance_rate"],
            "attendance_denominator": row["attendance_denominator"],
        }
        for row in trends
    ]
    level_comparison_rows = [
        {
            "name": row["level"],
            "attendance_rate": row["attendance_rate"],
            "attendance_denominator": row["present"] + row["sakit"] + row["izin"] + row["alfa"],
        }
        for row in annual_levels
    ]
    return {
        "meta": {
            "report_type": "annual",
            "scope": scope,
            "academic_year": {"id": academic_year.id, "name": academic_year.label},
            "period": {"start": academic_year.start_date, "end": academic_year.end_date},
            "generated_at": datetime.now(timezone.utc),
        },
        "executive_summary": {
            "total_students": population["total_students"],
            "male_students": 0,
            "female_students": 0,
            "attendance_rate": finalized["attendance_rate"],
            "late_rate": finalized["late_rate"],
            "late_minutes": attendance["late_minutes"],
            "below_kkm_count": academic_summary["below_kkm_count"],
            "data_completeness_rate": completeness,
        },
        "student_distribution": base["student_distribution"],
        "attendance_summary": finalized,
        "attendance_by_level": annual_levels,
        "academic_summary": academic_summary,
        "trends": trends,
        "comparisons": {
            "highest_attendance_month": _comparison(month_comparison_rows, True),
            "lowest_attendance_month": _comparison(month_comparison_rows, False),
            "highest_attendance_level": _comparison(level_comparison_rows, True),
            "lowest_attendance_level": _comparison(level_comparison_rows, False),
        },
        "data_quality": {
            "missing_gender": population["total_students"],
            "missing_religion": population["total_students"],
            "missing_domicile": population["total_students"],
            "incomplete_attendance": attendance["incomplete"],
            "empty_grade_cells": base["data_quality"]["empty_grade_cells"],
            "unmapped_levels": base["data_quality"]["unmapped_levels"],
            "warnings": warnings,
        },
    }
