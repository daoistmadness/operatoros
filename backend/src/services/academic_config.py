from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.academic_config import AcademicTermConfig, KkmThreshold
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.subject import Subject

LEGACY_KKM_THRESHOLD = 85.0
LEGACY_NATIONAL_THRESHOLD = 75.0
ASSESSMENT_TYPES = {"sumatif", "formatif", "overall"}


@dataclass(frozen=True)
class EffectiveKkm:
    threshold: float
    source: str
    threshold_id: int | None = None


def _default_term_dates(academic_year: AcademicYear, term_number: int) -> tuple[date, date]:
    if term_number == 1:
        term_start = date(academic_year.start_date.year, 7, 1)
        term_end = date(academic_year.start_date.year, 9, 30)
    elif term_number == 2:
        term_start = date(academic_year.start_date.year, 10, 1)
        term_end = date(academic_year.start_date.year, 12, 31)
    elif term_number == 3:
        term_start = date(academic_year.end_date.year, 1, 1)
        term_end = date(academic_year.end_date.year, 3, 31)
    elif term_number == 4:
        term_start = date(academic_year.end_date.year, 4, 1)
        term_end = date(academic_year.end_date.year, 6, 30)
    else:
        raise HTTPException(status_code=400, detail="term_number must be between 1 and 4")

    return max(academic_year.start_date, term_start), min(academic_year.end_date, term_end)


def parse_term_value(term: str | None) -> int | None:
    if not term:
        return None
    try:
        term_number = int(term.split("_")[1])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Term format '{term}' is invalid") from exc
    if term_number < 1 or term_number > 4:
        raise HTTPException(status_code=400, detail="term_number must be between 1 and 4")
    return term_number


def get_academic_year_or_404(db: Session, academic_year_id: int) -> AcademicYear:
    academic_year = db.query(AcademicYear).filter(AcademicYear.id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found")
    return academic_year


def validate_kkm_references(
    db: Session,
    academic_year_id: int,
    jenjang_id: int | None,
    subject_id: int | None,
) -> None:
    get_academic_year_or_404(db, academic_year_id)
    if jenjang_id is not None and db.query(Jenjang.id).filter(Jenjang.id == jenjang_id).first() is None:
        raise HTTPException(status_code=404, detail="Jenjang not found")
    if subject_id is not None:
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        if subject is None:
            raise HTTPException(status_code=404, detail="Subject not found")
        if jenjang_id is not None and subject.jenjang_id != jenjang_id:
            raise HTTPException(status_code=400, detail="Subject does not belong to selected jenjang")


def find_duplicate_kkm(
    db: Session,
    academic_year_id: int,
    jenjang_id: int | None,
    subject_id: int | None,
    assessment_type: str,
    exclude_id: int | None = None,
) -> KkmThreshold | None:
    query = db.query(KkmThreshold).filter(
        KkmThreshold.academic_year_id == academic_year_id,
        KkmThreshold.assessment_type == assessment_type,
    )
    query = query.filter(KkmThreshold.jenjang_id.is_(None) if jenjang_id is None else KkmThreshold.jenjang_id == jenjang_id)
    query = query.filter(KkmThreshold.subject_id.is_(None) if subject_id is None else KkmThreshold.subject_id == subject_id)
    if exclude_id is not None:
        query = query.filter(KkmThreshold.id != exclude_id)
    return query.first()


def resolve_effective_kkm(
    db: Session,
    academic_year_id: int,
    jenjang_id: int | None,
    subject_id: int | None,
    assessment_type: str,
) -> EffectiveKkm:
    if assessment_type not in ASSESSMENT_TYPES:
        raise HTTPException(status_code=400, detail="assessment_type must be sumatif, formatif, or overall")

    candidates = [
        (jenjang_id, subject_id, assessment_type, "subject-specific"),
        (jenjang_id, subject_id, "overall", "subject-overall"),
        (jenjang_id, None, assessment_type, "jenjang-level"),
        (jenjang_id, None, "overall", "jenjang-overall"),
        (None, None, assessment_type, "academic-year-level"),
        (None, None, "overall", "academic-year-overall"),
    ]

    seen: set[tuple[int | None, int | None, str]] = set()
    for cand_jenjang_id, cand_subject_id, cand_type, source in candidates:
        key = (cand_jenjang_id, cand_subject_id, cand_type)
        if key in seen:
            continue
        seen.add(key)
        query = db.query(KkmThreshold).filter(
            KkmThreshold.academic_year_id == academic_year_id,
            KkmThreshold.assessment_type == cand_type,
        )
        query = query.filter(
            KkmThreshold.jenjang_id.is_(None)
            if cand_jenjang_id is None
            else KkmThreshold.jenjang_id == cand_jenjang_id
        )
        query = query.filter(
            KkmThreshold.subject_id.is_(None)
            if cand_subject_id is None
            else KkmThreshold.subject_id == cand_subject_id
        )
        match = query.first()
        if match is not None:
            return EffectiveKkm(threshold=float(match.threshold), source=source, threshold_id=match.id)

    # Phase 12 preserves the Phase 11 Edelweiss threshold when no configured
    # context applies. The national 75.0 value remains exposed as metadata.
    return EffectiveKkm(threshold=LEGACY_KKM_THRESHOLD, source="legacy-fallback", threshold_id=None)


def effective_term_rows(db: Session, academic_year_id: int) -> list[dict]:
    academic_year = get_academic_year_or_404(db, academic_year_id)
    custom_rows = {
        row.term_number: row
        for row in db.query(AcademicTermConfig)
        .filter(AcademicTermConfig.academic_year_id == academic_year_id)
        .order_by(AcademicTermConfig.term_number.asc())
        .all()
    }

    rows = []
    for term_number in range(1, 5):
        custom = custom_rows.get(term_number)
        if custom is not None:
            label = custom.label
            start_date = custom.start_date
            end_date = custom.end_date
            source = "custom"
            row_id = custom.id
        else:
            start_date, end_date = _default_term_dates(academic_year, term_number)
            label = f"Term {term_number}"
            source = "default"
            row_id = None

        rows.append(
            {
                "id": row_id,
                "academic_year_id": academic_year_id,
                "term_number": term_number,
                "value": f"term_{term_number}",
                "label": label,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "source": source,
            }
        )
    return rows


def resolve_effective_term_range(
    db: Session,
    academic_year: AcademicYear,
    term: str | None,
) -> tuple[date, date, dict | None, list[str]]:
    if not term:
        return (
            academic_year.start_date,
            academic_year.end_date,
            None,
            ["No Term filter selected. This report aggregates the full academic year."],
        )

    term_number = parse_term_value(term)
    assert term_number is not None
    term_rows = effective_term_rows(db, academic_year.id)
    term_row = next(row for row in term_rows if row["term_number"] == term_number)
    warnings = []
    if term_row["source"] == "default":
        warnings.append("Default term date mapping is used because no custom term configuration exists.")

    return (
        date.fromisoformat(term_row["start_date"]),
        date.fromisoformat(term_row["end_date"]),
        term_row,
        warnings,
    )


def validate_term_payload(
    db: Session,
    academic_year_id: int,
    term_number: int,
    start_date: date,
    end_date: date,
    exclude_id: int | None = None,
) -> None:
    academic_year = get_academic_year_or_404(db, academic_year_id)
    if term_number < 1 or term_number > 4:
        raise HTTPException(status_code=400, detail="term_number must be between 1 and 4")
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")
    if start_date < academic_year.start_date or end_date > academic_year.end_date:
        raise HTTPException(status_code=400, detail="Term date range must stay within the academic year")

    existing_rows = {
        row.term_number: row
        for row in db.query(AcademicTermConfig)
        .filter(AcademicTermConfig.academic_year_id == academic_year_id)
        .all()
        if exclude_id is None or row.id != exclude_id
    }
    for other_term_number in range(1, 5):
        if other_term_number == term_number:
            continue
        other = existing_rows.get(other_term_number)
        if other is not None:
            other_start = other.start_date
            other_end = other.end_date
        else:
            other_start, other_end = _default_term_dates(academic_year, other_term_number)
        if start_date <= other_end and end_date >= other_start:
            raise HTTPException(status_code=400, detail="Term date range overlaps another term in this academic year")


def serialize_kkm_threshold(row: KkmThreshold) -> dict:
    return {
        "id": row.id,
        "academic_year_id": row.academic_year_id,
        "academic_year_label": row.academic_year.label if row.academic_year else None,
        "jenjang_id": row.jenjang_id,
        "jenjang_name": row.jenjang.name if row.jenjang else None,
        "subject_id": row.subject_id,
        "subject_name": row.subject.name if row.subject else None,
        "assessment_type": row.assessment_type,
        "threshold": float(row.threshold),
    }


def serialize_term_config(row: AcademicTermConfig) -> dict:
    return {
        "id": row.id,
        "academic_year_id": row.academic_year_id,
        "term_number": row.term_number,
        "value": f"term_{row.term_number}",
        "label": row.label,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "source": "custom",
    }
