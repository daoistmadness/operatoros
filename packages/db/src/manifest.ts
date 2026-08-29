export const CURRENT_SCHEMA_VERSION = "20260725_s43";
export const CURRENT_SCHEMA_FINGERPRINT =
  "b75e9774412bacf27baf5965a8267a21e58cbe4dba237cd897be9e959749bc57";

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
