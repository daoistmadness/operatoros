const ADMIN_CAPABILITIES = [
  "approve_attendance_correction", "assign_attendance_followup", "cancel_attendance_correction",
  "commit_progression_batch", "commit_student_roster", "commit_student_updates", "create_attendance_followup",
  "create_progression_preview", "create_student", "delete_enrollment_draft", "edit_sensitive_identifiers",
  "edit_student", "end_enrollment", "enter_assigned_class_attendance", "execute_cross_jenjang_transition",
  "export_sensitive_student_fields", "export_staff", "export_student_data", "finalize_attendance_period",
  "graduate_students", "import_attendance", "import_staff", "import_student_roster", "import_student_updates",
  "manage_all_attendance", "manage_all_attendance_followups", "manage_attendance", "manage_device_identity",
  "manage_early_departure_policy", "manage_enrollment", "manage_enrollment_lifecycle", "manage_staff",
  "manage_student_permissions", "manage_teacher_class_assignments", "override_progression_mapping",
  "reassign_device_identity", "record_early_departure_excuse", "reject_attendance_correction",
  "reopen_attendance_followup", "reopen_attendance_period", "request_assigned_attendance_correction",
  "request_attendance_correction", "resolve_attendance_followup", "resolve_student_duplicates", "retain_students",
  "reverse_progression_error", "review_attendance_correction", "review_staff_import", "revoke_early_departure_excuse",
  "rollback_import_session", "transfer_enrollment", "update_attendance_followup", "view_all_attendance",
  "view_assigned_attendance", "view_attendance", "view_attendance_corrections", "view_attendance_followup_audit",
  "view_attendance_followups", "view_early_departure", "view_early_departure_audit", "view_progression_preview",
  "view_sensitive_student_fields", "view_staff", "view_staff_audit", "view_staff_sensitive", "view_student",
  "view_student_audit",
] as const;

const STAFF_CAPABILITIES = [
  "assign_attendance_followup", "cancel_attendance_correction", "create_attendance_followup",
  "enter_assigned_class_attendance", "record_early_departure_excuse", "reopen_attendance_followup",
  "request_assigned_attendance_correction", "request_attendance_correction", "resolve_attendance_followup",
  "update_attendance_followup", "view_assigned_attendance", "view_attendance", "view_attendance_corrections",
  "view_attendance_followup_audit", "view_attendance_followups", "view_early_departure", "view_progression_preview",
  "view_student",
] as const;

export function capabilitiesForRole(role: string): string[] {
  return [...(role === "admin" ? ADMIN_CAPABILITIES : role === "staff" ? STAFF_CAPABILITIES : [])].sort();
}
