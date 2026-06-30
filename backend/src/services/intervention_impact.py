from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.academic_intervention import AcademicIntervention
from models.academic_year import AcademicYear
from models.assessment_component import AssessmentComponent
from models.jenjang import Jenjang
from models.student_subject_grade import StudentSubjectGrade
from models.student_enrollment import StudentEnrollment
from models.subject import Subject


ACTIVE_STATUSES = {"open", "in_progress", "monitoring"}
RESOLVED_STATUSES = {"resolved", "closed"}
OPEN_TOO_LONG_DAYS = 30


def _today() -> date:
    return date.today()


def _iso_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _iso_date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _round(value: float | None) -> float | None:
    return round(float(value), 1) if value is not None else None


def _latest_average(db: Session, row: AcademicIntervention) -> float | None:
    assessment_types = ["sumatif", "formatif"] if row.assessment_type in (None, "overall") else [row.assessment_type]
    query = (
        db.query(func.avg(StudentSubjectGrade.score).label("average_score"))
        .join(StudentEnrollment, StudentEnrollment.id == StudentSubjectGrade.enrollment_id)
        .join(AssessmentComponent, AssessmentComponent.id == StudentSubjectGrade.component_id)
        .filter(StudentEnrollment.student_id == row.student_id)
        .filter(StudentEnrollment.academic_year_id == row.academic_year_id)
        .filter(StudentSubjectGrade.subject_id == row.subject_id)
        .filter(StudentSubjectGrade.score.isnot(None))
        .filter(AssessmentComponent.assessment_type.in_(assessment_types))
    )
    if row.enrollment_id is not None:
        query = query.filter(StudentSubjectGrade.enrollment_id == row.enrollment_id)
    result = query.first()
    return _round(result.average_score if result else None)


def _days_open(row: AcademicIntervention, today: date) -> int:
    if row.created_at is None:
        return 0
    end_date = row.resolved_at.date() if row.resolved_at else today
    return max((end_date - row.created_at.date()).days, 0)


def score_intervention_risk(row: dict) -> tuple[str, list[str]]:
    score = 0
    reasons = []

    latest = row.get("latest_average")
    threshold = row.get("effective_threshold")
    delta = row.get("score_delta")

    if latest is None:
        score += 2
        reasons.append("Missing latest score")
    elif threshold is not None and latest < threshold:
        score += 2
        reasons.append("Still below effective KKM")

    if delta is None:
        score += 1
        reasons.append("Score delta cannot be calculated")
    elif delta <= 0:
        score += 2
        reasons.append("No score improvement after intervention")

    if row.get("is_overdue"):
        score += 2
        reasons.append("Follow-up overdue")

    if row.get("priority") == "urgent":
        score += 2
        reasons.append("Urgent priority")
    elif row.get("priority") == "high":
        score += 1
        reasons.append("High priority")

    if row.get("repeated_below_kkm_alerts", 0) > 1:
        score += 1
        reasons.append("Repeated Below-KKM alert context")

    if row.get("status") in ACTIVE_STATUSES and row.get("days_open", 0) > OPEN_TOO_LONG_DAYS:
        score += 1
        reasons.append("Open longer than 30 days")

    if score >= 6:
        return "critical", reasons
    if score >= 4:
        return "high", reasons
    if score >= 2:
        return "medium", reasons
    return "low", reasons or ["No immediate risk flags"]


def _apply_filters(query, *, academic_year_id, jenjang_id, class_name, student_id, subject_id, term, status, priority, owner_name):
    if academic_year_id is not None:
        query = query.filter(AcademicIntervention.academic_year_id == academic_year_id)
    if jenjang_id is not None:
        query = query.filter(AcademicIntervention.jenjang_id == jenjang_id)
    if class_name:
        query = query.filter(AcademicIntervention.class_name == class_name)
    if student_id is not None:
        query = query.filter(AcademicIntervention.student_id == student_id)
    if subject_id is not None:
        query = query.filter(AcademicIntervention.subject_id == subject_id)
    if term:
        query = query.filter(AcademicIntervention.term == term)
    if status:
        query = query.filter(AcademicIntervention.status == status)
    if priority:
        query = query.filter(AcademicIntervention.priority == priority)
    if owner_name:
        query = query.filter(AcademicIntervention.owner_name == owner_name)
    return query


def _counter_rows(counter: Counter) -> list[dict]:
    return [{"name": name, "count": count} for name, count in sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))]


def _average(values: list[float | int | None]) -> float | None:
    clean = [float(value) for value in values if value is not None]
    return round(sum(clean) / len(clean), 1) if clean else None


def _percent(count: int, total: int) -> float:
    return round((count / total) * 100, 1) if total else 0.0


def _breakdown(rows: list[dict], key: str, label_key: str) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row.get(key) or "Unassigned"].append(row)
    output = []
    for label, items in grouped.items():
        total = len(items)
        output.append({
            label_key: label,
            "total_interventions": total,
            "open_interventions": sum(1 for item in items if item["status"] in ACTIVE_STATUSES),
            "resolved_interventions": sum(1 for item in items if item["status"] in RESOLVED_STATUSES),
            "overdue_interventions": sum(1 for item in items if item["is_overdue"]),
            "average_score_delta": _average([item["score_delta"] for item in items]),
            "moved_above_kkm_percent": _percent(sum(1 for item in items if item["moved_above_kkm"]), total),
            "high_risk_count": sum(1 for item in items if item["risk_level"] in ("high", "critical")),
        })
    return sorted(output, key=lambda item: (-item["high_risk_count"], item[label_key]))


def generate_intervention_impact_insights(summary: dict, rows: list[dict], class_breakdown: list[dict], subject_breakdown: list[dict]) -> list[dict]:
    insights = []
    still_below = [row for row in rows if row["latest_average"] is not None and row["latest_average"] < row["effective_threshold"]]
    if still_below:
        insights.append({
            "severity": "warning" if len(still_below) < 5 else "critical",
            "category": "intervention_impact",
            "title": "Students remain below KKM after intervention",
            "message": f"{len(still_below)} students remain below KKM after intervention tracking.",
            "metric_value": float(len(still_below)),
            "recommended_action": "Review intervention plans and escalate students with high risk levels.",
        })

    overdue_high = [row for row in rows if row["is_overdue"] and row["priority"] in ("high", "urgent")]
    if overdue_high:
        insights.append({
            "severity": "critical",
            "category": "intervention_impact",
            "title": "High-priority interventions are overdue",
            "message": f"{len(overdue_high)} high or urgent priority interventions are overdue.",
            "metric_value": float(len(overdue_high)),
            "recommended_action": "Assign immediate owner follow-up for overdue high-risk interventions.",
        })

    if class_breakdown:
        top_class = max(class_breakdown, key=lambda item: item["open_interventions"])
        if top_class["open_interventions"] > 0:
            insights.append({
                "severity": "warning",
                "category": "intervention_impact",
                "title": f"{top_class['class_name']} has the highest unresolved intervention count",
                "message": f"{top_class['class_name']} has {top_class['open_interventions']} active interventions.",
                "metric_value": float(top_class["open_interventions"]),
                "recommended_action": "Coordinate class-level remediation with the wali kelas.",
            })

    improved_subjects = [item for item in subject_breakdown if item["average_score_delta"] is not None]
    if improved_subjects:
        best = max(improved_subjects, key=lambda item: item["average_score_delta"])
        if best["average_score_delta"] > 0:
            insights.append({
                "severity": "info",
                "category": "intervention_impact",
                "title": f"{best['subject_name']} interventions show the highest average improvement",
                "message": f"{best['subject_name']} has an average score delta of {best['average_score_delta']} points.",
                "metric_value": float(best["average_score_delta"]),
                "recommended_action": "Review effective practices from this subject for reuse.",
            })

    if summary["total_interventions"] == 0:
        insights.append({
            "severity": "info",
            "category": "intervention_impact",
            "title": "No intervention impact records found",
            "message": "No academic interventions match the selected filters.",
            "metric_value": 0.0,
            "recommended_action": "Create interventions from Below-KKM alerts before measuring impact.",
        })

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(insights, key=lambda item: severity_order.get(item["severity"], 3))


def build_intervention_impact(
    db: Session,
    *,
    academic_year_id: int | None = None,
    jenjang_id: int | None = None,
    class_name: str | None = None,
    student_id: int | None = None,
    subject_id: int | None = None,
    term: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    owner_name: str | None = None,
    risk_level: str | None = None,
) -> dict:
    if academic_year_id is not None and db.query(AcademicYear.id).filter(AcademicYear.id == academic_year_id).first() is None:
        raise HTTPException(status_code=404, detail="Academic year not found")
    if jenjang_id is not None and db.query(Jenjang.id).filter(Jenjang.id == jenjang_id).first() is None:
        raise HTTPException(status_code=404, detail="Jenjang not found")
    if subject_id is not None and db.query(Subject.id).filter(Subject.id == subject_id).first() is None:
        raise HTTPException(status_code=404, detail="Subject not found")

    today = _today()
    base_query = db.query(AcademicIntervention)
    query = _apply_filters(
        base_query,
        academic_year_id=academic_year_id,
        jenjang_id=jenjang_id,
        class_name=class_name,
        student_id=student_id,
        subject_id=subject_id,
        term=term,
        status=status,
        priority=priority,
        owner_name=owner_name,
    )
    interventions = query.order_by(AcademicIntervention.updated_at.desc(), AcademicIntervention.id.desc()).all()
    context_counts = Counter((row.student_id, row.subject_id, row.assessment_type, row.term) for row in interventions)
    impact_rows = []
    warnings = ["Baseline score uses the intervention's captured current_average snapshot; latest score uses the current grade ledger average."]

    for row in interventions:
        baseline = _round(row.current_average)
        latest = _latest_average(db, row)
        delta = _round((latest - baseline) if latest is not None and baseline is not None else None)
        is_resolved = row.status in RESOLVED_STATUSES
        is_overdue = row.status in ACTIVE_STATUSES and row.follow_up_date is not None and row.follow_up_date < today
        moved_above = bool(latest is not None and latest >= row.effective_threshold and (baseline is None or baseline < row.effective_threshold))
        item = {
            "intervention_id": row.id,
            "student_id": row.student_id,
            "student_name": row.student_name,
            "class_name": row.class_name or "Unassigned",
            "subject_id": row.subject_id,
            "subject_name": row.subject_name,
            "assessment_type": row.assessment_type,
            "term": row.term,
            "status": row.status,
            "priority": row.priority,
            "owner_name": row.owner_name or "Unassigned",
            "created_at": _iso_dt(row.created_at),
            "updated_at": _iso_dt(row.updated_at),
            "resolved_at": _iso_dt(row.resolved_at),
            "follow_up_date": _iso_date(row.follow_up_date),
            "baseline_average": baseline,
            "latest_average": latest,
            "score_delta": delta,
            "effective_threshold": float(row.effective_threshold),
            "threshold_source": row.threshold_source,
            "moved_above_kkm": moved_above,
            "days_open": _days_open(row, today),
            "is_overdue": is_overdue,
            "resolution_status": "resolved" if is_resolved else "active",
            "follow_up_status": "overdue" if is_overdue else ("scheduled" if row.follow_up_date and row.status in ACTIVE_STATUSES else "none"),
            "repeated_below_kkm_alerts": context_counts[(row.student_id, row.subject_id, row.assessment_type, row.term)],
        }
        item["risk_level"], item["risk_reasons"] = score_intervention_risk(item)
        impact_rows.append(item)

    if risk_level:
        impact_rows = [row for row in impact_rows if row["risk_level"] == risk_level]

    total = len(impact_rows)
    resolved_rows = [row for row in impact_rows if row["status"] in RESOLVED_STATUSES]
    resolved_durations = [row["days_open"] for row in resolved_rows]
    summary = {
        "total_interventions": total,
        "open_interventions": sum(1 for row in impact_rows if row["status"] in ACTIVE_STATUSES),
        "resolved_interventions": len(resolved_rows),
        "overdue_interventions": sum(1 for row in impact_rows if row["is_overdue"]),
        "high_urgent_priority_count": sum(1 for row in impact_rows if row["priority"] in ("high", "urgent")),
        "average_score_delta": _average([row["score_delta"] for row in impact_rows]),
        "percent_improved": _percent(sum(1 for row in impact_rows if row["score_delta"] is not None and row["score_delta"] > 0), total),
        "percent_moved_above_kkm": _percent(sum(1 for row in impact_rows if row["moved_above_kkm"]), total),
        "average_days_to_resolution": _average(resolved_durations),
        "interventions_by_status": dict(Counter(row["status"] for row in impact_rows)),
        "interventions_by_priority": dict(Counter(row["priority"] for row in impact_rows)),
        "risk_distribution": dict(Counter(row["risk_level"] for row in impact_rows)),
    }

    class_breakdown = _breakdown(impact_rows, "class_name", "class_name")
    subject_breakdown = _breakdown(impact_rows, "subject_name", "subject_name")
    owner_workload = _breakdown(impact_rows, "owner_name", "owner_name")
    student_risk = sorted(
        [
            {
                "student_id": row["student_id"],
                "student_name": row["student_name"],
                "class_name": row["class_name"],
                "subject_name": row["subject_name"],
                "risk_level": row["risk_level"],
                "risk_reasons": row["risk_reasons"],
                "latest_average": row["latest_average"],
                "effective_threshold": row["effective_threshold"],
                "is_overdue": row["is_overdue"],
            }
            for row in impact_rows
            if row["risk_level"] in ("high", "critical")
        ],
        key=lambda item: ({"critical": 0, "high": 1}.get(item["risk_level"], 2), item["student_name"]),
    )

    return {
        "filters": {
            "academic_year_id": academic_year_id,
            "jenjang_id": jenjang_id,
            "class_name": class_name,
            "student_id": student_id,
            "subject_id": subject_id,
            "term": term,
            "status": status,
            "priority": priority,
            "owner_name": owner_name,
            "risk_level": risk_level,
        },
        "summary": summary,
        "impact_rows": impact_rows,
        "class_breakdown": class_breakdown,
        "subject_breakdown": subject_breakdown,
        "student_risk_list": student_risk,
        "owner_workload_summary": owner_workload,
        "warnings": warnings,
        "executive_insights": generate_intervention_impact_insights(summary, impact_rows, class_breakdown, subject_breakdown),
    }
