import hashlib
import json
from collections import Counter

from sqlalchemy.orm import Session

from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang


CLASSIFICATIONS = ("CREATE", "UPDATE", "MATCH_EXISTING", "CONFLICT", "INVALID")


def _classification(errors: list[str], existing, matches: bool) -> str:
    if errors:
        return "INVALID"
    if existing is None:
        return "CREATE"
    return "MATCH_EXISTING" if matches else "UPDATE"


def create_academic_master_preview(db: Session, payload: dict, source_owner: str, username: str) -> dict:
    """Validate an academic hierarchy without writing any database row."""
    results: list[dict] = []

    proposed_years = {row["name"]: row for row in payload.get("academic_years", [])}
    for index, item in enumerate(payload.get("academic_years", []), 1):
        errors = []
        if item.get("start_date") is None or item.get("end_date") is None:
            errors.append("start_date and end_date are required")
        elif item["end_date"] < item["start_date"]:
            errors.append("end_date must be on or after start_date")
        existing = db.query(AcademicYear).filter_by(label=item["name"]).first()
        matches = bool(existing and existing.start_date == item.get("start_date") and existing.end_date == item.get("end_date") and existing.status == ("active" if item["is_active"] else "upcoming") and existing.is_default == item["is_default"])
        results.append({"type": "academic_year", "row": index, "classification": _classification(errors, existing, matches), "payload": item, "errors": errors})

    existing_by_code = {row.code: row for row in db.query(Jenjang).filter(Jenjang.code.isnot(None)).all()}
    existing_by_name = {}
    for row in db.query(Jenjang).all():
        existing_by_name.setdefault(row.name, []).append(row)
    proposed_codes: dict[str, dict] = {}
    for index, item in enumerate(payload.get("jenjangs", []), 1):
        errors = []
        code, name = item["code"], item["name"]
        if code in proposed_codes:
            errors.append("duplicate proposed jenjang code")
        proposed_codes[code] = item
        existing = existing_by_code.get(code)
        if existing is None:
            name_matches = existing_by_name.get(name, [])
            existing = name_matches[0] if len(name_matches) == 1 else None
            if len(name_matches) > 1:
                errors.append("ambiguous existing jenjang name")
        matches = bool(existing and existing.code == code and existing.name == name and existing.level == item["level"] and existing.active == item["active"])
        results.append({"type": "jenjang", "row": index, "classification": _classification(errors, existing, matches), "payload": item, "existing_id": existing.id if existing else None, "errors": errors})

    known_codes = set(existing_by_code) | set(proposed_codes)
    proposed_programs: set[tuple[str, str]] = set()
    for index, item in enumerate(payload.get("programs", []), 1):
        errors = []
        key = (item["jenjang_code"], item["name"])
        if key[0] not in known_codes:
            errors.append("unknown jenjang_code")
        if key in proposed_programs:
            errors.append("duplicate proposed program")
        proposed_programs.add(key)
        existing = None
        jenjang = existing_by_code.get(key[0])
        if jenjang:
            existing = db.query(AcademicProgram).filter_by(jenjang_id=jenjang.id, name=key[1]).first()
        matches = bool(existing and existing.active == item["active"])
        results.append({"type": "program", "row": index, "classification": _classification(errors, existing, matches), "payload": item, "errors": errors})

    proposed_grades: set[tuple[str, str, str]] = set()
    for index, item in enumerate(payload.get("grades", []), 1):
        errors = []
        program_key = (item["jenjang_code"], item["program"])
        key = (*program_key, item["name"])
        if program_key not in proposed_programs:
            errors.append("program is not defined in this preview")
        if key in proposed_grades:
            errors.append("duplicate proposed grade")
        proposed_grades.add(key)
        results.append({"type": "grade", "row": index, "classification": "INVALID" if errors else "CREATE", "payload": item, "errors": errors})

    class_keys: set[tuple[str, str, str]] = set()
    for index, item in enumerate(payload.get("classes", []), 1):
        errors = []
        grade_key = (item["jenjang_code"], item["program"], item["grade"])
        key = (item["academic_year"], item["grade"], item["class_name"])
        if item["academic_year"] not in proposed_years and db.query(AcademicYear).filter_by(label=item["academic_year"]).first() is None:
            errors.append("unknown academic year")
        if grade_key not in proposed_grades:
            errors.append("grade is not defined in this preview")
        if key in class_keys:
            errors.append("duplicate class within academic year and grade")
        class_keys.add(key)
        results.append({"type": "class", "row": index, "classification": "INVALID" if errors else "CREATE", "payload": item, "errors": errors})

    counts = Counter(row["classification"] for row in results)
    canonical = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return {
        "preview_id": hashlib.sha256(canonical.encode()).hexdigest(),
        "status": "review_required",
        "source_owner": source_owner,
        "created_by": username,
        "summary": {"total": len(results), **{key.casefold(): counts[key] for key in CLASSIFICATIONS}},
        "rows": results,
    }
