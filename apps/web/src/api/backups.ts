import { apiRequest } from "../lib/api/client";
import type {
  BackupEntry, BackupExecutionHistoryEntry, BackupSchedulerConfig, BackupSchedulerUpdate,
  DeleteBackupResult,
  BackupStatus, CreatedBackup, RecoveryHistoryPage, RestorePreflight,
  RestoreResult, RestoreSubmission,
} from "@operatoros/contracts/backup";
export type {
  BackupEntry, BackupExecutionHistoryEntry as BackupExecutionHistory, BackupHealthState,
  BackupSchedulerConfig, BackupSchedulerUpdate, BackupStatus, CreatedBackup, DeleteBackupResult, RecoveryHistoryEntry,
  RecoveryHistoryPage, RestorePreflight, RestoreRequest, RestoreResult, RestoreSubmission,
} from "@operatoros/contracts/backup";

export const backupApiPath = (suffix = "") => `/api/admin/backups${suffix}`;
export const getBackupStatus = async () => (await apiRequest<BackupStatus>({ path: backupApiPath("/status") })).data;
export const listBackups = async () => (await apiRequest<BackupEntry[]>({ path: backupApiPath() })).data;
export const createBackup = async () => (await apiRequest<CreatedBackup>({ path: backupApiPath(), method: "POST" })).data;
export const preflightRestore = async (filename: string) => (await apiRequest<RestorePreflight>({ path: backupApiPath(`/${encodeURIComponent(filename)}/restore-preflight`), method: "POST" })).data;
export const restoreBackup = async (filename: string, body: RestoreSubmission) => (await apiRequest<RestoreResult>({ path: backupApiPath(`/${encodeURIComponent(filename)}/restore`), method: "POST", body })).data;
export const listRecoveryHistory = async (cursor?: string) => (await apiRequest<RecoveryHistoryPage>({ path: backupApiPath("/recovery-history"), params: { cursor } })).data;
export const getBackupScheduler = async () => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler") })).data;
export const updateBackupScheduler = async (body: BackupSchedulerUpdate) => (await apiRequest<BackupSchedulerConfig>({ path: backupApiPath("/scheduler"), method: "PUT", body })).data;
export const listBackupHistory = async () => (await apiRequest<BackupExecutionHistoryEntry[]>({ path: backupApiPath("/history") })).data;
export const deleteBackup = async (filename: string) => (await apiRequest<DeleteBackupResult>({ path: backupApiPath(`/${encodeURIComponent(filename)}`), method: "DELETE" })).data;
export const downloadBackupUrl = (filename: string, bundle = false) => `${backupApiPath(`/${encodeURIComponent(filename)}/download`)}${bundle ? "?bundle=true" : ""}`;
