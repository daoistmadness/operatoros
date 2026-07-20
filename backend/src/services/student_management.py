import hashlib
import json
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.academic_master import AcademicClass, AcademicGrade, AcademicProgram
from models.academic_year import AcademicYear
from models.jenjang import Jenjang
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import (
    StudentAddress,
    StudentContact,
    StudentDeviceIdentity,
    StudentEnrollmentClassHistory,
    StudentMaster,
    StudentMasterChangeHistory,
    StudentParentGuardian,
)
from services.student_normalization import mask_identifier, normalize_name


DEVICE_REPLACE_CONFIRMATION = "REPLACE_ATTENDANCE_DEVICE_ID"
DEVICE_RETIRE_CONFIRMATION = "RETIRE_ATTENDANCE_DEVICE_ID"
DEVICE_REASSIGN_CONFIRMATION = "REASSIGN_ATTENDANCE_DEVICE_ID"
ENROLLMENT_TRANSFER_CONFIRMATION = "TRANSFER_STUDENT_ENROLLMENT"
ENROLLMENT_END_CONFIRMATION = "END_STUDENT_ENROLLMENT"


IDENTITY_FIELDS = (
    "full_name", "preferred_name", "nipd", "nisn", "nik", "birth_place", "birth_date",
    "gender", "religion", "citizenship", "blood_type", "student_status", "admission_date",
    "admission_type", "previous_school",
)
CONTACT_FIELDS = (
    "address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code",
    "student_phone", "student_email", "emergency_contact_name",
    "emergency_contact_relationship", "emergency_contact_phone",
)


def record_version(student: StudentMaster) -> str:
    payload = "|".join(
        [student.id, student.updated_at.isoformat() if student.updated_at else ""]
        + [str(getattr(student, field) or "") for field in IDENTITY_FIELDS]
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _audit(
    db: Session, student_id: str, action: str, actor: str, source: str,
    field: str | None = None, old=None, new=None, import_batch_id: str | None = None,
):
    sensitive_fields = {
        "nipd", "nisn", "nik", "device_identifier", "address", "student_phone",
        "student_email", "emergency_contact_phone", "phone", "email",
    }
    if field in sensitive_fields:
        old = mask_identifier(None if old is None else str(old))
        new = mask_identifier(None if new is None else str(new))
    db.add(StudentMasterChangeHistory(
        student_master_id=student_id, action=action, field_name=field,
        old_value=None if old is None else str(old), new_value=None if new is None else str(new),
        source=source, import_batch_id=import_batch_id, changed_by=actor,
    ))


def _check_identifier_conflicts(db: Session, values: dict, exclude_id: str | None = None):
    for field in ("nipd", "nisn", "nik"):
        value = values.get(field)
        if not value:
            continue
        query = db.query(StudentMaster).filter(getattr(StudentMaster, field) == value)
        if exclude_id:
            query = query.filter(StudentMaster.id != exclude_id)
        conflict = query.first()
        if conflict:
            raise HTTPException(status_code=409, detail={
                "code": f"DUPLICATE_{field.upper()}",
                "message": f"{field.upper()} is already assigned to another student.",
                "student_master_id": conflict.id,
            })


def duplicate_candidates(db: Session, identity: dict) -> list[dict]:
    normalized = normalize_name(identity["full_name"])
    query = db.query(StudentMaster).filter(StudentMaster.normalized_name == normalized)
    if identity.get("birth_date"):
        query = query.filter(StudentMaster.birth_date == identity["birth_date"])
    return [
        {"student_master_id": row.id, "full_name": row.full_name,
         "reason": "Same normalized name and birth date" if identity.get("birth_date") else "Same normalized name"}
        for row in query.order_by(StudentMaster.id).limit(10).all()
    ]


def _resolve_class(db: Session, academic_year_id: int, class_id: int):
    row = (
        db.query(AcademicClass, AcademicGrade, AcademicProgram, Jenjang, AcademicYear)
        .join(AcademicGrade, AcademicGrade.id == AcademicClass.grade_id)
        .join(AcademicProgram, AcademicProgram.id == AcademicGrade.program_id)
        .join(Jenjang, Jenjang.id == AcademicGrade.jenjang_id)
        .join(AcademicYear, AcademicYear.id == AcademicClass.academic_year_id)
        .filter(AcademicClass.id == class_id, AcademicClass.academic_year_id == academic_year_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Academic class does not belong to the selected academic year")
    academic_class, grade, program, jenjang, year = row
    if not academic_class.active or not grade.active or not program.active or not jenjang.active:
        raise HTTPException(status_code=400, detail="Academic class hierarchy is not active")
    return academic_class, grade, program, jenjang, year


def _create_legacy_identity(db: Session, student: StudentMaster, device: dict) -> StudentDeviceIdentity:
    active = db.query(StudentDeviceIdentity).filter(
        StudentDeviceIdentity.device_source == device["device_source"],
        StudentDeviceIdentity.device_identifier == device["device_identifier"],
        StudentDeviceIdentity.is_active.is_(True),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail={
            "code": "DEVICE_ID_IN_USE", "message": "Attendance Device ID is already active.",
            "student_master_id": active.student_master_id,
        })
    legacy_id = int(device["device_identifier"])
    legacy = db.get(Student, legacy_id)
    if legacy is not None:
        linked = db.query(StudentDeviceIdentity).filter(
            StudentDeviceIdentity.legacy_student_id == legacy_id,
            StudentDeviceIdentity.is_active.is_(True),
        ).first()
        if linked and linked.student_master_id != student.id:
            raise HTTPException(status_code=409, detail={"code": "DEVICE_ID_IN_USE", "student_master_id": linked.student_master_id})
        if normalize_name(legacy.name) != normalize_name(student.full_name):
            raise HTTPException(status_code=409, detail={
                "code": "LEGACY_IDENTITY_CONFLICT",
                "message": "The attendance ID exists with a different student name.",
            })
    else:
        existing_name = db.query(Student).filter(func.lower(Student.name) == student.full_name.casefold()).first()
        # The legacy attendance table requires unique names even though one canonical
        # student may legitimately retain multiple historical machine identities.
        legacy_name = f"{student.full_name} [Device {device['device_identifier']}]" if existing_name else student.full_name
        legacy = Student(id=legacy_id, name=legacy_name)
        db.add(legacy)
        db.flush()
    mapping = StudentDeviceIdentity(
        student_master_id=student.id, legacy_student_id=legacy.id,
        device_identifier=device["device_identifier"], device_source=device["device_source"],
        effective_from=device["effective_from"], is_active=True, created_by=device["actor"],
    )
    db.add(mapping)
    return mapping


def _create_enrollment(db: Session, student: StudentMaster, enrollment: dict, actor: str, source: str):
    existing = db.query(StudentEnrollment).filter(
        StudentEnrollment.student_master_id == student.id,
        StudentEnrollment.academic_year_id == enrollment["academic_year_id"],
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Student already has an enrollment for this academic year")
    academic_class, _grade, _program, jenjang, year = _resolve_class(
        db, enrollment["academic_year_id"], enrollment["academic_class_id"]
    )
    if enrollment["effective_from"] < year.start_date or enrollment["effective_from"] > year.end_date:
        raise HTTPException(status_code=400, detail="Enrollment effective date is outside the academic year")
    mapping = db.query(StudentDeviceIdentity).filter(
        StudentDeviceIdentity.student_master_id == student.id,
        StudentDeviceIdentity.is_active.is_(True),
        StudentDeviceIdentity.legacy_student_id.isnot(None),
    ).order_by(StudentDeviceIdentity.id.desc()).first()
    if mapping is None:
        raise HTTPException(status_code=400, detail="An active attendance identity is required before enrollment")
    row = StudentEnrollment(
        student_id=mapping.legacy_student_id, student_master_id=student.id,
        academic_year_id=year.id, jenjang_id=jenjang.id, academic_class_id=academic_class.id,
        class_name=academic_class.class_name, class_assigned=True,
        effective_from=enrollment["effective_from"],
    )
    db.add(row); db.flush()
    db.add(StudentEnrollmentClassHistory(
        enrollment_id=row.id, class_name=row.class_name, effective_from=row.effective_from,
        changed_by=actor, source=source,
    ))
    _audit(db, student.id, "enrollment_created", actor, source, "academic_class_id", None, academic_class.id)
    return row


def create_student(db: Session, body, actor: str) -> StudentMaster:
    identity = body.identity.model_dump()
    _check_identifier_conflicts(db, identity)
    candidates = duplicate_candidates(db, identity)
    if candidates and not body.duplicate_override_reason:
        raise HTTPException(status_code=409, detail={
            "code": "POTENTIAL_DUPLICATE", "message": "Potential duplicate student found.", "candidates": candidates,
        })
    student = StudentMaster(
        **identity, normalized_name=normalize_name(identity["full_name"]),
        created_by=actor, updated_by=actor,
    )
    db.add(student)
    try:
        db.flush()
        if body.contact:
            contact = body.contact.model_dump()
            address_values = {key: contact.get(key) for key in ("address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code")}
            contact_values = {key: contact.get(key) for key in CONTACT_FIELDS if key not in address_values}
            if any(value is not None for value in address_values.values()):
                db.add(StudentAddress(student_master_id=student.id, **address_values))
            if any(value is not None for value in contact_values.values()):
                db.add(StudentContact(student_master_id=student.id, **contact_values))
        for guardian in body.guardians:
            db.add(StudentParentGuardian(student_master_id=student.id, **guardian.model_dump()))
        if body.device_identity:
            device = body.device_identity.model_dump(); device["actor"] = actor
            _create_legacy_identity(db, student, device)
            _audit(db, student.id, "device_identity_added", actor, "manual_create", "device_identifier", None, device["device_identifier"])
        if body.enrollment:
            _create_enrollment(db, student, body.enrollment.model_dump(), actor, "manual_create")
        _audit(db, student.id, "student_created", actor, "manual_create", None, None, body.duplicate_override_reason)
        db.commit(); db.refresh(student); return student
    except HTTPException:
        db.rollback(); raise
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Student identity conflicts with an existing record") from exc


def update_student(db: Session, student: StudentMaster, body, actor: str):
    if record_version(student) != body.record_version:
        raise HTTPException(status_code=409, detail={"code": "STALE_RECORD", "message": "Student changed after this form was loaded."})
    values = body.identity.model_dump()
    if any(values[field] != getattr(student, field) for field in ("nik", "nisn")):
        if body.sensitive_confirmation != "CHANGE_SENSITIVE_STUDENT_IDENTIFIERS":
            raise HTTPException(status_code=400, detail="Sensitive identifier changes require explicit confirmation")
    _check_identifier_conflicts(db, values, student.id)
    try:
        for field in IDENTITY_FIELDS:
            old, new = getattr(student, field), values[field]
            if old != new:
                _audit(db, student.id, "profile_updated", actor, "manual_edit", field, old, new)
                setattr(student, field, new)
        student.normalized_name = normalize_name(student.full_name)
        student.updated_by = actor
        student.updated_at = datetime.now()
        if body.contact is not None:
            values = body.contact.model_dump()
            address = db.query(StudentAddress).filter_by(student_master_id=student.id).first()
            contact = db.query(StudentContact).filter_by(student_master_id=student.id).first()
            if address is None:
                address = StudentAddress(student_master_id=student.id); db.add(address)
            if contact is None:
                contact = StudentContact(student_master_id=student.id); db.add(contact)
            for field in ("address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code"):
                if getattr(address, field) != values[field]:
                    _audit(db, student.id, "profile_updated", actor, "manual_edit", field, getattr(address, field), values[field]); setattr(address, field, values[field])
            for field in CONTACT_FIELDS:
                if field in values and hasattr(contact, field) and getattr(contact, field) != values[field]:
                    _audit(db, student.id, "profile_updated", actor, "manual_edit", field, getattr(contact, field), values[field]); setattr(contact, field, values[field])
        if body.guardians is not None:
            db.query(StudentParentGuardian).filter_by(student_master_id=student.id).delete()
            for guardian in body.guardians:
                db.add(StudentParentGuardian(student_master_id=student.id, **guardian.model_dump()))
            _audit(db, student.id, "guardians_updated", actor, "manual_edit", "guardians", "previous", f"{len(body.guardians)} guardian(s)")
        db.commit(); db.refresh(student); return student
    except HTTPException:
        db.rollback(); raise
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Student update conflicts with an existing identifier") from exc


def add_or_replace_device(db: Session, student: StudentMaster, body, actor: str):
    if body.confirmation != DEVICE_REPLACE_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    device = body.model_dump(exclude={"confirmation"}); device["actor"] = actor
    old = db.query(StudentDeviceIdentity).filter(
        StudentDeviceIdentity.student_master_id == student.id,
        StudentDeviceIdentity.device_source == device["device_source"],
        StudentDeviceIdentity.is_active.is_(True),
    ).order_by(StudentDeviceIdentity.id.desc()).first()
    if old and old.device_identifier == device["device_identifier"]:
        return old
    try:
        if old:
            old.is_active = False
            old.effective_to = device["effective_from"]
        mapping = _create_legacy_identity(db, student, device)
        student.updated_at = datetime.now(); student.updated_by = actor
        _audit(db, student.id, "device_identity_replaced" if old else "device_identity_added", actor, "manual_device", "device_identifier", old.device_identifier if old else None, mapping.device_identifier)
        db.commit(); db.refresh(mapping); return mapping
    except HTTPException:
        db.rollback(); raise
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Attendance Device ID conflicts with an active mapping") from exc


def create_enrollment_for_student(db: Session, student: StudentMaster, body, actor: str):
    try:
        row = _create_enrollment(db, student, body.model_dump(), actor, "manual_enrollment")
        student.updated_at = datetime.now(); student.updated_by = actor
        db.commit(); db.refresh(row); return row
    except HTTPException:
        db.rollback(); raise
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Enrollment conflicts with current academic-year data") from exc


def retire_device(db: Session, student: StudentMaster, mapping: StudentDeviceIdentity, body, actor: str):
    if body.confirmation != DEVICE_RETIRE_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    if mapping.student_master_id != student.id or not mapping.is_active:
        raise HTTPException(status_code=404, detail="Active device identity not found")
    if body.effective_to < mapping.effective_from:
        raise HTTPException(status_code=400, detail="Retirement date predates the mapping")
    mapping.is_active = False; mapping.effective_to = body.effective_to
    student.updated_at = datetime.now(); student.updated_by = actor
    _audit(db, student.id, "device_identity_retired", actor, "manual_device", "device_identifier", mapping.device_identifier, body.reason)
    db.commit()


def reassign_device(db: Session, student: StudentMaster, body, actor: str):
    if body.confirmation != DEVICE_REASSIGN_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    previous = db.get(StudentMaster, body.previous_student_master_id)
    if previous is None or previous.id == student.id:
        raise HTTPException(status_code=400, detail="Previous student identity is not valid for reassignment")
    mapping = db.query(StudentDeviceIdentity).filter(
        StudentDeviceIdentity.student_master_id == previous.id,
        StudentDeviceIdentity.device_source == body.device_source,
        StudentDeviceIdentity.device_identifier == body.device_identifier,
        StudentDeviceIdentity.is_active.is_(True),
    ).first()
    if mapping is None:
        raise HTTPException(status_code=409, detail="The active Device ID link changed before reassignment")
    if body.effective_from < mapping.effective_from:
        raise HTTPException(status_code=400, detail="Reassignment date predates the active mapping")
    try:
        mapping.is_active = False; mapping.effective_to = body.effective_from
        replacement = StudentDeviceIdentity(
            student_master_id=student.id, legacy_student_id=mapping.legacy_student_id,
            device_identifier=mapping.device_identifier, device_source=mapping.device_source,
            effective_from=body.effective_from, is_active=True, created_by=actor,
        )
        db.add(replacement)
        previous.updated_at = datetime.now(); previous.updated_by = actor
        student.updated_at = datetime.now(); student.updated_by = actor
        _audit(db, previous.id, "device_identity_reassigned_out", actor, "manual_device_reassignment", "device_identifier", mapping.device_identifier, f"Reassigned to {student.id}: {body.reason}")
        _audit(db, student.id, "device_identity_reassigned_in", actor, "manual_device_reassignment", "device_identifier", None, f"{mapping.device_identifier}: {body.reason}")
        db.commit(); db.refresh(replacement); return replacement
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Attendance Device ID reassignment conflicts with current data") from exc


def transfer_enrollment(db: Session, enrollment: StudentEnrollment, body, actor: str):
    if body.confirmation != ENROLLMENT_TRANSFER_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    target, _grade, _program, jenjang, year = _resolve_class(db, enrollment.academic_year_id, body.target_class_id)
    if body.effective_date < (enrollment.effective_from or year.start_date) or body.effective_date > year.end_date:
        raise HTTPException(status_code=400, detail="Transfer date is outside the enrollment period")
    if target.id == enrollment.academic_class_id:
        raise HTTPException(status_code=409, detail="Student is already assigned to the target class")
    old_class = enrollment.class_name
    enrollment.academic_class_id = target.id; enrollment.jenjang_id = jenjang.id
    enrollment.class_name = target.class_name; enrollment.class_assigned = True
    db.add(StudentEnrollmentClassHistory(
        enrollment_id=enrollment.id, class_name=target.class_name,
        effective_from=body.effective_date, changed_by=actor, source="manual_transfer",
    ))
    _audit(db, enrollment.student_master_id, "enrollment_transferred", actor, "manual_transfer", "class_name", old_class, f"{target.class_name}: {body.reason}")
    student = db.get(StudentMaster, enrollment.student_master_id)
    student.updated_at = datetime.now(); student.updated_by = actor
    db.commit(); db.refresh(enrollment); return enrollment


def end_enrollment(db: Session, enrollment: StudentEnrollment, body, actor: str):
    if body.confirmation != ENROLLMENT_END_CONFIRMATION:
        raise HTTPException(status_code=400, detail="Invalid confirmation token")
    if enrollment.effective_from and body.effective_date < enrollment.effective_from:
        raise HTTPException(status_code=400, detail="End date predates enrollment")
    enrollment.effective_to = body.effective_date; enrollment.class_assigned = False
    _audit(db, enrollment.student_master_id, "enrollment_ended", actor, "manual_enrollment", "effective_to", None, f"{body.effective_date}: {body.reason}")
    student = db.get(StudentMaster, enrollment.student_master_id)
    student.updated_at = datetime.now(); student.updated_by = actor
    db.commit(); db.refresh(enrollment); return enrollment


def serialize_student_detail(db: Session, student: StudentMaster, *, include_sensitive: bool = True) -> dict:
    address = db.query(StudentAddress).filter_by(student_master_id=student.id).first()
    contact = db.query(StudentContact).filter_by(student_master_id=student.id).first()
    guardians = db.query(StudentParentGuardian).filter_by(student_master_id=student.id).order_by(StudentParentGuardian.id).all()
    devices = db.query(StudentDeviceIdentity).filter_by(student_master_id=student.id).order_by(StudentDeviceIdentity.effective_from.desc(), StudentDeviceIdentity.id.desc()).all()
    enrollments = (
        db.query(StudentEnrollment, AcademicYear, AcademicClass, AcademicGrade, AcademicProgram, Jenjang)
        .join(AcademicYear, AcademicYear.id == StudentEnrollment.academic_year_id)
        .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
        .outerjoin(AcademicGrade, AcademicGrade.id == AcademicClass.grade_id)
        .outerjoin(AcademicProgram, AcademicProgram.id == AcademicGrade.program_id)
        .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
        .filter(StudentEnrollment.student_master_id == student.id)
        .order_by(AcademicYear.start_date.desc()).all()
    )
    identity = {field: getattr(student, field) for field in IDENTITY_FIELDS}
    contact_values = {**({field: getattr(address, field) for field in ("address", "kelurahan", "kecamatan", "city_regency", "province", "postal_code")} if address else {}), **({field: getattr(contact, field) for field in CONTACT_FIELDS if hasattr(contact, field)} if contact else {})}
    guardian_values = [{field: getattr(row, field) for field in ("guardian_type", "name", "phone", "email", "occupation", "education", "address")} for row in guardians]
    if not include_sensitive:
        for field in ("nipd", "nisn", "nik"):
            identity[field] = mask_identifier(identity[field])
        for field in ("birth_date", "birth_place", "blood_type"):
            identity[field] = None
        for field in ("address", "student_phone", "student_email", "emergency_contact_phone"):
            if field in contact_values:
                contact_values[field] = mask_identifier(contact_values[field])
        for guardian in guardian_values:
            for field in ("phone", "email", "address"):
                guardian[field] = mask_identifier(guardian.get(field))
    return {
        "id": student.id, "record_version": record_version(student),
        "identity": identity,
        "contact": contact_values,
        "guardians": guardian_values,
        "device_identities": [{"id": row.id, "device_identifier": row.device_identifier if include_sensitive else mask_identifier(row.device_identifier), "device_source": row.device_source, "effective_from": row.effective_from, "effective_to": row.effective_to, "is_active": row.is_active} for row in devices],
        "enrollments": [{"id": row.id, "academic_year_id": year.id, "academic_year": year.label, "jenjang_id": jenjang.id, "jenjang": jenjang.name, "program": program.name if program else None, "grade": grade.name if grade else None, "academic_class_id": academic_class.id if academic_class else None, "class_name": academic_class.class_name if academic_class else row.class_name, "effective_from": row.effective_from, "effective_to": row.effective_to, "active": row.class_assigned and row.effective_to is None} for row, year, academic_class, grade, program, jenjang in enrollments],
        "updated_at": student.updated_at,
    }


def list_students(db: Session, *, search: str | None, academic_year_id: int | None, jenjang_id: int | None, class_id: int | None, status: str | None, device_linked: bool | None, enrollment_status: str | None, page: int, page_size: int) -> dict:
    query = db.query(StudentMaster)
    if search and search.strip():
        pattern = f"%{search.strip().casefold()}%"
        matching_devices = db.query(StudentDeviceIdentity.student_master_id).filter(StudentDeviceIdentity.device_identifier.ilike(pattern))
        query = query.filter(or_(func.lower(StudentMaster.full_name).like(pattern), func.lower(func.coalesce(StudentMaster.nipd, "")).like(pattern), func.lower(func.coalesce(StudentMaster.nisn, "")).like(pattern), StudentMaster.id.in_(matching_devices)))
    if status:
        query = query.filter(StudentMaster.student_status == status)
    enrollment_filter = db.query(StudentEnrollment.student_master_id).filter(StudentEnrollment.student_master_id.isnot(None))
    if academic_year_id: enrollment_filter = enrollment_filter.filter(StudentEnrollment.academic_year_id == academic_year_id)
    if jenjang_id: enrollment_filter = enrollment_filter.filter(StudentEnrollment.jenjang_id == jenjang_id)
    if class_id: enrollment_filter = enrollment_filter.filter(StudentEnrollment.academic_class_id == class_id)
    if academic_year_id or jenjang_id or class_id or enrollment_status == "enrolled": query = query.filter(StudentMaster.id.in_(enrollment_filter))
    if enrollment_status == "not_enrolled": query = query.filter(~StudentMaster.id.in_(enrollment_filter))
    device_filter = db.query(StudentDeviceIdentity.student_master_id).filter(StudentDeviceIdentity.is_active.is_(True))
    if device_linked is True: query = query.filter(StudentMaster.id.in_(device_filter))
    if device_linked is False: query = query.filter(~StudentMaster.id.in_(device_filter))
    total = query.count()
    rows = query.order_by(StudentMaster.full_name.asc(), StudentMaster.id.asc()).offset((page - 1) * page_size).limit(page_size).all()
    items = []
    for student in rows:
        enrollment = (
            db.query(StudentEnrollment, AcademicYear, AcademicClass, Jenjang)
            .join(AcademicYear, AcademicYear.id == StudentEnrollment.academic_year_id)
            .outerjoin(AcademicClass, AcademicClass.id == StudentEnrollment.academic_class_id)
            .join(Jenjang, Jenjang.id == StudentEnrollment.jenjang_id)
            .filter(StudentEnrollment.student_master_id == student.id)
            .order_by(AcademicYear.start_date.desc()).first()
        )
        device = db.query(StudentDeviceIdentity).filter_by(student_master_id=student.id, is_active=True).order_by(StudentDeviceIdentity.id.desc()).first()
        required = [student.full_name, student.nisn, student.nik, student.birth_date, student.gender, student.religion]
        completeness = round(sum(value not in (None, "") for value in required) / len(required) * 100)
        flags = []
        if not student.nisn: flags.append("missing_nisn")
        if not student.nik: flags.append("missing_nik")
        if not device: flags.append("no_active_device")
        if not enrollment: flags.append("no_enrollment")
        items.append({
            "id": student.id, "full_name": student.full_name, "preferred_name": student.preferred_name,
            "nipd_masked": mask_identifier(student.nipd), "nisn_masked": mask_identifier(student.nisn),
            "student_status": student.student_status,
            "current_jenjang": enrollment[3].name if enrollment else None,
            "current_class": (enrollment[2].class_name if enrollment and enrollment[2] else enrollment[0].class_name if enrollment else None),
            "academic_year": enrollment[1].label if enrollment else None,
            "device_identifier_masked": mask_identifier(device.device_identifier) if device else None,
            "profile_completeness": completeness, "quality_flags": flags, "updated_at": student.updated_at,
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size, "total_pages": (total + page_size - 1) // page_size}


def quality_summary(db: Session) -> dict:
    students = db.query(StudentMaster).all()
    active_devices = {row[0] for row in db.query(StudentDeviceIdentity.student_master_id).filter(StudentDeviceIdentity.is_active.is_(True)).all()}
    enrollments = {row[0] for row in db.query(StudentEnrollment.student_master_id).filter(StudentEnrollment.student_master_id.isnot(None), StudentEnrollment.effective_to.is_(None)).all()}
    return {
        "total": len(students), "missing_nisn": sum(not row.nisn for row in students),
        "missing_nik": sum(not row.nik for row in students), "missing_birth_date": sum(row.birth_date is None for row in students),
        "missing_gender": sum(not row.gender for row in students), "missing_religion": sum(not row.religion for row in students),
        "no_active_device": sum(row.id not in active_devices for row in students),
        "no_current_enrollment": sum(row.id not in enrollments for row in students),
    }
