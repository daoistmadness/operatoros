export const CURRENT_SCHEMA_VERSION = "20260901_s46";
export const CURRENT_SCHEMA_FINGERPRINT =
  "dd798cf0171b3221577774cc1396cb5e1d57c33d927587fc2fc0c2cd45a88b0a";

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
