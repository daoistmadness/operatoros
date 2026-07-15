import hashlib
from collections import Counter
from datetime import date, datetime
from io import BytesIO

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.academic_mapping import StudentAcademicMappingRule
from models.academic_roster import AcademicRosterImportBatch
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentDeviceIdentity, StudentEnrollmentClassHistory, StudentMaster
from services.student_normalization import normalize_name


ROSTER_CONFIRMATION = "COMMIT_ACADEMIC_ROSTER"
REQUIRED = {"student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"}
OPTIONAL = {"student_master_id", "nipd", "nisn", "nik", "birth_date", "homeroom_teacher", "admission_type", "start_date"}


def _text(value):
    return None if pd.isna(value) or not str(value).strip() else str(value).strip()


def _date(value):
    parsed = pd.to_datetime(value, errors="coerce")
    return parsed.date().isoformat() if not pd.isna(parsed) else None


def _approved_class_rules(db):
    return {
        row.normalized_source_value: row.target_value
        for row in db.query(StudentAcademicMappingRule).filter_by(mapping_type="class", status="approved").all()
    }


def _match_master(db: Session, payload: dict) -> tuple[StudentMaster | None, str | None]:
    if payload.get("student_master_id"):
        master = db.get(StudentMaster, payload["student_master_id"])
        return master, "student_master_id" if master else None
    for key in ("nipd", "nisn", "nik"):
        value = payload.get(key)
        if value:
            matches = db.query(StudentMaster).filter(getattr(StudentMaster, key) == value).all()
            if len(matches) == 1:
                return matches[0], key
            if len(matches) > 1:
                return None, "ambiguous_identifier"
    identifier = payload.get("student_identifier")
    if identifier:
        mappings = db.query(StudentDeviceIdentity).filter(
            StudentDeviceIdentity.device_identifier == identifier,
            StudentDeviceIdentity.is_active.is_(True),
        ).all()
        if len(mappings) == 1:
            return db.get(StudentMaster, mappings[0].student_master_id), "approved_device_identity"
        if len(mappings) > 1:
            return None, "ambiguous_device_identity"
    if payload.get("birth_date"):
        matches = db.query(StudentMaster).filter(
            StudentMaster.normalized_name == normalize_name(payload["student_name"]),
            StudentMaster.birth_date == date.fromisoformat(payload["birth_date"]),
        ).all()
        if len(matches) == 1:
            return matches[0], "normalized_name_birth_date"
        if len(matches) > 1:
            return None, "ambiguous_name_birth_date"
    return None, None


def create_roster_preview(db: Session, file_bytes: bytes, filename: str, owner: str, received: date, username: str):
    workbook = pd.ExcelFile(BytesIO(file_bytes), engine="openpyxl")
    frames = []
    for sheet in workbook.sheet_names:
        frame = pd.read_excel(workbook, sheet_name=sheet)
        frame.columns = [str(column).strip().casefold().replace(" ", "_") for column in frame.columns]
        missing = REQUIRED - set(frame.columns)
        if missing:
            raise ValueError(f"Sheet '{sheet}' missing required columns: {', '.join(sorted(missing))}")
        frame["__sheet"] = sheet
        frame["__row"] = frame.index + 2
        frames.append(frame)
    source = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    canonical_jenjang = {row.name: row for row in db.query(Jenjang).all()}
    class_rules = _approved_class_rules(db)
    rows = []
    seen_enrollment_keys = set()
    for _, raw in source.iterrows():
        payload = {key: _text(raw.get(key)) for key in REQUIRED | OPTIONAL}
        payload["birth_date"] = _date(raw.get("birth_date"))
        payload["start_date"] = _date(raw.get("start_date"))
        errors = []
        if not payload["student_name"] or not payload["student_identifier"]:
            classification = "INVALID"
            errors.append("Student identifier and name are required")
            master = None
            match_rule = None
        else:
            master, match_rule = _match_master(db, payload)
            if master is None:
                classification = "AMBIGUOUS" if match_rule and match_rule.startswith("ambiguous") else "NEW_STUDENT"
            else:
                year = db.query(AcademicYear).filter(AcademicYear.label == payload["academic_year"]).first()
                jenjang = canonical_jenjang.get(payload["jenjang"])
                target_class = class_rules.get(normalize_name(payload["class_name"] or ""))
                if year is None:
                    classification = "INVALID"; errors.append("Unknown academic year")
                elif jenjang is None:
                    classification = "MISSING_JENJANG"; errors.append("Unknown canonical jenjang")
                elif not target_class:
                    classification = "MISSING_CLASS"; errors.append("Class lacks an approved mapping rule")
                elif not payload["status"] or payload["status"].casefold() != "active":
                    classification = "INVALID"; errors.append("Only active roster rows are committable")
                else:
                    key = (master.id, year.id)
                    existing = db.query(StudentEnrollment).filter_by(student_master_id=master.id, academic_year_id=year.id).first()
                    if existing or key in seen_enrollment_keys:
                        classification = "INVALID"; errors.append("Duplicate enrollment for academic year")
                    else:
                        classification = "MATCHED"
                        seen_enrollment_keys.add(key)
                        payload.update({
                            "academic_year_id": year.id, "academic_year_start": year.start_date.isoformat(),
                            "jenjang_id": jenjang.id, "target_class": target_class,
                        })
        rows.append({
            "preview_row_id": len(rows) + 1,
            "source_sheet": raw["__sheet"], "source_row": int(raw["__row"]),
            "classification": classification, "matched_student_master_id": master.id if master else None,
            "match_rule": match_rule, "payload": payload, "errors": errors,
        })
    counts = Counter(row["classification"] for row in rows)
    summary = {"total": len(rows), **{key.casefold(): counts[key] for key in ("MATCHED", "NEW_STUDENT", "AMBIGUOUS", "MISSING_JENJANG", "MISSING_CLASS", "INVALID")}}
    batch = AcademicRosterImportBatch(
        filename=filename, checksum=hashlib.sha256(file_bytes).hexdigest(), source_owner=owner,
        date_received=received, created_by=username, rows=rows, summary=summary,
    )
    db.add(batch); db.commit(); db.refresh(batch)
    return batch


def commit_roster_preview(db: Session, preview_id: str, selected_rows: list[int], confirmation: str, username: str):
    if confirmation != ROSTER_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    batch = db.get(AcademicRosterImportBatch, preview_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Roster preview not found")
    if batch.status == "committed":
        return batch.commit_result
    selected = [row for row in batch.rows if row["preview_row_id"] in set(selected_rows)]
    if not selected or len(selected) != len(set(selected_rows)):
        raise HTTPException(status_code=400, detail="Selected rows are not part of the preview")
    blocked = [row["preview_row_id"] for row in selected if row["classification"] != "MATCHED"]
    if blocked:
        raise HTTPException(status_code=409, detail=f"Selected rows are not committable: {blocked}")
    created = 0
    try:
        for row in selected:
            payload = row["payload"]
            if db.query(StudentEnrollment).filter_by(
                student_master_id=row["matched_student_master_id"], academic_year_id=payload["academic_year_id"]
            ).first():
                raise HTTPException(status_code=409, detail=f"Enrollment changed after preview row {row['source_row']}")
            mapping = db.query(StudentDeviceIdentity).filter_by(
                student_master_id=row["matched_student_master_id"], is_active=True
            ).one()
            effective_from = date.fromisoformat(
                payload.get("start_date") or payload["academic_year_start"]
            )
            enrollment = StudentEnrollment(
                student_id=mapping.legacy_student_id, student_master_id=row["matched_student_master_id"],
                academic_year_id=payload["academic_year_id"], jenjang_id=payload["jenjang_id"],
                class_name=payload["target_class"], class_assigned=True,
                effective_from=effective_from,
            )
            db.add(enrollment); db.flush()
            db.add(StudentEnrollmentClassHistory(
                enrollment_id=enrollment.id, class_name=enrollment.class_name,
                effective_from=enrollment.effective_from, changed_by=username, source="academic_roster_import",
            ))
            created += 1
        result = {"status": "committed", "preview_id": batch.id, "created": created}
        batch.status = "committed"; batch.committed_by = username; batch.committed_at = datetime.now(); batch.commit_result = result
        db.commit(); return result
    except Exception:
        db.rollback(); raise
