import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");

let activePath = "";
let injection: "none" | "active-to-rollback" | "candidate-to-active" | "rollback-to-active" = "none";

// Inject a deterministic failure at one restore transition without testing mocks.
const restoreFiles: RestoreFileSystem = {
  rename: (from, to) => {
    if (injection === "active-to-rollback" && from === activePath && to.endsWith(".rollback")) throw new Error("INJECTED_ACTIVE_TO_ROLLBACK");
    if (injection === "candidate-to-active" && from.endsWith(".candidate") && to === activePath) throw new Error("INJECTED_CANDIDATE_TO_ACTIVE");
    if (injection === "rollback-to-active" && from.endsWith(".rollback") && to === activePath) throw new Error("INJECTED_ROLLBACK_TO_ACTIVE");
    return fs.renameSync(from, to);
  },
  remove: (path) => fs.rmSync(path, { force: true }),
  exists: (path) => { try { fs.statSync(path); return true; } catch { return false; } },
  syncFile: () => {},
  syncDirectory: () => {},
};

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

async function preflight(app: ReturnType<typeof createApp>, filename: string, cookie: string): Promise<any> {
  const response = await app.handle(new Request(`http://local/api/admin/backups/${filename}/restore-preflight`, { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
  expect(response.status).toBe(200);
  return response.json();
}

function databaseState(path: string): { marker: number; integrity: string } | null {
  if (!fs.existsSync(path)) return null;
  try {
    const handle = openDatabase(path, { readonly: true });
    try {
      return {
        marker: Number((handle.client.query("SELECT COUNT(*) AS count FROM users WHERE username = 'after-backup-marker'").get() as any).count),
        integrity: String((handle.client.query("PRAGMA integrity_check").get() as any).integrity_check),
      };
    } finally { handle.close(); }
  } catch { return null; }
}

function recoveryFiles(path: string): string[] {
  const directory = path.slice(0, path.lastIndexOf("/"));
  const prefix = `${path.slice(path.lastIndexOf("/") + 1)}.`;
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix) && [".rollback", ".rejected", ".candidate"].some((suffix) => name.endsWith(suffix)));
}

async function prepare(tag: string) {
  const path = `/dev/shm/operatoros-loop94-${tag}-${process.pid}-${Date.now()}.db`;
  const backupDir = `/dev/shm/operatoros-loop94-${tag}-backups-${process.pid}-${Date.now()}`;
  activePath = path;
  createAccountFixture(path, "golden-active"); fs.mkdirSync(backupDir, { recursive: true });
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, destructiveOperationsEnabled: true, backupDir, backupEncryption: parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret }), restoreFileSystem: restoreFiles, auth: { authCookieSecret: secret, auditDir: backupDir } });
  const cookie = await login(app, "golden-admin", "golden-admin-pass-1");
  const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
  expect(created.status).toBe(200);
  const backup = await created.json() as any;
  database.client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES ('after-backup-marker', 'synthetic-marker-hash', 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)");
  return { path, backupDir, database, app, cookie, backup, checked: await preflight(app, backup.filename, cookie) };
}

function cleanup(value: Awaited<ReturnType<typeof prepare>>) {
  injection = "none";
  try { value.database.close(); } catch { /* already closed */ }
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${value.path}${suffix}`, { force: true });
  for (const name of recoveryFiles(value.path)) fs.rmSync(join(value.path.slice(0, value.path.lastIndexOf("/")), name), { force: true });
  fs.rmSync(value.backupDir, { recursive: true, force: true });
}

describe("restore filesystem-transition failures", () => {
  it("refuses pending rollback copies before preflight or replacement and allows retry after recovery is resolved", async () => {
    const value = await prepare("pending-rollback");
    const rollback = `${value.path}.${randomUUID()}.rollback`;
    try {
      fs.writeFileSync(rollback, value.database.client.serialize(), { mode: 0o600 });
      const anonymous = await value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore-preflight`, { method: "POST", headers: { origin: "http://localhost:5173" } }));
      expect(anonymous.status).toBe(401);
      const staffCookie = await login(value.app, "golden-staff", "golden-staff-pass-1");
      const forbidden = await value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: staffCookie, origin: "http://localhost:5173" } }));
      expect(forbidden.status).toBe(403);
      const activeBefore = fs.readFileSync(value.path);
      const rollbackBefore = fs.readFileSync(rollback);
      const backupsBefore = fs.readdirSync(value.backupDir).filter((name) => name.endsWith(".sqlite3"));

      const blockedPreflight = await value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: value.cookie, origin: "http://localhost:5173" } }));
      expect(blockedPreflight.status).toBe(409);
      expect((await blockedPreflight.json() as any).detail).toContain("RESTORE_RECOVERY_PENDING");

      const blockedRestore = await restoreRequest(value.app, value.backup.filename, value.cookie, value.checked);
      expect(blockedRestore.status).toBe(409);
      expect((await blockedRestore.json() as any).detail.code).toBe("RESTORE_RECOVERY_PENDING");
      expect(fs.readFileSync(value.path).equals(activeBefore)).toBe(true);
      expect(fs.readFileSync(rollback).equals(rollbackBefore)).toBe(true);
      expect(fs.readdirSync(value.backupDir).filter((name) => name.endsWith(".sqlite3"))).toEqual(backupsBefore);
      expect(recoveryFiles(value.path)).toEqual([rollback.slice(rollback.lastIndexOf("/") + 1)]);
      const recovery = fs.readFileSync(join(value.backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(recovery.map((entry) => entry.event)).toEqual(["restore_requested", "restore_denied"]);
      expect(recovery[1].reason).toBe("RESTORE_RECOVERY_PENDING");

      fs.rmSync(rollback);
      const retried = await restoreRequest(value.app, value.backup.filename, value.cookie, await preflight(value.app, value.backup.filename, value.cookie));
      expect(retried.status).toBe(200);
      expect(databaseState(value.path)).toEqual({ marker: 0, integrity: "ok" });
      expect(recoveryFiles(value.path)).toEqual([]);
    } finally { cleanup(value); }
  }, 30000);

  it("keeps the original database and allows a retry when the candidate cannot be moved into place", async () => {
    const value = await prepare("candidate-rename");
    try {
      injection = "candidate-to-active";
      const response = await restoreRequest(value.app, value.backup.filename, value.cookie, value.checked);
      expect(response.status).toBe(500);
      expect((await response.json() as any).detail.code).toBe("RESTORE_ROLLED_BACK");

      expect(databaseState(value.path)).toEqual({ marker: 1, integrity: "ok" });
      expect(recoveryFiles(value.path)).toEqual([]);
      const operations = fs.readFileSync(join(value.backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(operations.filter((entry) => entry.event === "restore_failed")).toHaveLength(1);
      expect(operations.find((entry) => entry.event === "restore_failed")?.rollback_outcome).toBe("rolled_back");
      const recovery = fs.readFileSync(join(value.backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(recovery.map((entry) => entry.event)).toEqual(["restore_requested", "restore_started", "restore_rolled_back"]);
      await login(value.app, "golden-admin", "golden-admin-pass-1");

      // Retry after the transient filesystem failure.
      injection = "none";
      const retried = await restoreRequest(value.app, value.backup.filename, value.cookie, await preflight(value.app, value.backup.filename, value.cookie));
      expect(retried.status).toBe(200);
      expect(databaseState(value.path)).toEqual({ marker: 0, integrity: "ok" });
      expect(recoveryFiles(value.path)).toEqual([]);
    } finally { cleanup(value); }
  }, 30000);

  it("keeps the service usable when the original database cannot be moved aside", async () => {
    const value = await prepare("active-rename");
    try {
      injection = "active-to-rollback";
      const response = await restoreRequest(value.app, value.backup.filename, value.cookie, value.checked);
      expect(response.status).toBe(500);
      expect((await response.json() as any).detail.code).toBe("RESTORE_NOT_APPLIED");

      expect(databaseState(value.path)).toEqual({ marker: 1, integrity: "ok" });
      expect(recoveryFiles(value.path)).toEqual([]);
      await login(value.app, "golden-admin", "golden-admin-pass-1");
    } finally { cleanup(value); }
  }, 30000);

  it("preserves the prior database when rollback cannot be moved back into place", async () => {
    const value = await prepare("rollback-failure");
    try {
      // Force the post-swap recovery-history append to fail, which triggers rollback.
      fs.mkdirSync(join(value.backupDir, "backup_restore_audit.jsonl"), { recursive: true });
      injection = "rollback-to-active";

      const response = await restoreRequest(value.app, value.backup.filename, value.cookie, value.checked);
      expect(response.status).toBe(500);
      expect((await response.json() as any).detail.code).toBe("RESTORE_ROLLBACK_FAILED");

      // The active path must remain readable, and the prior database must survive under a recovery copy.
      expect(databaseState(value.path)?.integrity).toBe("ok");
      const preserved = recoveryFiles(value.path);
      expect(preserved.length).toBeGreaterThan(0);
      const states = preserved.map((name) => databaseState(join(value.path.slice(0, value.path.lastIndexOf("/")), name)));
      expect(states).toContainEqual({ marker: 1, integrity: "ok" });
      const retryCookie = await login(value.app, "golden-admin", "golden-admin-pass-1");
      const retryPreflight = await value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: retryCookie, origin: "http://localhost:5173" } }));
      expect(retryPreflight.status).toBe(409);
      expect((await retryPreflight.json() as any).detail).toContain("RESTORE_RECOVERY_PENDING");
      expect(recoveryFiles(value.path)).toEqual(preserved);
    } finally { cleanup(value); }
  }, 30000);

  it("restores a WAL-mode database without leaving stale sidecars", async () => {
    const value = await prepare("wal");
    try {
      const created = await value.app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie: value.cookie, origin: "http://localhost:5173" } }));
      expect(created.status).toBe(200);
      const backup = await created.json() as any;
      value.database.client.run("PRAGMA journal_mode = WAL");
      value.database.client.run("INSERT INTO users (username, password_hash, role, is_active) VALUES ('wal-only-marker', 'synthetic-marker-hash', 'staff', 1)");
      const checked = await preflight(value.app, backup.filename, value.cookie);

      const response = await restoreRequest(value.app, backup.filename, value.cookie, checked);
      expect(response.status).toBe(200);
      expect(fs.existsSync(`${value.path}-wal`)).toBe(false);
      expect(fs.existsSync(`${value.path}-shm`)).toBe(false);
      expect(databaseState(value.path)?.integrity).toBe("ok");
      expect(recoveryFiles(value.path)).toEqual([]);
    } finally { cleanup(value); }
  }, 30000);
});
