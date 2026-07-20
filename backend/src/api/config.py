from datetime import datetime
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.absence_reason import AbsenceReason
from models.absence_reason_class_entry import AbsenceReasonClassEntry
from models.heb_override import HebOverride
from models.jenjang_config import JenjangConfig
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.academic_master import AcademicClass
from models.academic_year import AcademicYear
from models.user import User
from security.dependencies import get_current_user, require_role
from services.attendance_metrics import derive_jenjang_from_class_name

router = APIRouter()

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class JenjangCutoffBody(BaseModel):
    cutoff_time: str


class HebOverrideBody(BaseModel):
    heb_value: int
    note: str | None = None
    set_by: str


class AbsenceReasonBody(BaseModel):
    student_id: int
    sakit: int = 0
    izin: int = 0
    alfa: int = 0
    note: str | None = None


class BulkAbsenceReasonBody(BaseModel):
    month: int
    year: int
    entered_by: str
    updates: list[AbsenceReasonBody]


class AbsenceReasonClassEntryBody(BaseModel):
    class_name: str
    month: int
    year: int
    sakit: int = 0
    izin: int = 0
    alfa: int = 0
    note: str | None = None
    entered_by: str


class BulkAbsenceReasonCatchupBody(BaseModel):
    entries: list[AbsenceReasonClassEntryBody]


def _validate_cutoff_time(value: str) -> str:
    cutoff = value.strip()
    if not TIME_PATTERN.match(cutoff):
        raise HTTPException(status_code=400, detail="cutoff_time must be in HH:MM format")
    return cutoff


def _validate_reporting_period(month: int, year: int) -> None:
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    if year < 2020:
        raise HTTPException(status_code=400, detail="year must be greater than or equal to 2020")


def _serialize_heb_override(row: HebOverride) -> dict:
    return {
        "id": row.id,
        "jenjang": row.jenjang,
        "month": row.month,
        "year": row.year,
        "heb_value": row.heb_value,
        "note": row.note,
        "source": "manual",
        "set_by": row.set_by,
        "set_at": row.set_at.isoformat() if row.set_at else None,
    }


def _get_available_jenjangs(db: Session) -> list[str]:
    rows = db.query(Student.jenjang).filter(Student.jenjang.isnot(None)).distinct().all()
    return sorted({row[0].strip() for row in rows if isinstance(row[0], str) and row[0].strip()})


def _get_available_classes(db: Session, class_name: str | None = None) -> list[dict]:
    query = db.query(Student.class_name, Student.jenjang).filter(Student.class_name.isnot(None))
    if class_name is not None:
        query = query.filter(Student.class_name == class_name)

    rows = query.order_by(Student.class_name.asc()).all()
    classes_by_name: dict[str, dict] = {}

    for row in rows:
        normalized_class_name = row.class_name.strip() if isinstance(row.class_name, str) else ""
        if not normalized_class_name:
            continue

        normalized_jenjang = row.jenjang.strip() if isinstance(row.jenjang, str) and row.jenjang.strip() else derive_jenjang_from_class_name(normalized_class_name)
        existing = classes_by_name.get(normalized_class_name)
        if existing is None:
            classes_by_name[normalized_class_name] = {
                "class_name": normalized_class_name,
                "jenjang": normalized_jenjang,
            }
            continue

        if (not existing["jenjang"] or existing["jenjang"] == "Unassigned") and normalized_jenjang:
            existing["jenjang"] = normalized_jenjang

    return sorted(classes_by_name.values(), key=lambda item: (item["jenjang"], item["class_name"]))


def _serialize_absence_reason_entry(
    *,
    student_id: int,
    student_name: str,
    class_name: str,
    jenjang: str,
    month: int,
    year: int,
    sakit: int,
    izin: int,
    alfa: int,
    note: str | None,
    entered_by: str | None,
    has_data: bool,
    row: AbsenceReason | None = None,
) -> dict:
    payload = {
        "student_id": student_id,
        "student_name": student_name,
        "class_name": class_name,
        "jenjang": jenjang,
        "month": month,
        "year": year,
        "sakit": sakit,
        "izin": izin,
        "alfa": alfa,
        "total": sakit + izin + alfa,
        "note": note or "",
        "entered_by": entered_by,
        "has_data": has_data,
    }

    if row is not None:
        payload["id"] = row.id
        payload["entered_at"] = row.entered_at.isoformat() if row.entered_at else None
        payload["updated_at"] = row.updated_at.isoformat() if row.updated_at else None

    return payload


def _build_absence_reason_rows(db: Session, month: int, year: int, class_name: str | None = None) -> list[dict]:
    _validate_reporting_period(month, year)

    # If class_name is provided, we drill down to students.
    # Otherwise, we return a summary report per class (aggregated).
    if class_name:
        normalized_class_name = class_name.strip()
        class_level_row = (
            db.query(AbsenceReasonClassEntry)
            .filter(
                AbsenceReasonClassEntry.class_name == normalized_class_name,
                AbsenceReasonClassEntry.month == month,
                AbsenceReasonClassEntry.year == year,
            )
            .first()
        )
        if class_level_row is not None:
            return [
                {
                    "student_id": 0,
                    "student_name": "Rekap Kelas",
                    "class_name": normalized_class_name,
                    "jenjang": _get_available_classes(db, normalized_class_name)[0]["jenjang"] if _get_available_classes(db, normalized_class_name) else derive_jenjang_from_class_name(normalized_class_name),
                    "month": month,
                    "year": year,
                    "sakit": int(class_level_row.sakit or 0),
                    "izin": int(class_level_row.izin or 0),
                    "alfa": int(class_level_row.alfa or 0),
                    "total": int((class_level_row.sakit or 0) + (class_level_row.izin or 0) + (class_level_row.alfa or 0)),
                    "note": class_level_row.note or "",
                    "entered_by": class_level_row.entered_by,
                    "has_data": True,
                    "entry_mode": "class",
                    "id": class_level_row.id,
                    "entered_at": class_level_row.entered_at.isoformat() if class_level_row.entered_at else None,
                    "updated_at": class_level_row.updated_at.isoformat() if class_level_row.updated_at else None,
                }
            ]

        students = db.query(Student).filter(Student.class_name == normalized_class_name).order_by(Student.name.asc()).all()
        
        # Exclude students with unassigned class if class_name filter is specifically "Unassigned" (fallback)
        if normalized_class_name.lower() == "unassigned":
             students = db.query(Student).filter(Student.class_name.is_(None)).order_by(Student.name.asc()).all()

        existing_rows = (
            db.query(AbsenceReason)
            .filter(
                AbsenceReason.class_name == normalized_class_name,
                AbsenceReason.month == month,
                AbsenceReason.year == year
            )
            .all()
        )
        existing_by_student = {row.student_id: row for row in existing_rows}

        results = []
        for s in students:
            row = existing_by_student.get(s.id)
            if row is None:
                results.append(
                    _serialize_absence_reason_entry(
                        student_id=s.id,
                        student_name=s.name,
                        class_name=normalized_class_name,
                        jenjang=s.jenjang or derive_jenjang_from_class_name(normalized_class_name),
                        month=month,
                        year=year,
                        sakit=0,
                        izin=0,
                        alfa=0,
                        note="",
                        entered_by=None,
                        has_data=False,
                    )
                )
            else:
                results.append(
                    _serialize_absence_reason_entry(
                        student_id=s.id,
                        student_name=s.name,
                        class_name=normalized_class_name,
                        jenjang=s.jenjang or derive_jenjang_from_class_name(normalized_class_name),
                        month=month,
                        year=year,
                        sakit=row.sakit,
                        izin=row.izin,
                        alfa=row.alfa,
                        note=row.note,
                        entered_by=row.entered_by,
                        has_data=True,
                        row=row,
                    )
                )
        return results

    # Global summary view (per class aggregate)
    classes = _get_available_classes(db)
    class_level_rows = (
        db.query(AbsenceReasonClassEntry)
        .filter(AbsenceReasonClassEntry.month == month, AbsenceReasonClassEntry.year == year)
        .all()
    )
    class_level_map = {row.class_name: row for row in class_level_rows}
    
    # Aggregate data from student-level AbsenceReason records
    summary_query = (
        db.query(
            AbsenceReason.class_name,
            func.sum(AbsenceReason.sakit).label("sakit"),
            func.sum(AbsenceReason.izin).label("izin"),
            func.sum(AbsenceReason.alfa).label("alfa"),
            func.max(AbsenceReason.updated_at).label("latest_update")
        )
        .filter(AbsenceReason.month == month, AbsenceReason.year == year)
        .group_by(AbsenceReason.class_name)
        .all()
    )
    summary_by_class = {row.class_name: row for row in summary_query}

    results = []
    for item in classes:
        class_level = class_level_map.get(item["class_name"])
        agg = summary_by_class.get(item["class_name"])
        if class_level is not None:
            results.append({
                "class_name": item["class_name"],
                "jenjang": item["jenjang"],
                "month": month,
                "year": year,
                "sakit": int(class_level.sakit or 0),
                "izin": int(class_level.izin or 0),
                "alfa": int(class_level.alfa or 0),
                "total": int((class_level.sakit or 0) + (class_level.izin or 0) + (class_level.alfa or 0)),
                "has_data": True,
                "updated_at": class_level.updated_at.isoformat() if class_level.updated_at else None,
                "note": class_level.note or "",
                "entered_by": class_level.entered_by,
                "entry_mode": "class",
            })
        elif agg is None:
            results.append({
                "class_name": item["class_name"],
                "jenjang": item["jenjang"],
                "month": month,
                "year": year,
                "sakit": 0,
                "izin": 0,
                "alfa": 0,
                "total": 0,
                "has_data": False,
                "note": "",
                "entered_by": None,
                "entry_mode": "class",
            })
        else:
            results.append({
                "class_name": item["class_name"],
                "jenjang": item["jenjang"],
                "month": month,
                "year": year,
                "sakit": int(agg.sakit or 0),
                "izin": int(agg.izin or 0),
                "alfa": int(agg.alfa or 0),
                "total": int((agg.sakit or 0) + (agg.izin or 0) + (agg.alfa or 0)),
                "has_data": True,
                "updated_at": agg.latest_update.isoformat() if agg.latest_update else None,
                "note": "",
                "entered_by": None,
                "entry_mode": "student",
            })

    return results


def _normalize_class_entry(entry: AbsenceReasonClassEntryBody, available_classes: dict[str, dict]) -> tuple[dict | None, dict | None]:
    normalized_class_name = entry.class_name.strip()
    normalized_entered_by = entry.entered_by.strip()
    note = entry.note.strip() if isinstance(entry.note, str) else None
    errors = []

    if not normalized_class_name:
        errors.append("class_name must not be empty")
    if normalized_class_name and normalized_class_name not in available_classes:
        errors.append(f"class_name '{normalized_class_name}' not found in students data")
    if not normalized_entered_by:
        errors.append("entered_by must not be empty")
    if entry.sakit < 0 or entry.izin < 0 or entry.alfa < 0:
        errors.append("Counts must be >= 0")
    try:
        _validate_reporting_period(entry.month, entry.year)
    except HTTPException as exc:
        errors.append(exc.detail)

    if errors:
        return None, {
            "class_name": normalized_class_name or entry.class_name,
            "month": entry.month,
            "year": entry.year,
            "errors": errors,
        }

    return {
        "class_name": normalized_class_name,
        "month": entry.month,
        "year": entry.year,
        "sakit": entry.sakit,
        "izin": entry.izin,
        "alfa": entry.alfa,
        "note": note or None,
        "entered_by": normalized_entered_by,
        "jenjang": available_classes[normalized_class_name]["jenjang"],
    }, None


def _upsert_student_absence_reason_rows(
    db: Session,
    *,
    class_name: str,
    month: int,
    year: int,
    sakit: int,
    izin: int,
    alfa: int,
    note: str | None,
    entered_by: str,
) -> int:
    students = (
        db.query(Student)
        .filter(Student.class_name == class_name)
        .order_by(Student.id.asc())
        .all()
    )

    if not students:
        raise HTTPException(status_code=422, detail=[{
            "class_name": class_name,
            "month": month,
            "year": year,
            "errors": [f"No students found for class '{class_name}'"],
        }])

    existing_rows = (
        db.query(AbsenceReason)
        .filter(
            AbsenceReason.year == year,
            AbsenceReason.month == month,
            AbsenceReason.student_id.in_([student.id for student in students]),
        )
        .all()
    )
    existing_by_student_id = {row.student_id: row for row in existing_rows}

    for student in students:
        row = existing_by_student_id.get(student.id)
        if row is None:
            row = AbsenceReason(
                student_id=student.id,
                class_name=class_name,
                year=year,
                month=month,
                sakit=sakit,
                izin=izin,
                alfa=alfa,
                note=note,
                entered_by=entered_by,
            )
            db.add(row)
        else:
            row.class_name = class_name
            row.sakit = sakit
            row.izin = izin
            row.alfa = alfa
            row.note = note
            row.entered_by = entered_by
            row.updated_at = datetime.utcnow()

    return len(students)


@router.get("/jenjang")
def get_jenjang_configs(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows = db.query(JenjangConfig).order_by(JenjangConfig.jenjang.asc()).all()
    available_jenjangs = _get_available_jenjangs(db)
    configured = [
        {
            "jenjang": row.jenjang,
            "cutoff_time": row.cutoff_time,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
        if row.jenjang in available_jenjangs
    ]
    configured_names = {item["jenjang"] for item in configured}
    unconfigured = [jenjang for jenjang in available_jenjangs if jenjang not in configured_names]
    return {
        "configured": configured,
        "unconfigured": unconfigured,
    }


@router.get("/jenjang/available")
def get_available_jenjangs(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return {
        "jenjang_list": _get_available_jenjangs(db)
    }


@router.put("/jenjang/{jenjang}")
def upsert_jenjang_config(
    jenjang: str,
    body: JenjangCutoffBody,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    jenjang_key = jenjang.strip()
    if not jenjang_key:
        raise HTTPException(status_code=400, detail="jenjang must be a non-empty string")

    available_jenjangs = _get_available_jenjangs(db)
    if jenjang_key not in available_jenjangs:
        raise HTTPException(status_code=400, detail="jenjang must exist in students data")

    cutoff_time = _validate_cutoff_time(body.cutoff_time)

    row = db.query(JenjangConfig).filter(JenjangConfig.jenjang == jenjang_key).first()
    if row is None:
        row = JenjangConfig(jenjang=jenjang_key, cutoff_time=cutoff_time)
        db.add(row)
    else:
        row.cutoff_time = cutoff_time
        row.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)

    return {
        "jenjang": row.jenjang,
        "cutoff_time": row.cutoff_time,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.delete("/jenjang/{jenjang}")
def delete_jenjang_config(
    jenjang: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    jenjang_key = jenjang.strip()
    row = db.query(JenjangConfig).filter(JenjangConfig.jenjang == jenjang_key).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Jenjang config not found")

    db.delete(row)
    db.commit()
    return {"deleted": jenjang_key}


@router.get("/heb")
def get_heb_overrides(
    month: int | None = Query(None),
    year: int | None = Query(None),
    jenjang: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    query = db.query(HebOverride)

    if month is not None:
        if month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="month must be between 1 and 12")
        query = query.filter(HebOverride.month == month)

    if year is not None:
        if year < 2020:
            raise HTTPException(status_code=400, detail="year must be greater than or equal to 2020")
        query = query.filter(HebOverride.year == year)

    if jenjang is not None:
        jenjang_key = jenjang.strip()
        if not jenjang_key:
            raise HTTPException(status_code=400, detail="jenjang must be a non-empty string")
        query = query.filter(HebOverride.jenjang == jenjang_key)

    rows = (
        query.order_by(HebOverride.year.desc(), HebOverride.month.desc(), HebOverride.jenjang.asc())
        .all()
    )
    return [_serialize_heb_override(row) for row in rows]


@router.put("/heb/{jenjang}/{year}/{month}")
def upsert_heb_override(
    jenjang: str,
    year: int,
    month: int,
    body: HebOverrideBody,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    jenjang_key = jenjang.strip()
    if not jenjang_key:
        raise HTTPException(status_code=400, detail="jenjang must be a non-empty string")

    _validate_reporting_period(month, year)

    if body.heb_value < 1 or body.heb_value > 31:
        raise HTTPException(status_code=400, detail="heb_value must be an integer between 1 and 31")

    set_by = body.set_by.strip()
    if not set_by:
        raise HTTPException(status_code=400, detail="set_by must not be empty")

    note = body.note.strip() if isinstance(body.note, str) else None
    row = (
        db.query(HebOverride)
        .filter(
            HebOverride.jenjang == jenjang_key,
            HebOverride.year == year,
            HebOverride.month == month,
        )
        .first()
    )

    if row is None:
        row = HebOverride(
            jenjang=jenjang_key,
            year=year,
            month=month,
            heb_value=body.heb_value,
            note=note or None,
            set_by=set_by,
        )
        db.add(row)
    else:
        row.heb_value = body.heb_value
        row.note = note or None
        row.set_by = set_by
        row.set_at = datetime.utcnow()

    db.commit()
    db.refresh(row)
    return _serialize_heb_override(row)


@router.delete("/heb/{jenjang}/{year}/{month}")
def delete_heb_override(
    jenjang: str,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    jenjang_key = jenjang.strip()
    if not jenjang_key:
        raise HTTPException(status_code=400, detail="jenjang must be a non-empty string")

    _validate_reporting_period(month, year)

    row = (
        db.query(HebOverride)
        .filter(
            HebOverride.jenjang == jenjang_key,
            HebOverride.year == year,
            HebOverride.month == month,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="HEB override not found")

    db.delete(row)
    db.commit()
    return {
        "deleted": True,
        "jenjang": jenjang_key,
        "month": month,
        "year": year,
        "message": "HEB override removed. Will revert to auto-calculation.",
    }


@router.get("/absence-reasons")
def get_absence_reasons(
    month: int = Query(...),
    year: int = Query(...),
    class_name: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    return _build_absence_reason_rows(db, month, year, class_name)


@router.post("/absence-reasons/bulk")
def bulk_upsert_absence_reasons(
    body: BulkAbsenceReasonBody | BulkAbsenceReasonCatchupBody,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    if isinstance(body, BulkAbsenceReasonBody):
        _validate_reporting_period(body.month, body.year)

        entered_by = body.entered_by.strip()
        if not entered_by:
            raise HTTPException(status_code=400, detail="entered_by must not be empty")

        try:
            for update in body.updates:
                if update.sakit < 0 or update.izin < 0 or update.alfa < 0:
                    raise HTTPException(status_code=400, detail="Counts must be >= 0")

                student = db.query(Student).filter(Student.id == update.student_id).first()
                if not student:
                    raise HTTPException(status_code=404, detail=f"Student {update.student_id} not found")

                active_class_name = student.class_name
                enrollment = (
                    db.query(StudentEnrollment)
                    .join(AcademicYear)
                    .outerjoin(AcademicClass)
                    .filter(
                        StudentEnrollment.student_id == student.id,
                        AcademicYear.start_date <= datetime(body.year, body.month, 1).date(),
                        AcademicYear.end_date >= datetime(body.year, body.month, 1).date()
                    )
                    .first()
                )
                if not enrollment:
                    enrollment = (
                        db.query(StudentEnrollment)
                        .outerjoin(AcademicClass)
                        .filter(StudentEnrollment.student_id == student.id)
                        .order_by(StudentEnrollment.created_at.desc())
                        .first()
                    )
                if enrollment:
                    active_class_name = (
                        enrollment.academic_class.class_name
                        if enrollment.academic_class
                        else enrollment.class_name
                    ) or active_class_name

                if not active_class_name:
                    continue

                row = (
                    db.query(AbsenceReason)
                    .filter(
                        AbsenceReason.student_id == update.student_id,
                        AbsenceReason.year == body.year,
                        AbsenceReason.month == body.month,
                    )
                    .first()
                )

                note = update.note.strip() if isinstance(update.note, str) else None

                if row is None:
                    row = AbsenceReason(
                        student_id=update.student_id,
                        class_name=active_class_name,
                        year=body.year,
                        month=body.month,
                        sakit=update.sakit,
                        izin=update.izin,
                        alfa=update.alfa,
                        note=note or None,
                        entered_by=entered_by,
                    )
                    db.add(row)
                else:
                    row.class_name = active_class_name
                    row.sakit = update.sakit
                    row.izin = update.izin
                    row.alfa = update.alfa
                    row.note = note or None
                    row.entered_by = entered_by
                    row.updated_at = datetime.utcnow()

            db.commit()
            return {"message": f"Successfully updated {len(body.updates)} records", "total": len(body.updates)}
        except Exception as e:
            db.rollback()
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Database error during bulk save: {str(e)}")

    available_classes = {
        item["class_name"]: item
        for item in _get_available_classes(db)
    }
    normalized_entries = []
    errors = []

    for entry in body.entries:
        normalized, entry_error = _normalize_class_entry(entry, available_classes)
        if entry_error is not None:
            errors.append(entry_error)
        else:
            normalized_entries.append(normalized)

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    inserted = 0
    updated = 0
    propagated_students = 0

    try:
        for entry in normalized_entries:
            row = (
                db.query(AbsenceReasonClassEntry)
                .filter(
                    AbsenceReasonClassEntry.class_name == entry["class_name"],
                    AbsenceReasonClassEntry.month == entry["month"],
                    AbsenceReasonClassEntry.year == entry["year"],
                )
                .first()
            )

            if row is None:
                row = AbsenceReasonClassEntry(
                    class_name=entry["class_name"],
                    month=entry["month"],
                    year=entry["year"],
                    sakit=entry["sakit"],
                    izin=entry["izin"],
                    alfa=entry["alfa"],
                    note=entry["note"],
                    entered_by=entry["entered_by"],
                )
                db.add(row)
                inserted += 1
            else:
                row.sakit = entry["sakit"]
                row.izin = entry["izin"]
                row.alfa = entry["alfa"]
                row.note = entry["note"]
                row.entered_by = entry["entered_by"]
                row.updated_at = datetime.utcnow()
                updated += 1

            propagated_students += _upsert_student_absence_reason_rows(
                db,
                class_name=entry["class_name"],
                month=entry["month"],
                year=entry["year"],
                sakit=entry["sakit"],
                izin=entry["izin"],
                alfa=entry["alfa"],
                note=entry["note"],
                entered_by=entry["entered_by"],
            )

        db.commit()
        return {
            "inserted": inserted,
            "updated": updated,
            "total": len(normalized_entries),
            "propagated_students": propagated_students,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during catch-up save: {str(e)}")


@router.get("/absence-reasons/summary")
def get_absence_reasons_summary(
    month: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("admin")),
):
    rows = _build_absence_reason_rows(db, month, year)
    summary_by_jenjang: dict[str, dict] = {}

    for row in rows:
        jenjang = row["jenjang"]
        if jenjang not in summary_by_jenjang:
            summary_by_jenjang[jenjang] = {
                "jenjang": jenjang,
                "month": month,
                "year": year,
                "total_sakit": 0,
                "total_izin": 0,
                "total_alfa": 0,
                "classes_entered": 0,
                "classes_total": 0,
            }

        summary = summary_by_jenjang[jenjang]
        summary["total_sakit"] += row["sakit"]
        summary["total_izin"] += row["izin"]
        summary["total_alfa"] += row["alfa"]
        summary["classes_total"] += 1
        if row["has_data"]:
            summary["classes_entered"] += 1

    return [summary_by_jenjang[key] for key in sorted(summary_by_jenjang.keys())]
