import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  BackupEntrySchema,
  BackupSchedulerUpdateSchema,
  BackupStatusSchema,
  RestorePreflightSchema,
  RestoreRequestSchema,
  RestoreResultSchema,
} from "@operatoros/contracts/backup";

describe("backup boundary contracts", () => {
  it("keeps current checksum verification distinct from unchecked SQLite integrity", () => {
    const status = {
      health_state: "HEALTHY",
      last_successful_backup_at: null,
      last_failed_backup_at: null,
      last_failure_code: null,
      last_failure_message: null,
      latest_backup_filename: null,
      latest_backup_type: null,
      latest_backup_size_bytes: null,
      latest_backup_checksum_status: "verified",
      latest_backup_integrity_status: "not_checked",
      latest_backup_outcome: null,
      latest_backup_schema_version: null,
      latest_backup_encrypted: true,
      latest_backup_key_id: "synthetic-key",
      backup_encryption_configured: true,
      backup_age_seconds: null,
      next_scheduled_backup_at: null,
      backup_count: 0,
      retention_limit: 10,
      backup_directory_display: "backups",
      backup_directory_available: true,
      free_space_bytes: 1024,
      minimum_required_space_bytes: 512,
      low_space: false,
      backup_in_progress: false,
      restore_in_progress: false,
      generated_at_utc: "2026-10-22T00:00:00Z",
      latest_backup_timestamp: null,
      free_disk_space_bytes: 1024,
      database_basename: "synthetic.sqlite",
      sqlite_journal_mode: "wal",
      destructive_operations_enabled: true,
      authentication_available: true,
      restore_support_mode: "single_process_only",
      restore_requires_admin: true,
      restore_requires_reauthentication: true,
      restore_multi_worker_safe: false,
    };
    expect(Value.Check(BackupStatusSchema, status)).toBe(true);
    expect(Value.Check(BackupStatusSchema, { ...status, latest_backup_integrity_status: "ok" })).toBe(false);
  });

  it("requires checksummed artifacts, boolean scheduler state, and actual restore results", () => {
    const entry = {
      filename: "backup_2026-10-22T00-00-00Z.sqlite3",
      created_at: "2026-10-22T00:00:00Z",
      trigger: "manual",
      size: 10,
      checksum: "a".repeat(64),
      schema_version: "20261002_s48",
      encrypted: true,
      format_version: 1,
      algorithm: "aes-256-gcm",
      key_id: "synthetic-key",
    };
    expect(Value.Check(BackupEntrySchema, entry)).toBe(true);
    expect(Value.Check(BackupEntrySchema, { ...entry, checksum: "short" })).toBe(false);
    expect(Value.Check(BackupSchedulerUpdateSchema, {
      enabled: true, schedule_type: "daily", interval_minutes: 1440,
      hour_utc: 1, minute_utc: 0, weekday_utc: 0,
      keep_daily: 7, keep_weekly: 4, keep_monthly: 12,
    })).toBe(true);
    expect(Value.Check(BackupSchedulerUpdateSchema, {
      enabled: 1, schedule_type: "daily", interval_minutes: 1440,
      hour_utc: 1, minute_utc: 0, weekday_utc: 0,
      keep_daily: 7, keep_weekly: 4, keep_monthly: 12,
    })).toBe(false);
    expect(Value.Check(RestoreResultSchema, {
      operation_id: "synthetic-operation",
      status: "COMPLETED",
      restored_backup_filename: entry.filename,
      completed_at: "2026-10-22T00:00:00Z",
      safety_backup_filename: entry.filename,
      post_restore_integrity: "ok",
      post_restore_quick_check: "ok",
      post_restore_foreign_key_violations: 0,
      post_restore_students: 1,
      post_restore_attendance: 1,
      post_restore_enrollments: 1,
      sessions_revoked: true,
      restart_required: true,
      rollback_attempted: false,
      safe_message: "Restore completed.",
    })).toBe(true);
    expect(Value.Check(RestoreResultSchema, { status: "FAILED" })).toBe(false);
  });

  it("keeps partial restore submissions schema-valid for the handler's audited field errors", () => {
    expect(Value.Check(RestoreRequestSchema, {})).toBe(true);
  });

  it("models nullable impact evidence and preserves the not-verified state", () => {
    expect(Value.Check(RestorePreflightSchema, {
      source: {
        filename: "backup_2026-10-22T00-00-00Z.sqlite3",
        sha256: "a".repeat(64),
        checksum_matches_manifest: true,
        encrypted: true,
        format_version: 1,
        algorithm: "aes-256-gcm",
        key_id: "synthetic-key",
        integrity_check: "ok",
        quick_check: "ok",
        foreign_key_violation_count: 0,
        schema_version: "20261002_s48",
        identity_compatible: true,
        application_compatible: true,
        restore_eligible: true,
        blocking_reasons: [],
        warning_reasons: [],
      },
      active: {
        active_sha256: "b".repeat(64),
        active_schema_version: "20261002_s48",
        active_students: 1,
        active_attendance: 1,
        active_enrollments: 1,
        source_students: 1,
        source_attendance: 1,
        source_enrollments: 1,
        student_delta: 0,
        attendance_delta: 0,
        enrollment_delta: 0,
        same_database_content: false,
        source_is_older: null,
        possible_data_loss: null,
        sessions_will_be_revoked: true,
        restart_required: true,
        pre_restore_backup_will_be_created: true,
      },
      impact_classification: "LOW_IMPACT",
    })).toBe(true);
  });
});
