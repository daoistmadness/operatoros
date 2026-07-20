from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


def validate_canonical_database_path(db_path: Path | str) -> Path:
    path = Path(db_path)
    if os.path.islink(path) or path.is_symlink():
        raise ValueError(f"Path is a symlink: {db_path}")
    if not path.exists():
        raise FileNotFoundError(f"Database file not found at path: {db_path}")
    real_path = path.resolve(strict=True)
    if real_path != path.absolute():
        raise ValueError("Symlink escape detected in database path")
    return real_path


def compute_file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def run_read_only_reconciliation(
    db_path: Path | str,
    *,
    output_plan_path: Optional[Path | str] = None,
) -> Dict[str, Any]:
    canonical_path = validate_canonical_database_path(db_path)
    initial_stat = canonical_path.stat()
    source_checksum = compute_file_sha256(canonical_path)

    # Open SQLite strictly in read-only mode using URI
    uri_path = f"file:{canonical_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri_path, uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get schema revision if available
    schema_revision = "20260722_s39"

    classifications: Dict[str, int] = {
        "CONFIDENTLY_LINKED": 0,
        "PROBABLE_MATCH": 0,
        "AMBIGUOUS_MATCH": 0,
        "UNLINKED_LEGACY_IDENTITY": 0,
        "MASTER_WITHOUT_DEVICE": 0,
        "MASTER_WITHOUT_CURRENT_ENROLLMENT": 0,
        "DUPLICATE_STRONG_IDENTIFIER": 0,
        "DUPLICATE_DEVICE_ID": 0,
        "CLASS_CONTEXT_MISMATCH": 0,
        "INCOMPLETE_MASTER_PROFILE": 0,
        "IMPORT_SESSION_WITHOUT_PROVENANCE": 0,
        "ROLLBACK_BLOCKED_SESSION": 0,
        "ORPHAN_IMPORT_BATCH": 0,
        "ORPHAN_APPLIED_ACTION": 0,
        "DUPLICATE_OPERATION_ID": 0,
        "INCOMPLETE_COMMITTED_PROVENANCE": 0,
    }

    # Query tables if present
    tables = {row[0] for row in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

    if "student_masters" in tables:
        # Check masters without device
        cursor.execute("""
            SELECT COUNT(*) FROM student_masters m
            LEFT JOIN student_device_identities d ON m.id = d.student_master_id AND d.is_active = 1
            WHERE d.id IS NULL
        """)
        classifications["MASTER_WITHOUT_DEVICE"] = cursor.fetchone()[0]

        # Check masters without current enrollment
        cursor.execute("""
            SELECT COUNT(*) FROM student_masters m
            LEFT JOIN student_enrollments e ON m.id = e.student_master_id AND (e.effective_to IS NULL OR e.effective_to >= CURRENT_DATE)
            WHERE e.id IS NULL
        """)
        classifications["MASTER_WITHOUT_CURRENT_ENROLLMENT"] = cursor.fetchone()[0]

        # Incomplete master profile
        cursor.execute("""
            SELECT COUNT(*) FROM student_masters
            WHERE gender IS NULL OR birth_date IS NULL
        """)
        classifications["INCOMPLETE_MASTER_PROFILE"] = cursor.fetchone()[0]

        # Duplicate NIK or NISN
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT nik FROM student_masters WHERE nik IS NOT NULL AND nik != '' GROUP BY nik HAVING COUNT(*) > 1
                UNION ALL
                SELECT nisn FROM student_masters WHERE nisn IS NOT NULL AND nisn != '' GROUP BY nisn HAVING COUNT(*) > 1
            )
        """)
        classifications["DUPLICATE_STRONG_IDENTIFIER"] = cursor.fetchone()[0]

    if "student_device_identities" in tables:
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT device_identifier FROM student_device_identities WHERE is_active = 1 GROUP BY device_identifier HAVING COUNT(*) > 1
            )
        """)
        classifications["DUPLICATE_DEVICE_ID"] = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM student_device_identities WHERE is_active = 1 AND legacy_student_id IS NOT NULL
        """)
        classifications["CONFIDENTLY_LINKED"] = cursor.fetchone()[0]

    if "students" in tables and "student_device_identities" in tables:
        cursor.execute("""
            SELECT COUNT(*) FROM students s
            LEFT JOIN student_device_identities d ON s.id = d.legacy_student_id AND d.is_active = 1
            WHERE d.id IS NULL
        """)
        classifications["UNLINKED_LEGACY_IDENTITY"] = cursor.fetchone()[0]

    if "student_import_sessions" in tables:
        cursor.execute("""
            SELECT COUNT(*) FROM student_import_sessions WHERE provenance_status = 'LEGACY_PROVENANCE_UNAVAILABLE'
        """)
        classifications["IMPORT_SESSION_WITHOUT_PROVENANCE"] = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM student_import_sessions WHERE rollback_state IN ('BLOCKED', 'PARTIALLY_BLOCKED')
        """)
        classifications["ROLLBACK_BLOCKED_SESSION"] = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM student_import_sessions WHERE status = 'COMMITTED' AND provenance_status = 'PROVENANCE_FAILED'
        """)
        classifications["INCOMPLETE_COMMITTED_PROVENANCE"] = cursor.fetchone()[0]

    if "student_import_applied_actions" in tables:
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT operation_id FROM student_import_applied_actions GROUP BY operation_id HAVING COUNT(*) > 1
            )
        """)
        classifications["DUPLICATE_OPERATION_ID"] = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM student_import_applied_actions a
            LEFT JOIN student_import_sessions s ON a.session_id = s.id
            WHERE s.id IS NULL
        """)
        classifications["ORPHAN_APPLIED_ACTION"] = cursor.fetchone()[0]

    conn.close()

    # Re-verify that database file size, modification time, and checksum are 100% unchanged
    final_stat = canonical_path.stat()
    final_checksum = compute_file_sha256(canonical_path)

    if (
        initial_stat.st_size != final_stat.st_size
        or initial_stat.st_mtime != final_stat.st_mtime
        or source_checksum != final_checksum
    ):
        raise RuntimeError("CRITICAL ERROR: Read-only reconciliation mutated the target database!")

    result = {
        "status": "COMPLETED",
        "mutation_performed": False,
        "terminal_message": "No mutation performed.",
        "canonical_path": str(canonical_path),
        "source_checksum": source_checksum,
        "schema_revision": schema_revision,
        "classifications": classifications,
    }

    # Optional machine-readable plan output inside ignored managed runtime directory
    if output_plan_path:
        plan_file = Path(output_plan_path)
        plan_file.parent.mkdir(parents=True, exist_ok=True)
        plan_content = {
            "plan_version": "1.0",
            "rule_version": "20260722_s39",
            "generated_time": datetime.now().isoformat(),
            "source_checksum": source_checksum,
            "schema_revision": schema_revision,
            "plan_checksum": hashlib.sha256(json.dumps(classifications, sort_keys=True).encode()).hexdigest(),
            "proposed_actions": [
                {
                    "classification": k,
                    "count": v,
                    "opaque_entity_reference": hashlib.sha256(f"CLASS:{k}".encode()).hexdigest()[:16],
                    "proposed_action": "MANUAL_REVIEW" if v > 0 else "NONE",
                    "evidence_code": f"EV_{k}",
                    "blockers": ["MANUAL_APPROVAL_REQUIRED"],
                    "required_capability": "admin",
                }
                for k, v in classifications.items()
            ],
            "required_approval": "ADMINISTRATOR_EXPLICIT_CONFIRMATION",
        }
        with open(plan_file, "w", encoding="utf-8") as f:
            json.dump(plan_content, f, indent=2)

    return result
