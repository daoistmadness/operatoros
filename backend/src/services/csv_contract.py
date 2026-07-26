"""Centralized CSV specification and format contract for OperatorOS data portability."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Set, Optional

FORMAT_VERSION = "operatoros_csv_v1"
SCHOOL_TIMEZONE = "Asia/Jakarta"

@dataclass(frozen=True)
class DatasetContract:
    identifier: str
    format_version: str
    required_columns: List[str]
    optional_columns: List[str]
    stable_identifier_columns: List[str]
    sensitive_columns: List[str]
    export_eligible: bool
    import_eligible: bool
    requires_sensitive_capability: bool
    update_policy: str

DATASET_CONTRACTS: Dict[str, DatasetContract] = {
    "student_roster": DatasetContract(
        identifier="student_roster",
        format_version=FORMAT_VERSION,
        required_columns=["student_id", "full_name", "student_status", "gender"],
        optional_columns=["birth_place", "birth_date", "religion"],
        stable_identifier_columns=["student_id"],
        sensitive_columns=["nik", "nisn", "nipd", "active_device_id", "street_address", "phone_number", "guardian_name", "guardian_phone"],
        export_eligible=True,
        import_eligible=True,
        requires_sensitive_capability=False,
        update_policy="safe_upsert_with_preview",
    ),
    "student_enrollment": DatasetContract(
        identifier="student_enrollment",
        format_version=FORMAT_VERSION,
        required_columns=["student_id", "full_name", "academic_year_code", "class_code"],
        optional_columns=["enrollment_status"],
        stable_identifier_columns=["student_id", "academic_year_code"],
        sensitive_columns=[],
        export_eligible=True,
        import_eligible=True,
        requires_sensitive_capability=False,
        update_policy="safe_upsert_with_preview",
    ),
    "device_identity_mapping": DatasetContract(
        identifier="device_identity_mapping",
        format_version=FORMAT_VERSION,
        required_columns=["student_id", "device_identifier"],
        optional_columns=["full_name", "is_active", "notes"],
        stable_identifier_columns=["student_id", "device_identifier"],
        sensitive_columns=[],
        export_eligible=True,
        import_eligible=True,
        requires_sensitive_capability=False,
        update_policy="explicit_reassignment_preview",
    ),
    "attendance_operational_summary": DatasetContract(
        identifier="attendance_operational_summary",
        format_version=FORMAT_VERSION,
        required_columns=["date", "student_id", "full_name", "class_name", "status"],
        optional_columns=["scan_in", "scan_out", "late_minutes", "override_status", "correction_note"],
        stable_identifier_columns=["student_id", "date"],
        sensitive_columns=[],
        export_eligible=True,
        import_eligible=False,  # Export report only!
        requires_sensitive_capability=False,
        update_policy="prohibited",
    ),
}

def get_dataset_contract(identifier: str) -> DatasetContract:
    if identifier not in DATASET_CONTRACTS:
        raise ValueError(f"Unrecognized dataset identifier: {identifier}")
    return DATASET_CONTRACTS[identifier]
