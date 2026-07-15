from collections import Counter

from sqlalchemy.orm import Session

from models.academic_mapping import StudentAcademicMappingRule
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentMaster
from services.student_normalization import normalize_name


def approved_rule_map(db: Session, mapping_type: str) -> dict[str, StudentAcademicMappingRule]:
    rows = db.query(StudentAcademicMappingRule).filter(
        StudentAcademicMappingRule.mapping_type == mapping_type,
        StudentAcademicMappingRule.status == "approved",
    ).all()
    return {row.normalized_source_value: row for row in rows}


def resolve_jenjang(
    source_value: str | None,
    exact: dict[str, Jenjang],
    normalized: dict[str, list[Jenjang]],
    approved: dict[str, StudentAcademicMappingRule],
) -> tuple[Jenjang | None, str, str | None]:
    if not source_value or not source_value.strip():
        return None, "EMPTY_JENJANG", None
    clean = source_value.strip()
    if clean in exact:
        return exact[clean], "MATCHED_JENJANG", "EXACT"
    key = normalize_name(clean)
    rule = approved.get(key)
    if rule is not None:
        target = next((row for rows in normalized.values() for row in rows if row.id == rule.target_id), None)
        return (target, "MATCHED_JENJANG", "APPROVED_RULE") if target else (None, "UNMATCHED_JENJANG", "INVALID_RULE_TARGET")
    candidates = normalized.get(key, [])
    if len(candidates) > 1:
        return None, "UNMATCHED_JENJANG", "AMBIGUOUS"
    if len(candidates) == 1:
        return None, "UNMATCHED_JENJANG", "NORMALIZED_REVIEW_REQUIRED"
    return None, "UNMATCHED_JENJANG", "MISSING"


def resolve_class(
    source_value: str | None,
    approved: dict[str, StudentAcademicMappingRule],
) -> tuple[str | None, str, str | None]:
    if not source_value or not source_value.strip():
        return None, "EMPTY_CLASS", None
    rule = approved.get(normalize_name(source_value))
    if rule is None:
        return None, "UNMATCHED_CLASS", "APPROVAL_REQUIRED"
    return rule.target_value.strip(), "MATCHED_CLASS", "APPROVED_RULE"


def build_academic_mapping_preview(db: Session) -> dict:
    jenjangs = db.query(Jenjang).order_by(Jenjang.id.asc()).all()
    exact = {row.name: row for row in jenjangs}
    normalized: dict[str, list[Jenjang]] = {}
    for row in jenjangs:
        normalized.setdefault(normalize_name(row.name), []).append(row)
    jenjang_rules = approved_rule_map(db, "jenjang")
    class_rules = approved_rule_map(db, "class")
    mappings = {
        row.legacy_student_id: row.student_master_id
        for row in db.query(StudentDeviceIdentity).filter(
            StudentDeviceIdentity.is_active.is_(True),
            StudentDeviceIdentity.legacy_student_id.isnot(None),
        ).all()
    }
    enrolled_ids = {
        row.student_master_id for row in db.query(StudentEnrollment).filter(
            StudentEnrollment.student_master_id.isnot(None)
        ).all()
    }
    rows = []
    for student in db.query(Student).order_by(Student.id.asc()).all():
        master_id = mappings.get(student.id)
        master = db.get(StudentMaster, master_id) if master_id else None
        canonical, jenjang_state, jenjang_match = resolve_jenjang(
            student.jenjang, exact, normalized, jenjang_rules
        )
        target_class, class_state, class_match = resolve_class(student.class_name, class_rules)
        rows.append({
            "student_master_id": master_id,
            "legacy_student_id": student.id,
            "student_display_name": master.full_name if master else student.name,
            "legacy_jenjang": student.jenjang,
            "legacy_class_name": student.class_name,
            "enrollment_status": "ENROLLED" if master_id in enrolled_ids else "NOT_ENROLLED",
            "jenjang_classification": jenjang_state,
            "class_classification": class_state,
            "proposed_jenjang_id": canonical.id if canonical else None,
            "proposed_jenjang": canonical.name if canonical else None,
            "jenjang_match": jenjang_match,
            "proposed_class": target_class,
            "class_match": class_match,
        })
    classifications = Counter()
    for row in rows:
        classifications[row["jenjang_classification"]] += 1
        classifications[row["class_classification"]] += 1
    return {
        "summary": {
            "total": len(rows),
            "empty_jenjang": classifications["EMPTY_JENJANG"],
            "unmatched_jenjang": classifications["UNMATCHED_JENJANG"],
            "matched_jenjang": classifications["MATCHED_JENJANG"],
            "empty_class": classifications["EMPTY_CLASS"],
            "unmatched_class": classifications["UNMATCHED_CLASS"],
            "matched_class": classifications["MATCHED_CLASS"],
        },
        "canonical_jenjangs": [{"id": row.id, "name": row.name} for row in jenjangs],
        "rows": rows,
    }

