import { apiRequest } from "../lib/api/client";

export type BackupHealthState =
  | "HEALTHY" | "AGING" | "STALE" | "NO_BACKUP" | "LAST_BACKUP_FAILED"
  | "DESTINATION_UNAVAILABLE" | "LOW_DISK_SPACE" | "BACKUP_IN_PROGRESS"
  | "RESTORE_IN_PROGRESS" | "UNKNOWN";

export interface BackupStatus {
  health_state: BackupHealthState;
  last_successful_backup_at: string | null;
  last_failed_backup_at: string | null;
  last_failure_code: string | null;
  last_failure_message: string | null;
  latest_backup_filename: string | null;
  latest_backup_type: string | null;
  latest_backup_size_bytes: number | null;
  latest_backup_checksum_status: string | null;
  latest_backup_integrity_status: string | null;
  latest_backup_schema_version: string | null;
  backup_age_seconds: number | null;
  next_scheduled_backup_at: string | null;
  backup_count: number;
  retention_limit: number;
  backup_directory_display: string;
  backup_directory_available: boolean;
  free_space_bytes: number | null;
  minimum_required_space_bytes: number | null;
  low_space: boolean | null;
  backup_in_progress: boolean;
  restore_in_progress: boolean;
  destructive_operations_enabled: boolean;
}

export interface BackupEntry {
  filename: string;
  created_at: string;
  trigger: string;
  size: number;
  checksum: string;
  schema_version: string;
  age_seconds?: number;
  checksum_status?: string;
  integrity_status?: string;
  verification_state?: string;
  restore_eligible?: boolean;
  incompatibility_reasons?: string[];
}

export interface RestorePreflight {
  source: {
    filename: string;
    backup_type: string;
    created_at: string;
    age_seconds: number;
    size_bytes: number;
    sha256: string;
    checksum_matches_manifest: boolean;
    integrity_check: string;
    quick_check: string;
    foreign_key_violation_count: number | null;
    schema_version: string | null;
    identity_compatible: boolean;
    application_compatible: boolean;
    restore_eligible: boolean;
    blocking_reasons: string[];
    warning_reasons: string[];
  };
  active: {
    active_sha256: string;
    active_schema_version: string | null;
    active_students: number;
    active_attendance: number;
    active_enrollments: number;
    source_students: number;
    source_attendance: number;
    source_enrollments: number;
    student_delta: number;
    attendance_delta: number;
    enrollment_delta: number;
    same_database_content: boolean;
    source_is_older: boolean;
    possible_data_loss: boolean;
    sessions_will_be_revoked: boolean;
    restart_required: boolean;
    pre_restore_backup_will_be_created: boolean;
  };
  impact_classification: string;
}

export interface RestoreRequest {
  current_password: string;
  confirmation_filename: string;
  confirmation_phrase: string;
  acknowledge_complete_replacement: boolean;
  acknowledge_session_revocation: boolean;
  acknowledge_restart_required: boolean;
  acknowledge_safety_backup: boolean;
  expected_source_sha256: string;
  expected_active_sha256: string;
}

export interface RestoreResult {
  operation_id: string;
  status: "COMPLETED" | "ROLLED_BACK" | "FAILED";
  restored_backup_filename?: string;
  requested_backup_filename?: string;
  completed_at?: string;
  safety_backup_filename?: string;
  post_restore_integrity?: string;
  post_restore_quick_check?: string;
  post_restore_foreign_key_violations?: number;
  post_restore_students?: number;
  post_restore_attendance?: number;
  post_restore_enrollments?: number;
  sessions_revoked?: boolean;
  restart_required: boolean;
  rollback_attempted: boolean;
  rollback_succeeded?: boolean | null;
  active_data_restored?: boolean | null;
  high_severity?: boolean;
  safe_reason_code?: string;
  safe_message: string;
  safe_next_action?: string;
  support_reference?: string;
}

export interface RecoveryHistoryEntry {
  timestamp: string | null;
  filename: string | null;
  event: string | null;
  actor_display: string;
  result: string | null;
  safe_reason_code: string | null;
  operation_reference_id: string | null;
  safety_backup_filename: string | null;
}

export interface BackupSchedulerConfig {
  enabled: boolean; schedule_type: "daily" | "weekly" | "interval"; interval_minutes: number;
  hour_utc: number; minute_utc: number; weekday_utc: number; keep_daily: number; keep_weekly: number;
  keep_monthly: number; next_run_at: string | null; updated_at: string;
}

export interface BackupExecutionHistory {
  id: number; backup_filename: string | null; started_at: string; completed_at: string | null;
  duration_seconds: number | null; status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  error_message: string | null; trigger_type: "MANUAL" | "SCHEDULED"; size_bytes: number | null;
  checksum: string | null; integrity_verified: boolean; removed_backups: string[];
}

export const backupApiPath = (suffix = "") => `/api/admin/backups${suffix}`;
export const getBackupStatus = async () => (await apiRequest<BackupStatus>({ path: backupApiPath("/status") })).data;
export const listBackups = async () => (await apiRequest<BackupEntry[]>({ path: backupApiPath() })).data;
export const createBackup = async () => (await apiRequest<BackupEntry & { sha256: string }>({ path: backupApiPath(), method: "POST" })).data;
export const preflightRestore = async (filename: string) => (await apiRequest<RestorePreflight>({ path: backupApiPath(`/${encodeURIComponent(filename)}/restore-preflight`), method: "POST" })).data;
export const restoreBackup = async (filename: string, body: RestoreRequest) => (await apiRequest<RestoreResult>({ path: backupApiPath(`/${encodeURIComponent(filename)}/restore`), method: "POST", body })).data;
export const listRecoveryHistory = async () => (await apiRequest<RecoveryHistoryEntry[]>({ path: backupApiPath("/recovery-history") })).data;
export const getBackupScheduler = async () => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler") })).data;
export const updateBackupScheduler = async (body: Omit<BackupSchedulerConfig, "next_run_at" | "updated_at">) => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler"), method: "PUT", body })).data;
export const listBackupHistory = async () => (await apiRequest<BackupExecutionHistory[]>({ path: backupApiPath("/history") })).data;
export const deleteBackup = async (filename: string) => (await apiRequest<{status: string}>({ path: backupApiPath(`/${encodeURIComponent(filename)}`), method: "DELETE" })).data;
export const downloadBackupUrl = (filename: string) => backupApiPath(`/${encodeURIComponent(filename)}/download`);
