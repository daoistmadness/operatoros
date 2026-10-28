import { Type, type Static } from "@sinclair/typebox";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const BackupHealthStateSchema = Type.Union([
  Type.Literal("HEALTHY"), Type.Literal("AGING"), Type.Literal("STALE"),
  Type.Literal("NO_BACKUP"), Type.Literal("LAST_BACKUP_FAILED"),
  Type.Literal("DESTINATION_UNAVAILABLE"), Type.Literal("LOW_DISK_SPACE"),
  Type.Literal("BACKUP_IN_PROGRESS"), Type.Literal("RESTORE_IN_PROGRESS"),
  Type.Literal("UNKNOWN"),
]);
export type BackupHealthState = Static<typeof BackupHealthStateSchema>;

export const BackupStatusSchema = Type.Object({
  health_state: BackupHealthStateSchema,
  last_successful_backup_at: NullableString,
  last_failed_backup_at: NullableString,
  last_failure_code: NullableString,
  last_failure_message: NullableString,
  latest_backup_filename: NullableString,
  latest_backup_type: NullableString,
  latest_backup_size_bytes: NullableNumber,
  latest_backup_checksum_status: Type.Union([Type.Literal("verified"), Type.Literal("failed"), Type.Null()]),
  latest_backup_integrity_status: Type.Union([Type.Literal("not_checked"), Type.Null()]),
  latest_backup_outcome: Type.Union([Type.Literal("SUCCESS"), Type.Literal("FAILED"), Type.Null()]),
  latest_backup_schema_version: NullableString,
  latest_backup_encrypted: Type.Boolean(),
  latest_backup_key_id: NullableString,
  backup_encryption_configured: Type.Boolean(),
  backup_age_seconds: NullableNumber,
  next_scheduled_backup_at: NullableString,
  backup_count: Type.Integer({ minimum: 0 }),
  retention_limit: Type.Integer({ minimum: 1 }),
  backup_directory_display: Type.String(),
  backup_directory_available: Type.Boolean(),
  free_space_bytes: NullableNumber,
  minimum_required_space_bytes: Type.Integer({ minimum: 0 }),
  low_space: Type.Boolean(),
  backup_in_progress: Type.Boolean(),
  restore_in_progress: Type.Boolean(),
  generated_at_utc: Type.String(),
  latest_backup_timestamp: NullableString,
  free_disk_space_bytes: NullableNumber,
  database_basename: Type.String(),
  sqlite_journal_mode: Type.String(),
  destructive_operations_enabled: Type.Boolean(),
  authentication_available: Type.Literal(true),
  restore_support_mode: Type.Literal("single_process_only"),
  restore_requires_admin: Type.Literal(true),
  restore_requires_reauthentication: Type.Literal(true),
  restore_multi_worker_safe: Type.Literal(false),
});
export type BackupStatus = Static<typeof BackupStatusSchema>;

export const BackupEntrySchema = Type.Object({
  filename: Type.String({ pattern: "^backup_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z(?:_\\d+)?\\.sqlite3$" }),
  created_at: Type.String(),
  trigger: Type.String(),
  size: Type.Number({ minimum: 1 }),
  checksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  schema_version: Type.String({ minLength: 1 }),
  encrypted: Type.Boolean(),
  format_version: NullableNumber,
  algorithm: NullableString,
  key_id: NullableString,
  age_seconds: Type.Optional(Type.Number({ minimum: 0 })),
  checksum_status: Type.Optional(Type.String()),
  integrity_status: Type.Optional(Type.String()),
  verification_state: Type.Optional(Type.String()),
  restore_eligible: Type.Optional(Type.Boolean()),
  incompatibility_reasons: Type.Optional(Type.Array(Type.String())),
});
export type BackupEntry = Static<typeof BackupEntrySchema>;

export const CreatedBackupSchema = Type.Intersect([
  BackupEntrySchema,
  Type.Object({ sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }) }),
]);
export type CreatedBackup = Static<typeof CreatedBackupSchema>;

export const RestorePreflightSchema = Type.Object({
  source: Type.Object({
    filename: Type.String(),
    backup_type: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String()),
    age_seconds: Type.Optional(Type.Number({ minimum: 0 })),
    size_bytes: Type.Optional(Type.Number({ minimum: 0 })),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    checksum_matches_manifest: Type.Boolean(),
    encrypted: Type.Boolean(),
    format_version: NullableNumber,
    algorithm: NullableString,
    key_id: NullableString,
    integrity_check: Type.String(),
    quick_check: Type.String(),
    foreign_key_violation_count: NullableNumber,
    schema_version: NullableString,
    identity_compatible: Type.Boolean(),
    application_compatible: Type.Boolean(),
    restore_eligible: Type.Boolean(),
    blocking_reasons: Type.Array(Type.String()),
    warning_reasons: Type.Array(Type.String()),
  }),
  active: Type.Object({
    active_sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    active_schema_version: NullableString,
    active_students: NullableNumber,
    active_attendance: NullableNumber,
    active_enrollments: NullableNumber,
    source_students: NullableNumber,
    source_attendance: NullableNumber,
    source_enrollments: NullableNumber,
    student_delta: NullableNumber,
    attendance_delta: NullableNumber,
    enrollment_delta: NullableNumber,
    same_database_content: Type.Boolean(),
    source_is_older: Type.Union([Type.Boolean(), Type.Null()]),
    possible_data_loss: Type.Union([Type.Boolean(), Type.Null()]),
    sessions_will_be_revoked: Type.Boolean(),
    restart_required: Type.Boolean(),
    pre_restore_backup_will_be_created: Type.Boolean(),
  }),
  impact_classification: Type.Union([Type.Literal("NO_CHANGE"), Type.Literal("SCHEMA_INCOMPATIBLE"), Type.Literal("LOW_IMPACT")]),
});
export type RestorePreflight = Static<typeof RestorePreflightSchema>;

// The handler intentionally accepts partial bodies so it can write the denied-attempt audit before returning field errors.
export const RestoreRequestSchema = Type.Object({
  current_password: Type.Optional(Type.String()),
  candidate_admin_username: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  candidate_admin_password: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  confirmation_filename: Type.Optional(Type.String()),
  confirmation_phrase: Type.Optional(Type.String()),
  acknowledge_complete_replacement: Type.Optional(Type.Boolean()),
  acknowledge_session_revocation: Type.Optional(Type.Boolean()),
  acknowledge_restart_required: Type.Optional(Type.Boolean()),
  acknowledge_safety_backup: Type.Optional(Type.Boolean()),
  expected_source_sha256: Type.Optional(Type.String()),
  expected_active_sha256: Type.Optional(Type.String()),
});
export type RestoreRequest = Static<typeof RestoreRequestSchema>;
export type RestoreSubmission = Required<Pick<RestoreRequest,
  | "current_password" | "confirmation_filename" | "confirmation_phrase"
  | "acknowledge_complete_replacement" | "acknowledge_session_revocation"
  | "acknowledge_restart_required" | "acknowledge_safety_backup"
  | "expected_source_sha256" | "expected_active_sha256"
>> & Pick<RestoreRequest, "candidate_admin_username" | "candidate_admin_password">;

export const RestoreResultSchema = Type.Object({
  operation_id: Type.String({ minLength: 1 }),
  status: Type.Literal("COMPLETED"),
  restored_backup_filename: Type.String({ minLength: 1 }),
  completed_at: Type.String(),
  safety_backup_filename: Type.String({ minLength: 1 }),
  post_restore_integrity: Type.Literal("ok"),
  post_restore_quick_check: Type.Literal("ok"),
  post_restore_foreign_key_violations: Type.Literal(0),
  post_restore_students: NullableNumber,
  post_restore_attendance: NullableNumber,
  post_restore_enrollments: NullableNumber,
  sessions_revoked: Type.Literal(true),
  restart_required: Type.Literal(true),
  rollback_attempted: Type.Literal(false),
  safe_message: Type.String(),
});
export type RestoreResult = Static<typeof RestoreResultSchema>;

export const RecoveryHistoryEntrySchema = Type.Object({
  timestamp: NullableString,
  filename: NullableString,
  event: NullableString,
  actor_display: Type.String(),
  result: NullableString,
  safe_reason_code: NullableString,
  operation_reference_id: NullableString,
  safety_backup_filename: NullableString,
});
export type RecoveryHistoryEntry = Static<typeof RecoveryHistoryEntrySchema>;

export const RecoveryHistoryPageSchema = Type.Object({
  entries: Type.Array(RecoveryHistoryEntrySchema),
  next_cursor: NullableString,
});
export type RecoveryHistoryPage = Static<typeof RecoveryHistoryPageSchema>;

export const BackupSchedulerConfigSchema = Type.Object({
  enabled: Type.Boolean(),
  schedule_type: Type.Union([Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("interval")]),
  interval_minutes: Type.Integer({ minimum: 1, maximum: 525600 }),
  hour_utc: Type.Integer({ minimum: 0, maximum: 23 }),
  minute_utc: Type.Integer({ minimum: 0, maximum: 59 }),
  weekday_utc: Type.Integer({ minimum: 0, maximum: 6 }),
  keep_daily: Type.Integer({ minimum: 0, maximum: 365 }),
  keep_weekly: Type.Integer({ minimum: 0, maximum: 260 }),
  keep_monthly: Type.Integer({ minimum: 0, maximum: 120 }),
  next_run_at: NullableString,
  updated_at: Type.String(),
});
export type BackupSchedulerConfig = Static<typeof BackupSchedulerConfigSchema>;

export const BackupSchedulerUpdateSchema = Type.Object({
  enabled: Type.Boolean(),
  schedule_type: BackupSchedulerConfigSchema.properties.schedule_type,
  interval_minutes: BackupSchedulerConfigSchema.properties.interval_minutes,
  hour_utc: BackupSchedulerConfigSchema.properties.hour_utc,
  minute_utc: BackupSchedulerConfigSchema.properties.minute_utc,
  weekday_utc: BackupSchedulerConfigSchema.properties.weekday_utc,
  keep_daily: BackupSchedulerConfigSchema.properties.keep_daily,
  keep_weekly: BackupSchedulerConfigSchema.properties.keep_weekly,
  keep_monthly: BackupSchedulerConfigSchema.properties.keep_monthly,
});
export type BackupSchedulerUpdate = Static<typeof BackupSchedulerUpdateSchema>;

export const BackupExecutionHistoryEntrySchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  backup_filename: NullableString,
  started_at: Type.String(),
  completed_at: NullableString,
  duration_seconds: NullableNumber,
  status: Type.Union([Type.Literal("SUCCESS"), Type.Literal("FAILED")]),
  error_message: NullableString,
  trigger_type: Type.String(),
  size_bytes: NullableNumber,
  checksum: NullableString,
  integrity_verified: Type.Union([Type.Boolean(), Type.Null()]),
  removed_backups: Type.Array(Type.String()),
});
export type BackupExecutionHistoryEntry = Static<typeof BackupExecutionHistoryEntrySchema>;

export const DeleteBackupResultSchema = Type.Object({ status: Type.Literal("success") });
export type DeleteBackupResult = Static<typeof DeleteBackupResultSchema>;
