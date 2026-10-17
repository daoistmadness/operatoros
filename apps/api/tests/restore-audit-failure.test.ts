import { describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error(`session cookie missing (status ${response.status})`);
  return `astyx_session=${value}`;
}

function restoreRequest(app: ReturnType<typeof createApp>, filename: string, cookie: string, checked: any): Promise<Response> {
  return app.handle(new Request(`http://local/api/admin/backups/${filename}/restore`, {
    method: "POST",
    headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({
      current_password: "golden-admin-pass-1",
      confirmation_filename: filename,
      confirmation_phrase: "RESTORE_DATABASE",
      acknowledge_complete_replacement: true,
      acknowledge_session_revocation: true,
      acknowledge_restart_required: true,
      acknowledge_safety_backup: true,
      expected_source_sha256: checked.source.sha256,
      expected_active_sha256: checked.active.active_sha256,
    }),
  }));
}

/** Row marker: proves whether the pre-restore database (marker present) or the restored backup (marker absent) is active, without changing the physical schema. */
function markerCount(database: ReturnType<typeof openDatabase>): number {
  return Number((database.client.query("SELECT COUNT(*) AS count FROM users WHERE username = 'after-backup-marker'").get() as any).count);
}

describe("restore completion-recording failure window", () => {
  it("rolls the restore back and keeps the service usable when the recovery-history record cannot be written", async () => {
    const path = `/dev/shm/operatoros-loop24-regression-${process.pid}-${Date.now()}.db`;
    const backupDir = `/dev/shm/operatoros-loop24-regression-backups-${process.pid}-${Date.now()}`;
    createAccountFixture(path, "golden-active"); mkdirSync(backupDir, { recursive: true });
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret }), auth: { authCookieSecret: secret, auditDir: backupDir } });
    try {
      const cookie = await login(app, "golden-admin", "golden-admin-pass-1");
      const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(created.status).toBe(200);
      const backup = await created.json() as any;
      database.client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES ('after-backup-marker', 'synthetic-marker-hash', 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)");

      const recoveryPath = `${backupDir}/backup_restore_audit.jsonl`;
      mkdirSync(recoveryPath, { recursive: true });

      const preflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(preflight.status).toBe(200);
      const checked = await preflight.json() as any;

      const restore = await restoreRequest(app, backup.filename, cookie, checked);
      expect(restore.status).toBe(500);
      expect((await restore.json() as any).detail.code).toBe("RESTORE_ROLLED_BACK");

      // The prior active database must be back at its path, still serving, with the pre-restore row set.
      expect(existsSync(path)).toBe(true);
      expect(markerCount(database)).toBe(1);
      expect(database.client.query("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 3 });
      await login(app, "golden-admin", "golden-admin-pass-1");

      // The blocked recovery path stays untouched, and the operations audit records the failure truthfully.
      expect(lstatSync(recoveryPath).isDirectory()).toBe(true);
      const operations = readFileSync(`${backupDir}/backup_operations_audit.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(operations.filter((entry) => entry.event === "restore_failed")).toHaveLength(1);
    } finally { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  }, 30000);

  it("keeps the active database when the operations audit file is unwritable before the swap", async () => {
    const path = `/dev/shm/operatoros-loop24-regression-${process.pid}-${Date.now()}.db`;
    const backupDir = `/dev/shm/operatoros-loop24-regression-backups-${process.pid}-${Date.now()}`;
    createAccountFixture(path, "golden-active"); mkdirSync(backupDir, { recursive: true });
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret }), auth: { authCookieSecret: secret, auditDir: backupDir } });
    try {
      const cookie = await login(app, "golden-admin", "golden-admin-pass-1");
      const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(created.status).toBe(200);
      const backup = await created.json() as any;
      database.client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES ('after-backup-marker', 'synthetic-marker-hash', 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)");

      rmSync(`${backupDir}/backup_operations_audit.jsonl`, { recursive: true, force: true });
      mkdirSync(`${backupDir}/backup_operations_audit.jsonl`, { recursive: true });

      const preflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
      expect(preflight.status).toBe(200);
      const checked = await preflight.json() as any;

      const restore = await restoreRequest(app, backup.filename, cookie, checked);
      expect([400, 500]).toContain(restore.status);

      expect(existsSync(path)).toBe(true);
      expect(markerCount(database)).toBe(1);
      await login(app, "golden-admin", "golden-admin-pass-1");
      expect(existsSync(`${backupDir}/backup_restore_audit.jsonl`)).toBe(false);
    } finally { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  }, 30000);
});
