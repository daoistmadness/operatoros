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
  "20260929_s47",
] as const;

export const CURRENT_SCHEMA_VERSION = SCHEMA_MIGRATIONS.at(-1)!;

export const S46_SOURCE_VARIANTS = {
  S4_6_VARIANT_A: "5b5ac2055aee5e90ee0f83ca5d309bd3503f8ecb61372cb491113de55cfb0ee4",
  S4_6_VARIANT_B: "dd798cf0171b3221577774cc1396cb5e1d57c33d927587fc2fc0c2cd45a88b0a",
} as const;

export function compareSchemaVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const leftIndex = SCHEMA_MIGRATIONS.indexOf(left as (typeof SCHEMA_MIGRATIONS)[number]);
  const rightIndex = SCHEMA_MIGRATIONS.indexOf(right as (typeof SCHEMA_MIGRATIONS)[number]);
  if (leftIndex < 0 || rightIndex < 0) return undefined;
  return leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1;
}
export const CURRENT_SCHEMA_FINGERPRINT =
  "171c0e5e92d080a3f81931ec8c7f299c07cb153d038bba3dd890de96a6dd4f8d";

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
  "trg_dismissal_policy_audits_no_delete",
  "trg_dismissal_policy_audits_no_update",
  "trg_early_departure_excuse_audits_no_delete",
  "trg_early_departure_excuse_audits_no_update",
  "trg_attendance_ledger_class_month_no_delete",
  "trg_attendance_ledger_class_month_no_update",
  "trg_attendance_ledger_revision_no_delete",
  "trg_attendance_ledger_revision_no_update",
  "trg_attendance_ledger_revision_sequence",
  "trg_attendance_ledger_revision_transition",
  "trg_attendance_ledger_class_month_scope",
  "trg_attendance_ledger_student_totals_mode",
  "trg_attendance_ledger_student_totals_scope",
  "trg_attendance_ledger_student_totals_no_delete",
  "trg_attendance_ledger_student_totals_no_update",
  "trg_jenjang_lateness_policy_no_delete",
  "trg_jenjang_lateness_policy_no_update",
  "trg_jenjang_lateness_policy_backfill_once",
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
  "trg_teacher_class_assignment_audit_no_delete",
  "trg_teacher_class_assignment_audit_no_update",
] as const;

export const PROTECTED_DATABASE_BASENAME = "attendance.db";
