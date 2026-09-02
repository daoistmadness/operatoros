// The current schema head is derived from canonical migration order. Consumers
// must import or query this value instead of redeclaring it.
export const SCHEMA_MIGRATIONS = [
  "20260722_s38",
  "20260722_s39",
  "20260722_s40",
  "20260722_s41",
  "20260724_s42",
  "20260725_s43",
  "20260831_s44",
  "20260901_s45",
  "20260901_s46",
] as const;

export const CURRENT_SCHEMA_VERSION = SCHEMA_MIGRATIONS.at(-1)!;

export function compareSchemaVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const leftIndex = SCHEMA_MIGRATIONS.indexOf(left as (typeof SCHEMA_MIGRATIONS)[number]);
  const rightIndex = SCHEMA_MIGRATIONS.indexOf(right as (typeof SCHEMA_MIGRATIONS)[number]);
  if (leftIndex < 0 || rightIndex < 0) return undefined;
  return leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1;
}
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
