import { apiRequest } from "../lib/api/client";

export interface BackupStatus {
  latest_backup_timestamp: string | null;
  latest_backup_outcome: string | null;
  backup_count: number;
  retention_limit: number;
  free_disk_space_bytes: number;
  database_basename: string;
  sqlite_journal_mode: string;
  destructive_operations_enabled: boolean;
  authentication_available: boolean;
  restore_support_mode: string;
  restore_requires_admin: boolean;
  restore_requires_reauthentication: boolean;
  restore_multi_worker_safe: boolean;
}

export interface BackupEntry {
  filename: string; created_at: string; trigger: string; size: number;
  checksum: string; schema_version: string;
}

export interface RestoreResult {
  success: boolean; restored_filename: string; pre_restore_snapshot_filename: string;
  checksum_verified: boolean; schema_verified: boolean; integrity_verified: boolean;
  required_tables_verified: boolean; completed_at: string;
  status: "restored"; reauthentication_required: boolean; message: string;
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
export const getBackupScheduler = async () => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler") })).data;
export const updateBackupScheduler = async (body: Omit<BackupSchedulerConfig, "next_run_at" | "updated_at">) => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler"), method: "PUT", body })).data;
export const listBackupHistory = async () => (await apiRequest<BackupExecutionHistory[]>({ path: backupApiPath("/history") })).data;
export const restoreBackup = async (filename: string, confirmation: string) => (
  await apiRequest<RestoreResult>({
    path: backupApiPath(`/${encodeURIComponent(filename)}/restore`), method: "POST", body: { confirmation },
  })
).data;
export const deleteBackup = async (filename: string) => (await apiRequest<{status: string}>({ path: backupApiPath(`/${encodeURIComponent(filename)}`), method: "DELETE" })).data;
export const downloadBackupUrl = (filename: string) => backupApiPath(`/${encodeURIComponent(filename)}/download`);
