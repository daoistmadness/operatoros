import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import {
  backupApiPath,
  createBackup,
  getBackupScheduler,
  getBackupStatus,
  listBackupHistory,
  listBackups,
  listRecoveryHistory,
  preflightRestore,
  restoreBackup,
  updateBackupScheduler,
  type RestoreRequest,
} from "./backups";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

const filename = "backup_2026-07-13T00-00-00Z.sqlite3";
const restoreBody: RestoreRequest = {
  current_password: "not-persisted",
  confirmation_filename: filename,
  confirmation_phrase: "RESTORE_DATABASE",
  acknowledge_complete_replacement: true,
  acknowledge_session_revocation: true,
  acknowledge_restart_required: true,
  acknowledge_safety_backup: true,
  expected_source_sha256: "a".repeat(64),
  expected_active_sha256: "b".repeat(64),
};

describe("backup API", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses the canonical status endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await getBackupStatus();
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/admin/backups/status" });
  });
  it("uses the canonical list and create endpoints", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [], status: 200, headers: {} });
    await listBackups();
    await createBackup();
    expect(apiRequest).toHaveBeenNthCalledWith(1, { path: "/api/admin/backups" });
    expect(apiRequest).toHaveBeenNthCalledWith(2, { path: "/api/admin/backups", method: "POST" });
  });
  it("preflights the selected backend filename", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await preflightRestore(filename);
    expect(apiRequest).toHaveBeenCalledWith({
      path: `/api/admin/backups/${filename}/restore-preflight`,
      method: "POST",
    });
  });
  it("sends every guided restore gate without a client username", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await restoreBackup(filename, restoreBody);
    expect(apiRequest).toHaveBeenCalledWith({
      path: `/api/admin/backups/${filename}/restore`,
      method: "POST",
      body: restoreBody,
    });
    expect(restoreBody).not.toHaveProperty("username");
  });
  it("keeps scheduler and recovery history distinct", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [], status: 200, headers: {} });
    await getBackupScheduler();
    await listBackupHistory();
    await listRecoveryHistory();
    expect(apiRequest).toHaveBeenNthCalledWith(1, { path: "/api/admin/backups/scheduler" });
    expect(apiRequest).toHaveBeenNthCalledWith(2, { path: "/api/admin/backups/history" });
    expect(apiRequest).toHaveBeenNthCalledWith(3, { path: "/api/admin/backups/recovery-history" });
  });
  it("updates scheduler settings", async () => {
    const body = { enabled: true, schedule_type: "interval" as const, interval_minutes: 60, hour_utc: 1, minute_utc: 0, weekday_utc: 0, keep_daily: 7, keep_weekly: 4, keep_monthly: 12 };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {}, status: 200, headers: {} });
    await updateBackupScheduler(body);
    expect(apiRequest).toHaveBeenCalledWith({ path: "/api/admin/backups/scheduler", method: "PUT", body });
  });
  it("never creates a double API prefix", () => {
    expect(backupApiPath("/status")).not.toContain("/api/api/");
  });
});
