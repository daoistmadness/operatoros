export const CURRENT_SCHEMA_VERSION = "20260901_s45";
export const CURRENT_SCHEMA_FINGERPRINT =
  "48fbeb6424d0475a3c8bbb7b944a52afb17fc2b73edbb25a721a3f1083e896d6";

export const REQUIRED_TRIGGERS = [
  "trg_academic_roster_batch_session_type",
  "trg_academic_roster_batch_session_type_update",
  "trg_attendance_correction_audit_no_delete",
  "trg_attendance_correction_audit_no_update",
  "trg_attendance_follow_up_audit_no_delete",
  "trg_attendance_follow_up_audit_no_update",
  "trg_attendance_override_history_no_delete",
  "trg_attendance_override_history_no_update",
  "trg_attendance_period_audit_no_delete",
  "trg_attendance_period_audit_no_update",
  "trg_student_enrollment_class_history_no_delete",
  "trg_student_enrollment_class_history_no_update",
  "trg_student_enrollment_lifecycle_audit_no_delete",
  "trg_student_enrollment_lifecycle_audit_no_update",
  "trg_student_import_actions_immutable",
  "trg_student_import_actions_no_delete",
  "trg_student_import_batch_session_type",
  "trg_student_import_batch_session_type_update",
  "trg_student_master_change_history_no_delete",
  "trg_student_master_change_history_no_update",
  "trg_student_progression_audit_no_delete",
  "trg_student_progression_audit_no_update",
] as const;

export const PROTECTED_DATABASE_BASENAME = "attendance.db";
