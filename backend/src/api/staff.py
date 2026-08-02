"""Basic employee directory, canonical jenjang assignments, and education data."""

from __future__ import annotations

import csv
from io import StringIO
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, joinedload, selectinload

from core.database import get_db
from models.jenjang import Jenjang
from models.staff import (
    StaffContactDetail,
    StaffEducation,
    StaffIdentifier,
    StaffImportBatch,
    StaffImportIssue,
    StaffJenjangAssignment,
    StaffMember,
)
from models.user import User
from security.dependencies import get_current_user, require_capability
from services.staff_directory import EDUCATION_LEVELS, highest_education, service_duration, validate_employment_dates

router = APIRouter(dependencies=[Depends(get_current_user)])


class JenjangAssignmentsBody(BaseModel):
    jenjang_ids: list[int] = Field(default_factory=list, max_length=32)


class EmploymentDatesBody(BaseModel):
    employment_end_date: date | None = None

    @model_validator(mode="before")
    @classmethod
    def parse_end_date(cls, values):
        if isinstance(values, dict) and values.get("employment_end_date") == "":
            values = {**values, "employment_end_date": None}
        return values


class EducationBody(BaseModel):
    education_level: str = Field(min_length=2, max_length=8)
    institution_name: str = Field(min_length=1, max_length=255)
    major: str | None = Field(default=None, max_length=255)
    graduation_year: int | None = Field(default=None, ge=1900, le=2200)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_values(self):
        self.education_level = self.education_level.strip().upper()
        self.institution_name = self.institution_name.strip()
        if self.major is not None:
            self.major = self.major.strip() or None
        if self.notes is not None:
            self.notes = self.notes.strip() or None
        if self.education_level not in EDUCATION_LEVELS:
            raise ValueError("Unsupported education level")
        if not self.institution_name:
            raise ValueError("institution_name is required")
        return self


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    return "*" * max(0, len(value) - 4) + value[-4:]


def _available(db: Session) -> None:
    try:
        db.query(StaffMember.id).limit(1).all()
    except OperationalError as error:
        raise HTTPException(status_code=503, detail="Employee master extension is not installed") from error


def _identifiers(member: StaffMember) -> dict[str, str | None]:
    return {item.identifier_type: item.normalized_value for item in member.identifiers}


def _education_record(record: StaffEducation) -> dict[str, object]:
    return {
        "id": record.id,
        "education_level": record.education_level,
        "institution_name": record.institution_name,
        "major": record.major,
        "graduation_year": record.graduation_year,
        "notes": record.notes,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _derived(member: StaffMember) -> dict[str, object]:
    service = service_duration(member.employment_start_date, member.employment_status, member.employment_end_date)
    return {"age_years": _age(member.birth_date), **service, **highest_education(member.education_history)}


def _age(birth_date) -> int | None:
    from services.staff_directory import completed_years

    return completed_years(birth_date)


def _summary(member: StaffMember, *, include_detail: bool = False) -> dict[str, object]:
    identifiers = _identifiers(member)
    result: dict[str, object] = {
        "id": member.id,
        "source_staff_id": member.source_staff_id,
        "full_name": member.full_name,
        "employment_status": member.employment_status,
        "job_title": member.job_title_normalized or member.job_title_raw,
        "employment_start_date": member.employment_start_date,
        "employment_end_date": member.employment_end_date,
        "dapodik_status": member.dapodik_status_normalized,
        "nip": identifiers.get("NIP"),
        "nuptk": identifiers.get("NUPTK"),
        "jenjangs": [
            {
                "id": assignment.jenjang.id,
                "name": assignment.jenjang.name,
                "code": assignment.jenjang.code,
                "level": assignment.jenjang.level,
                "active": assignment.jenjang.active,
            }
            for assignment in sorted(member.jenjang_assignments, key=lambda item: (item.jenjang.code or "", item.jenjang.id))
        ],
        **_derived(member),
    }
    if include_detail:
        result.update({
            "birth_place": member.birth_place,
            "birth_date": member.birth_date,
            "identifiers": [{"type": item.identifier_type, "value": item.normalized_value, "verification_status": item.verification_status} for item in member.identifiers if item.normalized_value],
            "contact": {"email": member.contact.email, "phone": member.contact.phone, "address": member.contact.address} if member.contact else None,
            "education_history": [_education_record(record) for record in member.education_history],
        })
    return result


def _query_staff(
    db: Session,
    *,
    search: str | None = None,
    status_value: str | None = None,
    job_title: str | None = None,
    dapodik_status: str | None = None,
    jenjang_id: int | None = None,
):
    query = db.query(StaffMember).options(
        selectinload(StaffMember.identifiers),
        joinedload(StaffMember.contact),
        selectinload(StaffMember.jenjang_assignments).joinedload(StaffJenjangAssignment.jenjang),
        selectinload(StaffMember.education_history),
    )
    if search and search.strip():
        pattern = f"%{search.strip().casefold()}%"
        query = query.filter(or_(
            func.lower(StaffMember.full_name).like(pattern),
            func.lower(StaffMember.source_staff_id).like(pattern),
            StaffMember.identifiers.any(and_(
                StaffIdentifier.identifier_type.in_(["NIP", "NUPTK"]),
                func.lower(StaffIdentifier.normalized_value).like(pattern),
            )),
        ))
    if status_value and status_value != "ALL":
        query = query.filter(StaffMember.employment_status == status_value)
    if job_title and job_title.strip():
        pattern = f"%{job_title.strip().casefold()}%"
        query = query.filter(or_(
            func.lower(StaffMember.job_title_raw).like(pattern),
            func.lower(StaffMember.job_title_normalized).like(pattern),
        ))
    if dapodik_status and dapodik_status != "ALL":
        query = query.filter(StaffMember.dapodik_status_normalized == dapodik_status)
    if jenjang_id:
        query = query.filter(StaffMember.jenjang_assignments.any(StaffJenjangAssignment.jenjang_id == jenjang_id))
    return query


def _status_counts(db: Session, *, search=None, job_title=None, dapodik_status=None, jenjang_id=None) -> dict[str, int]:
    query = _query_staff(db, search=search, status_value="ALL", job_title=job_title, dapodik_status=dapodik_status, jenjang_id=jenjang_id)
    counts = dict(query.with_entities(StaffMember.employment_status, func.count(func.distinct(StaffMember.id))).group_by(StaffMember.employment_status).all())
    return {"ACTIVE": counts.get("ACTIVE", 0), "FORMER": counts.get("FORMER", 0), "ALL": sum(counts.values())}


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate or referenced staff data") from exc


def _member_or_404(db: Session, staff_id: str) -> StaffMember:
    member = _query_staff(db, status_value="ALL").filter(StaffMember.id == staff_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return member


@router.get("")
def list_staff(
    search: str | None = None,
    status: str = Query(default="ACTIVE", pattern="^(ACTIVE|FORMER|UNKNOWN|REVIEW_REQUIRED|ALL)$"),
    employment_status: str | None = Query(default=None, pattern="^(ACTIVE|FORMER|UNKNOWN|REVIEW_REQUIRED|ALL)$"),
    job_title: str | None = None,
    dapodik_status: str | None = Query(default=None, pattern="^(ACTIVE|NOT_REGISTERED|SUBMITTED_OR_COMPLETED|UNKNOWN|ALL)$"),
    jenjang_id: int | None = Query(default=None, gt=0),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("view_staff")),
):
    _available(db)
    selected_status = employment_status or status
    query = _query_staff(db, search=search, status_value=selected_status, job_title=job_title, dapodik_status=dapodik_status, jenjang_id=jenjang_id)
    total = query.with_entities(func.count(func.distinct(StaffMember.id))).scalar() or 0
    rows = query.order_by(StaffMember.full_name.asc(), StaffMember.id.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [_summary(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "counts": _status_counts(db, search=search, job_title=job_title, dapodik_status=dapodik_status, jenjang_id=jenjang_id),
    }


@router.get("/export")
def export_staff(
    search: str | None = None,
    status: str = Query(default="ACTIVE", pattern="^(ACTIVE|FORMER|UNKNOWN|REVIEW_REQUIRED|ALL)$"),
    job_title: str | None = None,
    dapodik_status: str | None = Query(default=None, pattern="^(ACTIVE|NOT_REGISTERED|SUBMITTED_OR_COMPLETED|UNKNOWN|ALL)$"),
    jenjang_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_capability("export_staff")),
):
    _available(db)
    rows = _query_staff(db, search=search, status_value=status, job_title=job_title, dapodik_status=dapodik_status, jenjang_id=jenjang_id).order_by(StaffMember.full_name.asc(), StaffMember.id.asc()).all()
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Staff ID", "Name", "Employment Status", "Jenjang", "Job Title", "NIP", "NUPTK", "Dapodik Status", "Birth Place", "Birth Date", "Age", "Employment Start Date", "Employment End Date", "Years of Service", "Service Months", "Highest Education", "Highest Education Institution", "NIK"])
    for member in rows:
        identifiers = _identifiers(member)
        derived = _derived(member)
        writer.writerow([
            member.source_staff_id or "", member.full_name, member.employment_status,
            "; ".join(item.jenjang.name for item in sorted(member.jenjang_assignments, key=lambda item: (item.jenjang.code or "", item.jenjang.id))),
            member.job_title_normalized or member.job_title_raw or "", identifiers.get("NIP") or "", identifiers.get("NUPTK") or "", member.dapodik_status_normalized,
            member.birth_place or "", member.birth_date or "", derived["age_years"] if derived["age_years"] is not None else "",
            member.employment_start_date or "", member.employment_end_date or "", derived["service_years"] if derived["service_years"] is not None else "", derived["service_months"] if derived["service_months"] is not None else "",
            derived["highest_education_level"] or "", derived["highest_education_institution"] or "", identifiers.get("NIK") or "",
        ])
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=staff-directory.csv"})


@router.get("/{staff_id}")
def staff_detail(staff_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff"))):
    _available(db)
    return _summary(_member_or_404(db, staff_id), include_detail=True)


@router.patch("/{staff_id}")
def update_staff_employment(staff_id: str, body: EmploymentDatesBody, db: Session = Depends(get_db), _user: User = Depends(require_capability("manage_staff"))):
    _available(db)
    member = _member_or_404(db, staff_id)
    end_date = body.employment_end_date
    try:
        validate_employment_dates(member.employment_start_date, end_date)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    member.employment_end_date = end_date
    _commit(db)
    return _summary(_member_or_404(db, staff_id), include_detail=True)


@router.put("/{staff_id}/jenjangs")
def replace_staff_jenjangs(staff_id: str, body: JenjangAssignmentsBody, db: Session = Depends(get_db), _user: User = Depends(require_capability("manage_staff"))):
    _available(db)
    member = _member_or_404(db, staff_id)
    if len(body.jenjang_ids) != len(set(body.jenjang_ids)):
        raise HTTPException(status_code=422, detail="Duplicate jenjang assignment")
    canonical = {row.id: row for row in db.query(Jenjang).filter(Jenjang.id.in_(body.jenjang_ids)).all()} if body.jenjang_ids else {}
    if len(canonical) != len(body.jenjang_ids):
        raise HTTPException(status_code=422, detail="Unknown jenjang")
    existing = {assignment.jenjang_id for assignment in member.jenjang_assignments}
    if any(not canonical[item].active and item not in existing for item in body.jenjang_ids):
        raise HTTPException(status_code=422, detail="Only active jenjang may be newly assigned")
    member.jenjang_assignments = [
        StaffJenjangAssignment(staff_member_id=member.id, jenjang_id=jenjang_id)
        for jenjang_id in body.jenjang_ids
    ]
    _commit(db)
    return _summary(_member_or_404(db, staff_id), include_detail=True)


@router.get("/{staff_id}/education")
def list_staff_education(staff_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff"))):
    _available(db)
    member = _member_or_404(db, staff_id)
    return {"items": [_education_record(record) for record in member.education_history], **highest_education(member.education_history)}


@router.post("/{staff_id}/education", status_code=status.HTTP_201_CREATED)
def create_staff_education(staff_id: str, body: EducationBody, db: Session = Depends(get_db), _user: User = Depends(require_capability("manage_staff"))):
    _available(db)
    member = _member_or_404(db, staff_id)
    record = StaffEducation(staff_member_id=member.id, **body.model_dump())
    db.add(record)
    _commit(db)
    db.refresh(record)
    return _education_record(record)


@router.patch("/{staff_id}/education/{education_id}")
def update_staff_education(staff_id: str, education_id: int, body: EducationBody, db: Session = Depends(get_db), _user: User = Depends(require_capability("manage_staff"))):
    _available(db)
    _member_or_404(db, staff_id)
    record = db.query(StaffEducation).filter_by(id=education_id, staff_member_id=staff_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Education record not found")
    for key, value in body.model_dump().items():
        setattr(record, key, value)
    _commit(db)
    db.refresh(record)
    return _education_record(record)


@router.delete("/{staff_id}/education/{education_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_staff_education(staff_id: str, education_id: int, db: Session = Depends(get_db), _user: User = Depends(require_capability("manage_staff"))):
    _available(db)
    _member_or_404(db, staff_id)
    record = db.query(StaffEducation).filter_by(id=education_id, staff_member_id=staff_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Education record not found")
    db.delete(record)
    _commit(db)


@router.get("/{staff_id}/sensitive")
def staff_sensitive_detail(staff_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_sensitive"))):
    _available(db)
    member = _member_or_404(db, staff_id)
    return _summary(member, include_detail=True) | {
        "identifiers": [{"type": item.identifier_type, "value_masked": _mask(item.normalized_value), "verification_status": item.verification_status} for item in member.identifiers],
        "contact": {"email": member.contact.email, "phone": _mask(member.contact.phone), "address": member.contact.address} if member.contact else None,
    }


@router.get("/imports/history")
def staff_import_history(db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_audit"))):
    _available(db)
    rows = db.query(StaffImportBatch).order_by(StaffImportBatch.imported_at.desc()).limit(100).all()
    return {"items": [{"id": row.id, "source_filename": row.source_filename, "source_sheet": row.source_sheet, "file_sha256": row.file_sha256, "imported_at": row.imported_at, "actor": row.actor, "total_rows": row.total_rows, "active_count": row.active_count, "former_count": row.former_count, "review_count": row.review_count, "issue_count": row.issue_count, "status": row.status} for row in rows]}


@router.get("/imports/{batch_id}")
def staff_import_detail(batch_id: str, db: Session = Depends(get_db), _user: User = Depends(require_capability("view_staff_audit"))):
    _available(db)
    batch = db.get(StaffImportBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Staff import batch not found")
    issue_counts = dict(db.query(StaffImportIssue.issue_code, func.count(StaffImportIssue.id)).filter_by(batch_id=batch_id).group_by(StaffImportIssue.issue_code).all())
    return {"id": batch.id, "source_filename": batch.source_filename, "source_sheet": batch.source_sheet, "file_sha256": batch.file_sha256, "imported_at": batch.imported_at, "status": batch.status, "total_rows": batch.total_rows, "active_count": batch.active_count, "former_count": batch.former_count, "review_count": batch.review_count, "issue_count": batch.issue_count, "issue_counts": issue_counts}
