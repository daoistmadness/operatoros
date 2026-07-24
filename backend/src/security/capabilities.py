from __future__ import annotations

from typing import Final


STUDENT_CAPABILITIES: Final[frozenset[str]] = frozenset({
    "view_student",
    "view_sensitive_student_fields",
    "create_student",
    "edit_student",
    "edit_sensitive_identifiers",
    "manage_device_identity",
    "reassign_device_identity",
    "manage_enrollment",
    "transfer_enrollment",
    "end_enrollment",
    "manage_enrollment_lifecycle",
    "delete_enrollment_draft",
    "import_student_roster",
    "commit_student_roster",
    "export_student_data",
    "export_sensitive_student_fields",
    "import_student_updates",
    "commit_student_updates",
    "resolve_student_duplicates",
    "view_student_audit",
    "manage_student_permissions",
    "rollback_import_session",
    "view_progression_preview",
    "create_progression_preview",
    "override_progression_mapping",
    "commit_progression_batch",
    "graduate_students",
    "retain_students",
    "execute_cross_jenjang_transition",
    "reverse_progression_error",
    "view_attendance",
    "manage_attendance",
    "import_attendance",
    "view_attendance_corrections",
    "request_attendance_correction",
    "review_attendance_correction",
    "approve_attendance_correction",
    "reject_attendance_correction",
    "cancel_attendance_correction",
    "finalize_attendance_period",
    "reopen_attendance_period",
})


ROLE_CAPABILITIES: Final[dict[str, frozenset[str]]] = {
    "admin": STUDENT_CAPABILITIES,
    # The repository currently has one non-administrative role. Keep it a
    # deliberately narrow operational reader until institution-specific roles
    # are introduced through an approved schema migration.
    "staff": frozenset({
        "view_student", "view_progression_preview", "view_attendance",
        "view_attendance_corrections", "request_attendance_correction",
        "cancel_attendance_correction",
    }),
}


def capabilities_for_role(role: str) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(role, frozenset())
