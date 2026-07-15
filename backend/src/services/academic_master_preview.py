from collections import Counter

from sqlalchemy.orm import Session

from models.academic_master import AcademicClass, AcademicMasterImportPreview, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang


def create_academic_master_preview(db: Session, payload: dict, source_owner: str, username: str):
    results = []
    existing_jenjang_by_code = {row.code: row for row in db.query(Jenjang).filter(Jenjang.code.isnot(None)).all()}
    existing_jenjang_by_name = {row.name: row for row in db.query(Jenjang).all()}
    proposed_codes = {}
    proposed_names = set()
    for index, item in enumerate(payload.get("jenjangs", []), 1):
        errors = []
        code, name, level = item.get("code"), item.get("name"), item.get("level")
        if not code or not name or not isinstance(level, int) or level < 1:
            errors.append("code, name, and positive integer level are required")
        if code in proposed_codes or name in proposed_names:
            errors.append("duplicate proposed jenjang")
        existing = existing_jenjang_by_code.get(code) or existing_jenjang_by_name.get(name)
        classification = "INVALID" if errors else ("EXISTS" if existing and existing.code == code and existing.name == name and existing.level == level else "CONFLICT" if existing else "NEW")
        proposed_codes[code] = item; proposed_names.add(name)
        results.append({"type": "jenjang", "row": index, "classification": classification, "payload": item, "errors": errors})

    known_codes = set(existing_jenjang_by_code) | set(proposed_codes)
    program_keys = set()
    for index, item in enumerate(payload.get("programs", []), 1):
        errors = []
        key = (item.get("jenjang_code"), item.get("name"))
        if not all(key): errors.append("jenjang_code and name are required")
        if key[0] not in known_codes: errors.append("unknown jenjang_code")
        if key in program_keys: errors.append("duplicate proposed program")
        program_keys.add(key)
        classification = "INVALID" if errors else "NEW"
        results.append({"type": "program", "row": index, "classification": classification, "payload": item, "errors": errors})

    class_keys = set()
    for index, item in enumerate(payload.get("classes", []), 1):
        errors = []
        year = db.query(AcademicYear).filter_by(label=item.get("academic_year")).first()
        key = (item.get("academic_year"), item.get("jenjang_code"), item.get("class_name"))
        if year is None: errors.append("unknown academic year")
        if item.get("jenjang_code") not in known_codes: errors.append("unknown jenjang_code")
        if (item.get("jenjang_code"), item.get("program")) not in program_keys:
            errors.append("program is not defined in this preview")
        if not item.get("class_name"): errors.append("class_name is required")
        if key in class_keys: errors.append("duplicate class within academic year and jenjang")
        class_keys.add(key)
        classification = "INVALID" if errors else "NEW"
        results.append({"type": "class", "row": index, "classification": classification, "payload": item, "errors": errors})

    counts = Counter(row["classification"] for row in results)
    validation = {"summary": {"total": len(results), **{key.casefold(): counts[key] for key in ("NEW", "EXISTS", "CONFLICT", "INVALID")}}, "rows": results}
    preview = AcademicMasterImportPreview(
        source_owner=source_owner, created_by=username, proposed_data=payload,
        validation_result=validation,
    )
    db.add(preview); db.commit(); db.refresh(preview)
    return preview

