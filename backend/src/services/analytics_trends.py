from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from models.absence_reason import AbsenceReason
from models.academic_intervention import AcademicIntervention
from models.academic_year import AcademicYear
from models.academic_master import AcademicClass
from models.attendance import Attendance
from models.attendance_review import AttendanceOverride
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.subject import Subject
from services.academic_config import effective_term_rows
from services.analytics_forecast import build_forecast_series
from services.management_analytics import build_management_summary


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


def _month_label(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _safe_pct(numerator: int | float, denominator: int | float) -> float:
    return round((float(numerator) / float(denominator)) * 100, 1) if denominator else 0.0


def _resolve_filters(db: Session, academic_year_id: int | None, jenjang_id: int | None, subject_id: int | None) -> tuple[AcademicYear, str | None, str | None]:
    academic_year = None
    if academic_year_id is not None:
        academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    else:
        academic_year = db.query(AcademicYear).filter(AcademicYear.is_default == True).first()  # noqa: E712
        if academic_year is None:
            academic_year = db.query(AcademicYear).order_by(AcademicYear.start_date.desc()).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")

    jenjang_name = None
    if jenjang_id is not None:
        jenjang = db.query(Jenjang).filter(Jenjang.id == jenjang_id).first()
        if jenjang is None:
            raise HTTPException(status_code=404, detail="Jenjang not found")
        jenjang_name = jenjang.name

    subject_name = None
    if subject_id is not None:
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        if subject is None:
            raise HTTPException(status_code=404, detail="Subject not found")
        subject_name = subject.name

    return academic_year, jenjang_name, subject_name


def _academic_years_for_range(
    db: Session,
    selected_year: AcademicYear,
    from_academic_year_id: int | None,
    to_academic_year_id: int | None,
) -> list[AcademicYear]:
    query = db.query(AcademicYear)
    if from_academic_year_id is not None:
        from_year = db.query(AcademicYear).filter(AcademicYear.id == from_academic_year_id).first()
        if from_year is None:
            raise HTTPException(status_code=404, detail="from_academic_year_id not found")
        query = query.filter(AcademicYear.start_date >= from_year.start_date)
    if to_academic_year_id is not None:
        to_year = db.query(AcademicYear).filter(AcademicYear.id == to_academic_year_id).first()
        if to_year is None:
            raise HTTPException(status_code=404, detail="to_academic_year_id not found")
        query = query.filter(AcademicYear.start_date <= to_year.start_date)
    if from_academic_year_id is None and to_academic_year_id is None:
        query = query.filter(AcademicYear.start_date <= selected_year.start_date)

    years = query.order_by(AcademicYear.start_date.asc()).all()
    if not years:
        years = [selected_year]
    return years


def _attendance_month_series(
    db: Session,
    years: list[AcademicYear],
    *,
    jenjang_name: str | None,
    class_name: str | None,
) -> tuple[list[dict], list[str]]:
    warnings = []
    rows = []
    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)
    for academic_year in years:
        for year, month in _month_pairs_in_range(academic_year.start_date, academic_year.end_date):
            start = date(year, month, 1)
            end = date(year + (month // 12), (month % 12) + 1, 1) if month < 12 else date(year + 1, 1, 1)
            q_att = (
                db.query(effective_status.label("status"), func.count(Attendance.id).label("count"))
                .join(Student, Student.id == Attendance.student_id)
                .outerjoin(StudentEnrollment, and_(
                    StudentEnrollment.student_id == Student.id,
                    StudentEnrollment.academic_year_id == academic_year.id,
                ))
                .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
                .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
                .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
                .filter(Attendance.date >= start, Attendance.date < end)
            )
            effective_class = func.coalesce(AcademicClass.class_name, StudentEnrollment.class_name, Student.class_name)
            effective_jenjang = func.coalesce(Jenjang.name, Student.jenjang)
            if jenjang_name:
                q_att = q_att.filter(effective_jenjang == jenjang_name)
            if class_name:
                q_att = q_att.filter(effective_class == class_name)
            hadir = sum(int(count or 0) for status, count in q_att.group_by(effective_status).all() if status in ("on-time", "late"))

            q_abs = (
                db.query(
                    func.sum(AbsenceReason.sakit).label("sakit"),
                    func.sum(AbsenceReason.izin).label("izin"),
                    func.sum(AbsenceReason.alfa).label("alfa"),
                )
                .join(Student, Student.id == AbsenceReason.student_id)
                .outerjoin(StudentEnrollment, and_(
                    StudentEnrollment.student_id == Student.id,
                    StudentEnrollment.academic_year_id == academic_year.id,
                ))
                .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
                .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
                .filter(AbsenceReason.year == year, AbsenceReason.month == month)
            )
            if jenjang_name:
                q_abs = q_abs.filter(effective_jenjang == jenjang_name)
            if class_name:
                q_abs = q_abs.filter(effective_class == class_name)
            abs_row = q_abs.first()
            sakit = int(abs_row.sakit or 0) if abs_row else 0
            izin = int(abs_row.izin or 0) if abs_row else 0
            alfa = int(abs_row.alfa or 0) if abs_row else 0
            total = hadir + sakit + izin + alfa
            if total == 0:
                warnings.append(f"No historical records for {_month_label(year, month)}.")
            rows.append({
                "period": _month_label(year, month),
                "academic_year_id": academic_year.id,
                "academic_year_label": academic_year.label,
                "hadir": hadir,
                "sakit": sakit,
                "izin": izin,
                "alfa": alfa,
                "total_records": total,
                "attendance_percentage": _safe_pct(hadir, total),
                "absence_reason_shares": {
                    "sakit": _safe_pct(sakit, total),
                    "izin": _safe_pct(izin, total),
                    "alfa": _safe_pct(alfa, total),
                },
            })
    return rows, warnings


def _lateness_month_series(
    db: Session,
    years: list[AcademicYear],
    *,
    jenjang_name: str | None,
    class_name: str | None,
) -> list[dict]:
    rows = []
    effective_status = func.coalesce(AttendanceOverride.override_status, Attendance.status)
    for academic_year in years:
        for year, month in _month_pairs_in_range(academic_year.start_date, academic_year.end_date):
            start = date(year, month, 1)
            end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
            q = (
                db.query(
                    func.count(Attendance.id).label("late_days"),
                    func.sum(Attendance.late_duration).label("late_minutes"),
                )
                .join(Student, Student.id == Attendance.student_id)
                .outerjoin(StudentEnrollment, and_(
                    StudentEnrollment.student_id == Student.id,
                    StudentEnrollment.academic_year_id == academic_year.id,
                ))
                .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
                .outerjoin(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
                .outerjoin(AttendanceOverride, AttendanceOverride.attendance_id == Attendance.id)
                .filter(Attendance.date >= start, Attendance.date < end, effective_status == "late")
            )
            effective_class = func.coalesce(AcademicClass.class_name, StudentEnrollment.class_name, Student.class_name)
            effective_jenjang = func.coalesce(Jenjang.name, Student.jenjang)
            if jenjang_name:
                q = q.filter(effective_jenjang == jenjang_name)
            if class_name:
                q = q.filter(effective_class == class_name)
            row = q.first()
            rows.append({
                "period": _month_label(year, month),
                "academic_year_id": academic_year.id,
                "academic_year_label": academic_year.label,
                "late_days": int(row.late_days or 0) if row else 0,
                "late_minutes": int(row.late_minutes or 0) if row else 0,
            })
    return rows


def _intervention_metrics(summary: dict) -> dict:
    status_counts = summary.get("interventions_summary", {}).get("status_counts", {})
    priority_counts = summary.get("interventions_summary", {}).get("priority_counts", {})
    active = sum(int(status_counts.get(key, 0)) for key in ("open", "in_progress", "monitoring"))
    resolved = int(status_counts.get("resolved", 0)) + int(status_counts.get("closed", 0))
    total = active + resolved
    return {
        "open_interventions": active,
        "resolved_interventions": resolved,
        "overdue_followups": len(summary.get("interventions_summary", {}).get("due_soon", [])),
        "high_priority": int(priority_counts.get("high", 0)),
        "urgent_priority": int(priority_counts.get("urgent", 0)),
        "resolution_rate": _safe_pct(resolved, total),
        "average_days_to_resolution": None,
    }


def _term_and_year_series(
    db: Session,
    years: list[AcademicYear],
    *,
    selected_academic_year_id: int,
    jenjang_id: int | None,
    class_name: str | None,
    subject_id: int | None,
) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict], list[dict], list[dict]]:
    attendance_terms = []
    lateness_terms = []
    lateness_by_class_terms = []
    grade_terms = []
    intervention_terms = []
    kkm_terms = []
    year_comparisons = []

    for academic_year in years:
        year_summary = build_management_summary(db, academic_year.id, jenjang_id=jenjang_id, class_name=class_name, subject_id=subject_id)
        year_comparisons.append({
            "period": academic_year.label,
            "academic_year_id": academic_year.id,
            "attendance_percentage": year_summary["attendance_summary"]["status_percentages"]["hadir"],
            "late_days": sum(row["late_days"] for row in year_summary.get("lateness_by_class", [])),
            "late_minutes": sum(row["late_minutes"] for row in year_summary.get("lateness_by_class", [])),
            "sumatif_average": _average([row["sumatif_average"] for row in year_summary.get("grade_by_class", [])]),
            "formatif_average": _average([row["formatif_average"] for row in year_summary.get("grade_by_class", [])]),
            "below_kkm_alert_count": len(year_summary.get("below_kkm_alerts", [])),
            "open_intervention_count": year_summary.get("interventions_summary", {}).get("status_counts", {}).get("open", 0),
        })
        for term_row in effective_term_rows(db, academic_year.id):
            term_value = term_row["value"]
            summary = build_management_summary(db, academic_year.id, jenjang_id=jenjang_id, class_name=class_name, term=term_value, subject_id=subject_id)
            term_label = f"{academic_year.label} {term_row['label']}"
            att = summary["attendance_summary"]
            attendance_terms.append({
                "period": term_label,
                "academic_year_id": academic_year.id,
                "term": term_value,
                "term_label": term_row["label"],
                "start_date": term_row["start_date"],
                "end_date": term_row["end_date"],
                "term_source": term_row["source"],
                "attendance_percentage": att["status_percentages"]["hadir"],
                "hadir": att["status_counts"]["hadir"],
                "sakit": att["status_counts"]["sakit"],
                "izin": att["status_counts"]["izin"],
                "alfa": att["status_counts"]["alfa"],
                "total_records": att["total_records"],
                "absence_reason_shares": {
                    "sakit": att["status_percentages"]["sakit"],
                    "izin": att["status_percentages"]["izin"],
                    "alfa": att["status_percentages"]["alfa"],
                },
            })
            lates = summary.get("lateness_by_class", [])
            late_days = sum(row["late_days"] for row in lates)
            late_minutes = sum(row["late_minutes"] for row in lates)
            lateness_terms.append({
                "period": term_label,
                "academic_year_id": academic_year.id,
                "term": term_value,
                "late_days": late_days,
                "late_minutes": late_minutes,
            })
            for row in lates:
                lateness_by_class_terms.append({
                    "period": term_label,
                    "academic_year_id": academic_year.id,
                    "term": term_value,
                    "class_name": row["class_name"],
                    "late_days": row["late_days"],
                    "late_minutes": row["late_minutes"],
                })

            sumatif_average = _average([row["sumatif_average"] for row in summary.get("grade_by_class", [])])
            formatif_average = _average([row["formatif_average"] for row in summary.get("grade_by_class", [])])
            grade_terms.append({
                "period": term_label,
                "academic_year_id": academic_year.id,
                "term": term_value,
                "sumatif_average": sumatif_average,
                "formatif_average": formatif_average,
                "sumatif_formatif_gap": round(sumatif_average - formatif_average, 1) if sumatif_average is not None and formatif_average is not None else None,
                "below_kkm_alert_count": len(summary.get("below_kkm_alerts", [])),
            })
            for row in summary.get("grade_by_class", []):
                grade_terms[-1].setdefault("grade_average_by_class", []).append({
                    "class_name": row["class_name"],
                    "sumatif_average": row["sumatif_average"],
                    "formatif_average": row["formatif_average"],
                })
            for row in summary.get("grade_by_subject", []):
                grade_terms[-1].setdefault("grade_average_by_subject", []).append({
                    "subject_id": row["subject_id"],
                    "subject_name": row["subject_name"],
                    "sumatif_average": row["sumatif_average"],
                    "formatif_average": row["formatif_average"],
                })
            kkm_sources = sorted({alert.get("threshold_source") for alert in summary.get("below_kkm_alerts", []) if alert.get("threshold_source")})
            kkm_terms.append({
                "period": term_label,
                "academic_year_id": academic_year.id,
                "term": term_value,
                "threshold_source": ", ".join(kkm_sources) if kkm_sources else None,
                "below_kkm_alert_count": len(summary.get("below_kkm_alerts", [])),
            })
            intervention_terms.append({
                "period": term_label,
                "academic_year_id": academic_year.id,
                "term": term_value,
                **_intervention_metrics(summary),
            })

    return attendance_terms, lateness_terms, lateness_by_class_terms, grade_terms, intervention_terms, kkm_terms, year_comparisons


def _average(values: list[float | int | None]) -> float | None:
    clean = [float(value) for value in values if value is not None]
    return round(sum(clean) / len(clean), 1) if clean else None


def _recurring_top_lateness_classes(lateness_by_class_terms: list[dict]) -> list[dict]:
    top_by_period = []
    for period in sorted({row["period"] for row in lateness_by_class_terms}):
        rows = [row for row in lateness_by_class_terms if row["period"] == period and row["late_days"] > 0]
        if rows:
            top_by_period.append(max(rows, key=lambda item: (item["late_days"], item["late_minutes"])))
    counts = Counter(row["class_name"] for row in top_by_period)
    return [
        {"class_name": class_name, "top_lateness_terms": count}
        for class_name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        if count >= 2
    ]


def generate_trend_insights(trends: dict, forecasts: list[dict]) -> list[dict]:
    insights = []
    attendance = trends.get("attendance", {}).get("by_term", [])
    if len(attendance) >= 3:
        recent = attendance[-3:]
        first = recent[0]["attendance_percentage"]
        last = recent[-1]["attendance_percentage"]
        if last < first:
            insights.append({
                "severity": "warning",
                "category": "trend",
                "title": "Attendance declined across recent terms",
                "message": f"Attendance decreased from {first}% to {last}% across the last 3 terms.",
                "metric_value": float(last),
                "recommended_action": "Review attendance drivers before the next term.",
            })
        elif last > first:
            insights.append({
                "severity": "info",
                "category": "trend",
                "title": "Attendance improved across recent terms",
                "message": f"Attendance increased from {first}% to {last}% across the last 3 terms.",
                "metric_value": float(last),
                "recommended_action": "Document practices that supported attendance improvement.",
            })

    recurring = trends.get("lateness", {}).get("recurring_top_classes", [])
    if recurring:
        top = recurring[0]
        insights.append({
            "severity": "warning",
            "category": "historical_comparison",
            "title": f"{top['class_name']} repeatedly leads lateness",
            "message": f"{top['class_name']} has been the top lateness contributor for {top['top_lateness_terms']} terms.",
            "metric_value": float(top["top_lateness_terms"]),
            "recommended_action": "Coordinate punctuality follow-up with the wali kelas.",
        })

    grades = trends.get("grades", {}).get("by_term", [])
    if len(grades) >= 2:
        previous = grades[-2]["below_kkm_alert_count"]
        latest = grades[-1]["below_kkm_alert_count"]
        if latest > previous:
            insights.append({
                "severity": "critical",
                "category": "trend",
                "title": "Below-KKM alerts are trending upward",
                "message": f"Below-KKM alerts increased from {previous} to {latest} in the latest term comparison.",
                "metric_value": float(latest),
                "recommended_action": "Prioritize remediation planning for affected subjects.",
            })

    interventions = trends.get("interventions", {}).get("by_term", [])
    if len(interventions) >= 2:
        previous_rate = interventions[-2]["resolution_rate"]
        latest_rate = interventions[-1]["resolution_rate"]
        if latest_rate > previous_rate:
            insights.append({
                "severity": "info",
                "category": "historical_comparison",
                "title": "Intervention resolution rate improved",
                "message": f"Resolution rate improved from {previous_rate}% to {latest_rate}% compared with the previous term.",
                "metric_value": float(latest_rate),
                "recommended_action": "Keep monitoring follow-up timeliness.",
            })

    for forecast in forecasts:
        if forecast.get("data_sufficiency") in ("insufficient", "limited"):
            insights.append({
                "severity": "info",
                "category": "forecast",
                "title": "Forecast confidence is limited",
                "message": forecast.get("warning") or "Forecast has limited confidence because historical data is sparse.",
                "metric_value": forecast.get("forecast_value"),
                "recommended_action": "Use the forecast as an estimate and collect more period history.",
            })
            break

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(insights, key=lambda item: severity_order.get(item["severity"], 3))


def build_historical_trends(
    db: Session,
    *,
    academic_year_id: int | None,
    jenjang_id: int | None = None,
    class_name: str | None = None,
    subject_id: int | None = None,
    term: str | None = None,
    from_academic_year_id: int | None = None,
    to_academic_year_id: int | None = None,
    granularity: str = "term",
    include_forecast: bool = True,
    forecast_method: str = "linear_trend",
) -> dict:
    if granularity not in {"month", "term", "academic_year"}:
        raise HTTPException(status_code=400, detail="granularity must be month, term, or academic_year")

    selected_year, jenjang_name, subject_name = _resolve_filters(db, academic_year_id, jenjang_id, subject_id)
    years = _academic_years_for_range(db, selected_year, from_academic_year_id, to_academic_year_id)
    attendance_months, month_warnings = _attendance_month_series(db, years, jenjang_name=jenjang_name, class_name=class_name)
    lateness_months = _lateness_month_series(db, years, jenjang_name=jenjang_name, class_name=class_name)
    (
        attendance_terms,
        lateness_terms,
        lateness_by_class_terms,
        grade_terms,
        intervention_terms,
        kkm_terms,
        year_comparisons,
    ) = _term_and_year_series(
        db,
        years,
        selected_academic_year_id=selected_year.id,
        jenjang_id=jenjang_id,
        class_name=class_name,
        subject_id=subject_id,
    )

    recurring_lateness = _recurring_top_lateness_classes(lateness_by_class_terms)
    diagnostics = []
    warnings = ["Forecasts are deterministic estimates based on historical trend data and do not imply certainty."]
    warnings.extend(month_warnings[:6])
    if not any(row["total_records"] for row in attendance_months):
        diagnostics.append({"code": "no_historical_records", "severity": "warning", "message": "No historical attendance records found for the selected filters."})
    if len([row for row in attendance_terms if row["total_records"] > 0]) <= 1:
        diagnostics.append({"code": "only_one_period_available", "severity": "warning", "message": "Only one populated attendance period is available."})
    if any(row["term_source"] == "default" for row in attendance_terms):
        diagnostics.append({"code": "term_fallback_used", "severity": "info", "message": "At least one historical term uses default term mapping."})
    if any(row.get("threshold_source") == "legacy-fallback" for row in kkm_terms):
        diagnostics.append({"code": "kkm_fallback_used", "severity": "info", "message": "Legacy KKM fallback was used in at least one historical period."})

    forecast_history = {
        "attendance_percentage": [row["attendance_percentage"] for row in attendance_terms if row["total_records"] > 0],
        "late_days": [row["late_days"] for row in lateness_terms],
        "late_minutes": [row["late_minutes"] for row in lateness_terms],
        "sumatif_average": [row["sumatif_average"] for row in grade_terms],
        "formatif_average": [row["formatif_average"] for row in grade_terms],
        "below_kkm_alert_count": [row["below_kkm_alert_count"] for row in grade_terms],
        "open_intervention_count": [row["open_interventions"] for row in intervention_terms],
    }
    forecasts = build_forecast_series(forecast_history, forecast_method) if include_forecast else []

    trends = {
        "attendance": {
            "by_month": attendance_months,
            "by_term": attendance_terms,
            "by_academic_year": year_comparisons,
        },
        "lateness": {
            "by_month": lateness_months,
            "by_term": lateness_terms,
            "by_class_terms": lateness_by_class_terms,
            "recurring_top_classes": recurring_lateness,
        },
        "grades": {
            "by_term": grade_terms,
            "effective_kkm_by_term": kkm_terms,
        },
        "interventions": {
            "by_term": intervention_terms,
        },
    }

    return {
        "filters": {
            "academic_year_id": selected_year.id,
            "academic_year_label": selected_year.label,
            "jenjang_id": jenjang_id,
            "jenjang_name": jenjang_name,
            "class_name": class_name,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "term": term,
            "from_academic_year_id": from_academic_year_id,
            "to_academic_year_id": to_academic_year_id,
            "granularity": granularity,
            "include_forecast": include_forecast,
            "forecast_method": forecast_method,
        },
        "period_definitions": [
            {
                "academic_year_id": year.id,
                "academic_year_label": year.label,
                "start_date": year.start_date.isoformat(),
                "end_date": year.end_date.isoformat(),
                "terms": effective_term_rows(db, year.id),
            }
            for year in years
        ],
        "trend_series": trends,
        "forecast_series": forecasts,
        "warnings": warnings,
        "data_quality_diagnostics": diagnostics,
        "effective_kkm_metadata": kkm_terms,
        "effective_term_metadata": [term for year in years for term in effective_term_rows(db, year.id)],
        "executive_insights": generate_trend_insights(trends, forecasts),
    }
