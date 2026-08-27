"""Import preview and commit adapters for CSV roster and device mapping portability."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional, Tuple

from core.fixture_http import HTTPException
from sqlalchemy.orm import Session

from models.student_master import StudentDeviceIdentity, StudentMaster
from services.csv_contract import get_dataset_contract
from services.csv_parser import parse_csv_bytes, parse_zip_bundle
from services.csv_serializer import serialize_csv
from services.operations_audit_service import log_operations_audit_event

# Transient in-memory store for import preview sessions
IMPORT_SESSIONS: Dict[str, Dict[str, Any]] = {}


def process_csv_import_preview(
    db: Session,
    *,
    dataset: str,
    file_bytes: bytes,
    filename: str,
    actor: str,
) -> Dict[str, Any]:
    if dataset == "attendance_operational_summary":
        raise HTTPException(
            status_code=400,
            detail="DATA_IMPORT_ATTENDANCE_PROHIBITED: Raw attendance CSV import is prohibited. Attendance summaries are export-only reports.",
        )

    contract = get_dataset_contract(dataset)
    if not contract.import_eligible:
        raise HTTPException(status_code=400, detail=f"Dataset {dataset} does not support CSV import.")

    # Unpack ZIP or parse CSV directly
    is_zip = filename.casefold().endswith(".zip")
    if is_zip:
        bundle_dataset, manifest, csv_bytes = parse_zip_bundle(file_bytes, filename)
        if bundle_dataset != dataset:
            raise HTTPException(
                status_code=400,
                detail=f"ZIP bundle dataset ({bundle_dataset}) does not match selected import dataset ({dataset}).",
            )
    else:
        csv_bytes = file_bytes

    headers, rows, source_hash = parse_csv_bytes(
        csv_bytes,
        filename=filename,
        expected_headers=contract.required_columns,
    )

    if dataset == "student_roster":
        preview_data = _preview_student_roster(db, rows)
    elif dataset == "device_identity_mapping":
        preview_data = _preview_device_identity_mapping(db, rows)
    else:
        raise HTTPException(status_code=400, detail=f"Import preview not implemented for dataset {dataset}")

    batch_id = f"import_{uuid.uuid4().hex[:12]}"
    session_data = {
        "batch_id": batch_id,
        "dataset": dataset,
        "filename": filename,
        "source_hash": source_hash,
        "rows": rows,
        "preview": preview_data,
        "actor": actor,
    }
    IMPORT_SESSIONS[batch_id] = session_data

    log_operations_audit_event(
        db,
        actor_id=actor,
        actor_role="admin",
        capability="import_student_data",
        entity_type="CSV_IMPORT",
        entity_reference=f"IMPORT_PREVIEW_{dataset.upper()}",
        operation="IMPORT_PREVIEW",
        risk_level="MEDIUM",
        export_scope=dataset,
        success=True,
        metadata={
            "batch_id": batch_id,
            "total_rows": len(rows),
            "valid_count": preview_data["valid_count"],
            "error_count": preview_data["error_count"],
        },
    )

    return {
        "batch_id": batch_id,
        "dataset": dataset,
        "filename": filename,
        "source_hash": source_hash,
        "total_rows": len(rows),
        "valid_count": preview_data["valid_count"],
        "error_count": preview_data["error_count"],
        "summary": preview_data["summary"],
        "classified_rows": preview_data["classified_rows"],
        "errors": preview_data["errors"],
    }


def execute_csv_import_commit(
    db: Session,
    *,
    batch_id: str,
    confirmation: str,
    actor: str,
) -> Dict[str, Any]:
    session = IMPORT_SESSIONS.get(batch_id)
    if not session:
        raise HTTPException(status_code=404, detail="Import session not found or expired.")

    if confirmation != "CONFIRM_IMPORT":
        raise HTTPException(status_code=400, detail="Confirmation token must equal 'CONFIRM_IMPORT'")

    dataset = session["dataset"]
    rows = session["rows"]
    preview = session["preview"]

    if preview["error_count"] > 0 and preview["valid_count"] == 0:
        raise HTTPException(status_code=400, detail="Cannot commit import session with zero valid rows.")

    committed_count = 0
    if dataset == "student_roster":
        committed_count = _commit_student_roster(db, rows)
    elif dataset == "device_identity_mapping":
        committed_count = _commit_device_identity_mapping(db, rows)

    # Clean up session
    IMPORT_SESSIONS.pop(batch_id, None)

    log_operations_audit_event(
        db,
        actor_id=actor,
        actor_role="admin",
        capability="import_student_data",
        entity_type="CSV_IMPORT",
        entity_reference=f"IMPORT_COMMIT_{batch_id}",
        operation="IMPORT_COMMIT",
        risk_level="HIGH",
        export_scope=dataset,
        success=True,
        metadata={"batch_id": batch_id, "committed_count": committed_count},
    )

    return {
        "success": True,
        "batch_id": batch_id,
        "dataset": dataset,
        "committed_count": committed_count,
        "message": f"Successfully committed {committed_count} records.",
    }


def generate_import_error_file(errors: List[Dict[str, Any]]) -> bytes:
    """Generate downloadable CSV error report for import preview failures."""
    headers = ["source_row", "field", "safe_error_code", "explanation", "recommended_action"]
    rows = []
    for err in errors:
        rows.append([
            err.get("row", "-"),
            err.get("field", "-"),
            err.get("code", "INVALID"),
            err.get("message", "-"),
            err.get("recommended_action", "Correct cell value and re-upload"),
        ])
    return serialize_csv(headers=headers, rows=rows, include_bom=True)


def _preview_student_roster(db: Session, rows: List[Dict[str, str]]) -> Dict[str, Any]:
    summary = {"NEW": 0, "UPDATE": 0, "UNCHANGED": 0, "INVALID": 0}
    classified: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for r in rows:
        row_num = r.get("_source_row", "0")
        s_id = r.get("student_id", "").strip()
        full_name = r.get("full_name", "").strip()
        status = r.get("student_status", "").strip().lower() or "active"

        if not s_id or not full_name:
            summary["INVALID"] += 1
            err = {"row": row_num, "field": "student_id/full_name", "code": "REQUIRED_FIELD_MISSING", "message": "student_id and full_name are required."}
            errors.append(err)
            classified.append({"row": row_num, "student_id": s_id, "full_name": full_name, "status": "INVALID", "error": err["message"]})
            continue

        existing = db.query(StudentMaster).filter(StudentMaster.id == s_id).first()
        if existing:
            if existing.full_name == full_name and existing.student_status == status:
                summary["UNCHANGED"] += 1
                classified.append({"row": row_num, "student_id": s_id, "full_name": full_name, "status": "UNCHANGED"})
            else:
                summary["UPDATE"] += 1
                classified.append({"row": row_num, "student_id": s_id, "full_name": full_name, "status": "UPDATE"})
        else:
            summary["NEW"] += 1
            classified.append({"row": row_num, "student_id": s_id, "full_name": full_name, "status": "NEW"})

    valid_count = summary["NEW"] + summary["UPDATE"] + summary["UNCHANGED"]
    error_count = summary["INVALID"]
    return {
        "valid_count": valid_count,
        "error_count": error_count,
        "summary": summary,
        "classified_rows": classified,
        "errors": errors,
    }


def _commit_student_roster(db: Session, rows: List[Dict[str, str]]) -> int:
    committed = 0
    with db.begin_nested():
        for r in rows:
            s_id = r.get("student_id", "").strip()
            full_name = r.get("full_name", "").strip()
            status = r.get("student_status", "").strip().lower() or "active"
            gender = r.get("gender", "").strip().upper() or None
            birth_place = r.get("birth_place", "").strip() or None
            religion = r.get("religion", "").strip() or None

            if not s_id or not full_name:
                continue

            existing = db.query(StudentMaster).filter(StudentMaster.id == s_id).first()
            if existing:
                existing.full_name = full_name
                existing.student_status = status
                if gender: existing.gender = gender
                if birth_place: existing.birth_place = birth_place
                if religion: existing.religion = religion
            else:
                new_student = StudentMaster(
                    id=s_id,
                    full_name=full_name,
                    normalized_name=full_name.casefold(),
                    student_status=status,
                    gender=gender,
                    birth_place=birth_place,
                    religion=religion,
                )
                db.add(new_student)
            committed += 1
    db.commit()
    return committed


def _preview_device_identity_mapping(db: Session, rows: List[Dict[str, str]]) -> Dict[str, Any]:
    summary = {"NEW": 0, "UPDATE": 0, "UNCHANGED": 0, "CONFLICT": 0, "INVALID": 0}
    classified: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    seen_devices: Dict[str, str] = {}

    for r in rows:
        row_num = r.get("_source_row", "0")
        s_id = r.get("student_id", "").strip()
        device_id = r.get("device_identifier", "").strip()

        if not s_id or not device_id:
            summary["INVALID"] += 1
            err = {"row": row_num, "field": "student_id/device_identifier", "code": "REQUIRED_FIELD_MISSING", "message": "student_id and device_identifier are required."}
            errors.append(err)
            classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "INVALID", "error": err["message"]})
            continue

        if device_id in seen_devices:
            summary["CONFLICT"] += 1
            err = {"row": row_num, "field": "device_identifier", "code": "DUPLICATE_IN_FILE", "message": f"Device {device_id} appears multiple times in upload."}
            errors.append(err)
            classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "CONFLICT", "error": err["message"]})
            continue
        seen_devices[device_id] = s_id

        student = db.query(StudentMaster).filter(StudentMaster.id == s_id).first()
        if not student:
            summary["INVALID"] += 1
            err = {"row": row_num, "field": "student_id", "code": "STUDENT_NOT_FOUND", "message": f"Student ID {s_id} not found."}
            errors.append(err)
            classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "INVALID", "error": err["message"]})
            continue

        existing_dev = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.device_identifier == device_id).first()
        if existing_dev:
            if existing_dev.student_master_id == s_id:
                summary["UNCHANGED"] += 1
                classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "UNCHANGED"})
            else:
                summary["CONFLICT"] += 1
                err = {"row": row_num, "field": "device_identifier", "code": "DEVICE_ASSIGNED_TO_OTHER", "message": f"Device {device_id} is assigned to student {existing_dev.student_master_id}."}
                errors.append(err)
                classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "CONFLICT", "error": err["message"]})
        else:
            summary["NEW"] += 1
            classified.append({"row": row_num, "student_id": s_id, "device_id": device_id, "status": "NEW"})

    valid_count = summary["NEW"] + summary["UPDATE"] + summary["UNCHANGED"]
    error_count = summary["INVALID"] + summary["CONFLICT"]
    return {
        "valid_count": valid_count,
        "error_count": error_count,
        "summary": summary,
        "classified_rows": classified,
        "errors": errors,
    }


def _commit_device_identity_mapping(db: Session, rows: List[Dict[str, str]]) -> int:
    committed = 0
    today = datetime.now(UTC).date()
    with db.begin_nested():
        for r in rows:
            s_id = r.get("student_id", "").strip()
            device_id = r.get("device_identifier", "").strip()

            if not s_id or not device_id:
                continue

            existing_dev = db.query(StudentDeviceIdentity).filter(StudentDeviceIdentity.device_identifier == device_id).first()
            if existing_dev:
                if existing_dev.student_master_id == s_id:
                    existing_dev.is_active = True
                    committed += 1
            else:
                new_dev = StudentDeviceIdentity(
                    student_master_id=s_id,
                    device_identifier=device_id,
                    device_source="CSV_IMPORT",
                    effective_from=today,
                    is_active=True,
                )
                db.add(new_dev)
                committed += 1
    db.commit()
    return committed
