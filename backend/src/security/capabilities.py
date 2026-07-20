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
})


ROLE_CAPABILITIES: Final[dict[str, frozenset[str]]] = {
    "admin": STUDENT_CAPABILITIES,
    # The repository currently has one non-administrative role. Keep it a
    # deliberately narrow operational reader until institution-specific roles
    # are introduced through an approved schema migration.
    "staff": frozenset({"view_student"}),
}


def capabilities_for_role(role: str) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(role, frozenset())
