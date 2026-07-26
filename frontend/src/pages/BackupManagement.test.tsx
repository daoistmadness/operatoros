import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  BackupList,
  BackupStatusPanel,
  RecoveryHistoryPanel,
  RESTORE_STEPS,
  RESTORE_WARNING,
  allAcknowledged,
  canExecuteRestore,
  formatAge,
  formatBytes,
} from "./BackupManagement";
import type { BackupEntry, BackupStatus } from "../api/backups";
import { createTestQueryClient } from "../lib/query/queryClient";

vi.mock("../api/backups", () => ({
  createBackup: vi.fn(),
  getBackupStatus: vi.fn(() => new Promise(() => {})),
  listBackups: vi.fn(() => new Promise(() => {})),
  getBackupScheduler: vi.fn(() => new Promise(() => {})),
  listBackupHistory: vi.fn(() => new Promise(() => {})),
  listRecoveryHistory: vi.fn(() => new Promise(() => {})),
  updateBackupScheduler: vi.fn(),
  preflightRestore: vi.fn(),
  restoreBackup: vi.fn(),
  deleteBackup: vi.fn(),
  downloadBackupUrl: vi.fn((value) => `/api/admin/backups/${value}/download`),
}));

const status: BackupStatus = {
  health_state: "HEALTHY",
  last_successful_backup_at: "2026-07-13T00:00:00Z",
  last_failed_backup_at: null,
  last_failure_code: null,
  last_failure_message: null,
  latest_backup_filename: "backup.sqlite3",
  latest_backup_type: "manual",
  latest_backup_size_bytes: 2048,
  latest_backup_checksum_status: "verified",
  latest_backup_integrity_status: "ok",
  latest_backup_schema_version: "s42",
  backup_age_seconds: 3600,
  next_scheduled_backup_at: null,
  backup_count: 1,
  retention_limit: 10,
  backup_directory_display: "backups",
  backup_directory_available: true,
  free_space_bytes: 1048576,
  minimum_required_space_bytes: 2048,
  low_space: false,
  backup_in_progress: false,
  restore_in_progress: false,
  destructive_operations_enabled: true,
};
const backup: BackupEntry = {
  filename: "backup_2026-07-13T00-00-00Z.sqlite3",
  created_at: "2026-07-13T00:00:00Z",
  trigger: "manual",
  size: 2048,
  checksum: "abcdef1234567890",
  schema_version: "s42",
  age_seconds: 3600,
  checksum_status: "verified",
  integrity_status: "ok",
  verification_state: "verified",
  restore_eligible: true,
  incompatibility_reasons: [],
};
const html = (node: React.ReactNode) => renderToStaticMarkup(
  <QueryClientProvider client={createTestQueryClient()}>
    <MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>,
);

describe("guided backup and recovery", () => {
  it.each([
    ["HEALTHY", "Healthy"],
    ["AGING", "Backup aging"],
    ["STALE", "Backup overdue"],
    ["NO_BACKUP", "No verified backup"],
    ["LAST_BACKUP_FAILED", "Last backup failed"],
    ["DESTINATION_UNAVAILABLE", "Backup destination unavailable"],
    ["LOW_DISK_SPACE", "Low disk space"],
    ["BACKUP_IN_PROGRESS", "Backup in progress"],
    ["RESTORE_IN_PROGRESS", "Restore in progress"],
    ["UNKNOWN", "Status unavailable"],
  ] as const)("uses backend health state %s directly", (health, label) => {
    expect(html(<BackupStatusPanel status={{ ...status, health_state: health }} />)).toContain(label);
  });
  it("renders health with text rather than color alone", () => {
    const output = html(<BackupStatusPanel status={status} />);
    expect(output).toContain("Healthy");
    expect(output).toContain("Checksum");
    expect(output).toContain("verified");
  });
  it("renders safe backup metadata and safety labels", () => {
    const output = html(<BackupList backups={[{ ...backup, trigger: "pre_restore_auto" }]} onRestore={vi.fn()} onDelete={vi.fn()} />);
    expect(output).toContain(backup.filename);
    expect(output).toContain("Automatic safety backup");
    expect(output).toContain("Checksum verified");
    expect(output).toContain("Integrity ok");
    expect(output).toContain("Restore eligible after preflight");
  });
  it("keeps CSV out of the recovery warning", () => {
    expect(RESTORE_WARNING).toContain("CSV exports are data exchange files");
    expect(RESTORE_WARNING).toContain("cannot restore");
  });
  it("declares the exact seven-step order", () => {
    expect(RESTORE_STEPS).toEqual([
      "Select Backup", "Verify Backup", "Compare Impact",
      "Safety Acknowledgements", "Re-authenticate & Confirm", "Execute", "Result",
    ]);
  });
  it("requires all four acknowledgements", () => {
    expect(allAcknowledged({ replace: false, sessions: false, restart: false, safety: false })).toBe(false);
    expect(allAcknowledged({ replace: true, sessions: true, restart: true, safety: true })).toBe(true);
  });
  it("requires password, filename, phrase, eligibility, and idle state", () => {
    const common = {
      filename: backup.filename,
      confirmationFilename: backup.filename,
      confirmationPhrase: "RESTORE_DATABASE",
      password: "current-password",
      acknowledgements: { replace: true, sessions: true, restart: true, safety: true },
      eligible: true,
      busy: false,
    };
    expect(canExecuteRestore(common)).toBe(true);
    expect(canExecuteRestore({ ...common, password: "" })).toBe(false);
    expect(canExecuteRestore({ ...common, confirmationFilename: "wrong" })).toBe(false);
    expect(canExecuteRestore({ ...common, confirmationPhrase: "RESTORE" })).toBe(false);
    expect(canExecuteRestore({ ...common, busy: true })).toBe(false);
  });
  it("renders sanitized newest-first recovery history", () => {
    const output = html(<RecoveryHistoryPanel rows={[
      { timestamp: "2026-07-25T00:00:00Z", filename: backup.filename, event: "RESTORE_COMPLETED", actor_display: "admin", result: "COMPLETED", safe_reason_code: null, operation_reference_id: "op-old", safety_backup_filename: null },
      { timestamp: "2026-07-26T00:00:00Z", filename: backup.filename, event: "RESTORE_FAILED", actor_display: "admin", result: "FAILED", safe_reason_code: "CHECKSUM", operation_reference_id: "op-new", safety_backup_filename: backup.filename },
    ]} />);
    expect(output.indexOf("op-new")).toBeLessThan(output.indexOf("op-old"));
    expect(output).not.toContain("/home/");
    expect(output).not.toContain("password");
  });
  it("formats sizes and ages without health threshold calculation", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatAge(3600)).toBe("1 hours");
  });
});
