import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";
import { backupScheduler } from "../src/domains/safety";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path", "import sqlite3, sys", "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database", "from argon2 import PasswordHasher",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')]); db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("backup, restore, and scheduler safety", () => {
  it("backs up, preflights, restores, revokes sessions, and rejects corruption", async () => {
    const path = `/tmp/operatoros-phase9-safety-${process.pid}-${Date.now()}.db`;
    const backupDir = `/tmp/operatoros-phase9-backups-${process.pid}-${Date.now()}`;
    seed(path); mkdirSync(backupDir, { recursive: true });
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, auth: { authCookieSecret: secret, auditDir: backupDir } });
    try {
      const cookie = await login(app, "golden-admin", "golden-admin-pass-1");
      const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie } }));
      expect(created.status).toBe(200);
      const backup = await created.json() as any;
      expect(backup.filename).toMatch(/^backup_.*\.sqlite3$/);
      expect(backup.sha256).toHaveLength(64);

      const download = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/download`, { headers: { cookie } }));
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain(backup.filename);
      expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);

      database.client.run("CREATE TABLE restore_marker (value TEXT NOT NULL)");
      database.client.run("INSERT INTO restore_marker VALUES ('after-backup')");
      const preflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie } }));
      expect(preflight.status).toBe(200);
      const checked = await preflight.json() as any;
      expect(checked.source.restore_eligible).toBe(true);
      const restore = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ current_password: "golden-admin-pass-1", confirmation_filename: backup.filename, confirmation_phrase: "RESTORE_DATABASE", acknowledge_complete_replacement: true, acknowledge_session_revocation: true, acknowledge_restart_required: true, acknowledge_safety_backup: true, expected_source_sha256: checked.source.sha256, expected_active_sha256: checked.active.active_sha256 }) }));
      expect(restore.status).toBe(200);
      expect((await restore.json() as any).sessions_revoked).toBe(true);
      expect(database.client.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'restore_marker'").get()).toBeNull();
      const postRestoreCookie = await login(app, "golden-admin", "golden-admin-pass-1");

      const corrupt = `${backupDir}/${backup.filename}`;
      const bytes = readFileSync(corrupt); bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1; writeFileSync(corrupt, bytes);
      const corruptPreflight = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: postRestoreCookie } }));
      expect(corruptPreflight.status).toBe(200);
      expect((await corruptPreflight.json() as any).source.checksum_matches_manifest).toBe(false);
      const deleted = await app.handle(new Request(`http://local/api/admin/backups/${backup.filename}`, { method: "DELETE", headers: { cookie: postRestoreCookie } }));
      expect(deleted.status).toBe(200);
      expect(existsSync(corrupt)).toBe(false);
    } finally { database.close(); rmSync(path, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  }, 30000);

  it("keeps scheduler lifecycle single-instance and clean", () => {
    const path = `/tmp/operatoros-phase9-scheduler-${process.pid}-${Date.now()}.db`;
    const backupDir = `/tmp/operatoros-phase9-scheduler-backups-${process.pid}-${Date.now()}`;
    seed(path); const database = openDatabase(path); const context = { database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: backupDir } } as any;
    try { backupScheduler.start(context, { backupDir, destructiveOperationsEnabled: false }); backupScheduler.start(context, { backupDir, destructiveOperationsEnabled: false }); expect(backupScheduler.running).toBe(true); backupScheduler.stop(); expect(backupScheduler.running).toBe(false); } finally { backupScheduler.stop(); database.close(); rmSync(path, { force: true }); rmSync(backupDir, { recursive: true, force: true }); }
  });
});
