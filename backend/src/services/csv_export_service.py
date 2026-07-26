"""Export service for OperatorOS versioned CSV data portability and templates."""

from __future__ import annotations

import io
import json

from datetime import UTC, datetime
from zipfile import ZipFile
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.attendance import Attendance
from models.student import Student
from models.student_enrollment import StudentEnrollment
from models.student_master import StudentAddress, StudentContact, StudentDeviceIdentity, StudentMaster, StudentParentGuardian
from services.csv_contract import DATASET_CONTRACTS, FORMAT_VERSION, SCHOOL_TIMEZONE, get_dataset_contract
from services.csv_serializer import serialize_csv
from services.operations_audit_service import log_operations_audit_event

MAX_EXPORT_ROWS = 5000


def generate_csv_template(dataset: str) -> StreamingResponse:
    """Generate downloadable ZIP template bundle containing template.csv, manifest.json, and README.txt."""
    contract = get_dataset_contract(dataset)
    if not contract.import_eligible:
        raise HTTPException(status_code=400, detail=f"Dataset {dataset} is export-only and does not support import templates.")

    headers = contract.required_columns + contract.optional_columns

    # Build synthetic template row
    if dataset == "student_roster":
        sample_row = ["STD-1001", "Ahmad Dahlan", "ACTIVE", "L", "Jakarta", "2010-05-15", "Islam"]
    elif dataset == "student_enrollment":
        sample_row = ["STD-1001", "Ahmad Dahlan", "2025/2026", "CLASS-7A", "ACTIVE"]
    elif dataset == "device_identity_mapping":
        sample_row = ["STD-1001", "RF-88291039", "Ahmad Dahlan", "true", "Primary RFID Card"]
    else:
        sample_row = ["-"] * len(headers)

    csv_bytes = serialize_csv(headers=headers, rows=[sample_row], include_bom=True)

    manifest = {
        "operatoros_format": FORMAT_VERSION,
        "dataset": dataset,
        "format_version": contract.format_version,
        "generated_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "school_timezone": SCHOOL_TIMEZONE,
        "required_columns": contract.required_columns,
        "optional_columns": contract.optional_columns,
        "update_policy": contract.update_policy,
        "template_type": "SYNTHETIC_EXAMPLE",
    }
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")

    readme_text = (
        f"OperatorOS Data Import Template\n"
        f"==============================\n"
        f"Dataset: {dataset}\n"
        f"Format Version: {contract.format_version}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Do not rename or remove required headers.\n"
        f"2. Matching uses stable student_id/NIS/NISN, not display names alone.\n"
        f"3. All dates must follow YYYY-MM-DD format.\n"
        f"4. CSV exports/templates are for data exchange only, NOT complete system backups.\n"
    ).encode("utf-8")

    zip_io = io.BytesIO()
    with ZipFile(zip_io, "w") as archive:
        archive.writestr(f"{dataset}_template.csv", csv_bytes)
        archive.writestr("manifest.json", manifest_bytes)
        archive.writestr("README.txt", readme_text)

    zip_io.seek(0)
    filename = f"{dataset}_template_bundle.zip"
    return StreamingResponse(
        zip_io,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def generate_export_preview(
    db: Session,
    *,
    dataset: str,
    filters: Optional[Dict[str, Any]] = None,
    include_sensitive_fields: bool = False,
    actor: str,
    actor_capabilities: set[str],
) -> Dict[str, Any]:
    contract = get_dataset_contract(dataset)
    if not contract.export_eligible:
        raise HTTPException(status_code=400, detail=f"Dataset {dataset} is not eligible for export.")

    requires_sensitive = include_sensitive_fields or dataset == "student_roster" and include_sensitive_fields
    if requires_sensitive and "export_sensitive_student_fields" not in actor_capabilities:
        if "export_student_data" not in actor_capabilities:
            raise HTTPException(status_code=403, detail="Permission denied: missing export capability")

    # Calculate row count
    row_count = _count_export_query(db, dataset=dataset, filters=filters)
    allowed = True
    warnings = []

    if row_count == 0:
        warnings.append("No records match the export criteria.")
    elif row_count > MAX_EXPORT_ROWS:
        allowed = False
        warnings.append(f"Export size ({row_count} rows) exceeds maximum allowed threshold of {MAX_EXPORT_ROWS} rows.")

    return {
        "dataset": dataset,
        "format_version": contract.format_version,
        "estimated_row_count": row_count,
        "sensitive_fields_included": requires_sensitive,
        "allowed": allowed,
        "warnings": warnings,
        "maximum_permitted_rows": MAX_EXPORT_ROWS,
        "filters": filters or {},
    }


def execute_csv_export(
    db: Session,
    *,
    dataset: str,
    format_type: str = "csv",  # "csv" or "csv_bundle"
    filters: Optional[Dict[str, Any]] = None,
    selected_ids: Optional[List[str]] = None,
    include_sensitive_fields: bool = False,
    actor: str,
    actor_capabilities: set[str],
) -> StreamingResponse:
    contract = get_dataset_contract(dataset)
    if not contract.export_eligible:
        raise HTTPException(status_code=400, detail=f"Dataset {dataset} is not eligible for export.")

    requires_sensitive = include_sensitive_fields
    required_cap = "export_sensitive_student_fields" if requires_sensitive else "export_student_data"

    if required_cap not in actor_capabilities and "export_student_data" not in actor_capabilities:
        log_operations_audit_event(
            db,
            actor_id=actor,
            actor_role="staff",
            capability=required_cap,
            entity_type="CSV_EXPORT",
            entity_reference=f"EXPORT_{dataset.upper()}",
            operation="EXPORT_DOWNLOAD",
            risk_level="HIGH" if requires_sensitive else "MEDIUM",
            export_scope=dataset,
            success=False,
            failure_code="PERMISSION_DENIED",
        )
        raise HTTPException(status_code=403, detail=f"Permission denied: missing capability {required_cap}")

    headers, rows = _build_export_data(
        db, dataset=dataset, filters=filters, selected_ids=selected_ids, include_sensitive=requires_sensitive
    )

    if not rows:
        raise HTTPException(status_code=400, detail="Cannot generate empty export. No matching records found.")

    if len(rows) > MAX_EXPORT_ROWS:
        raise HTTPException(status_code=400, detail=f"Export exceeds maximum allowed threshold of {MAX_EXPORT_ROWS} rows.")

    csv_bytes = serialize_csv(
        headers=headers,
        rows=rows,
        include_bom=True,
        is_data_bundle=(format_type == "csv_bundle"),
    )

    timestamp_str = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")

    log_operations_audit_event(
        db,
        actor_id=actor,
        actor_role="admin" if "export_sensitive_student_fields" in actor_capabilities else "staff",
        capability=required_cap,
        entity_type="CSV_EXPORT",
        entity_reference=f"EXPORT_{dataset.upper()}_{timestamp_str}",
        operation="EXPORT_DOWNLOAD",
        risk_level="HIGH" if requires_sensitive else "MEDIUM",
        export_scope=dataset,
        success=True,
        metadata={"row_count": len(rows), "format": format_type, "sensitive": requires_sensitive},
    )

    if format_type == "csv_bundle":
        import hashlib
        csv_hash = hashlib.sha256(csv_bytes).hexdigest()
        manifest = {
            "operatoros_format": FORMAT_VERSION,
            "dataset": dataset,
            "format_version": contract.format_version,
            "generated_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "school_timezone": SCHOOL_TIMEZONE,
            "csv_filename": f"{dataset}_{timestamp_str}.csv",
            "csv_sha256": csv_hash,
            "row_count": len(rows),
            "ordered_columns": headers,
            "sensitive_data_included": requires_sensitive,
            "spreadsheet_escaping": "apostrophe_prefix",
            "encoding": "UTF-8-BOM",
            "delimiter": ",",
        }
        manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")

        zip_io = io.BytesIO()
        with ZipFile(zip_io, "w") as archive:
            archive.writestr(f"{dataset}_{timestamp_str}.csv", csv_bytes)
            archive.writestr("manifest.json", manifest_bytes)

        zip_io.seek(0)
        bundle_filename = f"{dataset}_bundle_{timestamp_str}.zip"
        return StreamingResponse(
            zip_io,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{bundle_filename}"'},
        )
    else:
        csv_filename = f"{dataset}_{timestamp_str}.csv"
        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{csv_filename}"'},
        )


def _count_export_query(db: Session, *, dataset: str, filters: Optional[Dict[str, Any]]) -> int:
    filters = filters or {}
    if dataset == "student_roster":
        q = db.query(StudentMaster)
        if filters.get("status"):
            q = q.filter(StudentMaster.student_status == filters["status"])
        return q.count()
    elif dataset == "student_enrollment":
        return db.query(StudentEnrollment).count()
    elif dataset == "device_identity_mapping":
        return db.query(StudentDeviceIdentity).count()
    elif dataset == "attendance_operational_summary":
        return db.query(Attendance).count()
    return 0


def _build_export_data(
    db: Session,
    *,
    dataset: str,
    filters: Optional[Dict[str, Any]],
    selected_ids: Optional[List[str]],
    include_sensitive: bool,
) -> Tuple[List[str], List[List[Any]]]:
    filters = filters or {}
    headers: List[str] = []
    rows: List[List[Any]] = []

    if dataset == "student_roster":
        if include_sensitive:
            headers = ["student_id", "full_name", "student_status", "gender", "nik", "nisn", "nipd", "active_device_id", "street_address", "phone_number", "guardian_name", "guardian_phone"]
        else:
            headers = ["student_id", "full_name", "student_status", "gender", "birth_place", "birth_date", "religion"]

        q = db.query(StudentMaster)
        if selected_ids:
            q = q.filter(StudentMaster.id.in_(selected_ids))
        if filters.get("status"):
            q = q.filter(StudentMaster.student_status == filters["status"])

        students = q.order_by(StudentMaster.id.asc()).limit(MAX_EXPORT_ROWS).all()
        for s in students:
            if include_sensitive:
                dev = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.student_master_id == s.id, StudentDeviceIdentity.is_active.is_(True)).first()
                addr = db.query(StudentAddress).filter(StudentAddress.student_master_id == s.id).first()
                contact = db.query(StudentContact).filter(StudentContact.student_master_id == s.id).first()
                guardian = db.query(StudentParentGuardian).filter(StudentParentGuardian.student_master_id == s.id).first()
                rows.append([
                    s.id, s.full_name, s.student_status, s.gender or "-",
                    str(s.nik or "-"), str(s.nisn or "-"), str(s.nipd or "-"),
                    dev.device_identifier if dev else "-",
                    addr.street_address if addr else "-",
                    str(contact.phone_number if contact else "-"),
                    guardian.guardian_name if guardian else "-",
                    str(guardian.guardian_phone if guardian else "-"),
                ])
            else:
                rows.append([
                    s.id, s.full_name, s.student_status, s.gender or "-",
                    s.birth_place or "-",
                    s.birth_date.strftime("%Y-%m-%d") if s.birth_date else "-",
                    s.religion or "-",
                ])

    elif dataset == "student_enrollment":
        headers = ["student_id", "full_name", "academic_year_code", "class_code", "enrollment_status"]
        enrollments = db.query(StudentEnrollment).order_by(StudentEnrollment.id.asc()).limit(MAX_EXPORT_ROWS).all()
        for e in enrollments:
            s_name = e.student_master.full_name if e.student_master else "-"
            rows.append([e.student_master_id or "-", s_name, e.academic_year_code or "-", e.class_code or "-", e.status or "ACTIVE"])

    elif dataset == "device_identity_mapping":
        headers = ["student_id", "device_identifier", "full_name", "is_active", "notes"]
        devices = db.query(StudentDeviceIdentity).order_by(StudentDeviceIdentity.id.asc()).limit(MAX_EXPORT_ROWS).all()
        for d in devices:
            s_name = d.student_master.full_name if d.student_master else "-"
            rows.append([d.student_master_id, d.device_identifier, s_name, "true" if d.is_active else "false", d.notes or ""])

    elif dataset == "attendance_operational_summary":
        headers = ["date", "student_id", "full_name", "class_name", "status", "scan_in", "scan_out", "late_minutes"]
        records = db.query(Attendance).order_by(Attendance.date.desc(), Attendance.id.asc()).limit(MAX_EXPORT_ROWS).all()
        for a in records:
            s_name = a.student.name if a.student else f"Student #{a.student_id}"
            c_name = a.student.class_name if a.student else "-"
            rows.append([
                a.date.strftime("%Y-%m-%d") if a.date else "-",
                a.student_id, s_name, c_name, a.status,
                a.check_in.strftime("%H:%M:%S") if a.check_in else "-",
                a.check_out.strftime("%H:%M:%S") if a.check_out else "-",
                a.late_duration or 0,
            ])

    return headers, rows
