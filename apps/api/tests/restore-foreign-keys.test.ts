import { describe, expect, it } from "bun:test";
import { readFileSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { decryptBackup, encryptBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");
type SourceState = "clean" | "violations" | "check-error";

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
  }));
  const token = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!token) throw new Error(`session cookie missing (status ${response.status})`);
  return `astyx_session=${token}`;
}

async function prepare(sourceState: SourceState = "clean") {
  const root = mkdtempSync(join(tmpdir(), "operatoros-restore-foreign-key-"));
  const path = join(root, "synthetic.sqlite");
  const backupDir = join(root, "backups");
  createAccountFixture(path, "golden-active");
  const database = openDatabase(path);
  if (sourceState === "check-error") {
    database.client.run("CREATE TABLE loop101_parent (value INTEGER)");
    database.client.run("CREATE TABLE loop101_child (parent_id INTEGER REFERENCES loop101_parent(id))");
    database.client.run("PRAGMA foreign_keys = OFF");
    database.client.run("INSERT INTO loop101_child VALUES (404)");
  } else if (sourceState === "violations") {
    database.client.run("PRAGMA foreign_keys = OFF");
    database.client.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'loop101-source-violation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  }

  const backupEncryption = parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret });
  if (!backupEncryption) throw new Error("synthetic backup encryption config missing");
  let injectPostSwapViolation = false;
  let onNextCapacityProbe: (() => void) | null = null;
  const restoreFileSystem: RestoreFileSystem = {
    rename: (from, to) => {
      if (injectPostSwapViolation && from.endsWith(".candidate") && to === path) {
        injectPostSwapViolation = false;
        const candidate = new Database(from, { readwrite: true, create: false });
        try {
          candidate.run("PRAGMA foreign_keys = OFF");
          candidate.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'loop101-post-swap-violation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
        } finally { candidate.close(); }
      }
      renameSync(from, to);
    },
    remove: (value) => rmSync(value, { force: true }),
    exists: (value) => { try { statSync(value); return true; } catch { return false; } },
  };
  const app = createApp({
    databaseHandle: database,
    backupDir,
    destructiveOperationsEnabled: true,
    backupEncryption,
    auth: { authCookieSecret: secret, auditDir: join(root, "audit") },
    diskSpaceProbe: () => { onNextCapacityProbe?.(); onNextCapacityProbe = null; return { availableBytes: 1e12, freeBytes: 1e12 }; },
    restoreFileSystem,
  });
  try {
    const cookie = await login(app);
    const headers = { cookie, origin: "http://localhost:5173" };
    const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers }));
    expect(created.status).toBe(200);
    const backup = await created.json() as { filename: string };
    database.client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES ('loop101-active-marker', 'synthetic-marker-hash', 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)");
    const artifactPath = join(backupDir, backup.filename);
    return {
      root, path, backupDir, artifactPath, database, app, cookie, backup, backupEncryption,
      injectPostSwapViolation: () => { injectPostSwapViolation = true; },
      tamperArtifactAfterPreflight: () => {
        onNextCapacityProbe = () => {
          const plaintextPath = join(root, "tampered.sqlite");
          const plaintext = decryptBackup(readFileSync(artifactPath), backupEncryption);
          writeFileSync(plaintextPath, plaintext);
          const tampered = openDatabase(plaintextPath);
          try {
            tampered.client.run("PRAGMA foreign_keys = OFF");
            tampered.client.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'loop101-candidate-violation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
            const encrypted = encryptBackup(tampered.client.serialize(), backupEncryption);
            tampered.close();
            writeFileSync(artifactPath, encrypted);
          } finally { try { tampered.close(); } catch { /* already closed */ } rmSync(plaintextPath, { force: true }); }
        };
      },
    };
  } catch (error) {
    database.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function preflight(value: Awaited<ReturnType<typeof prepare>>) {
  const response = await value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore-preflight`, { method: "POST", headers: { cookie: value.cookie, origin: "http://localhost:5173" } }));
  expect(response.status).toBe(200);
  return await response.json() as any;
}

function restore(value: Awaited<ReturnType<typeof prepare>>, checked: any): Promise<Response> {
  return value.app.handle(new Request(`http://local/api/admin/backups/${value.backup.filename}/restore`, {
    method: "POST",
    headers: { cookie: value.cookie, origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({
      current_password: "golden-admin-pass-1",
      confirmation_filename: value.backup.filename,
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

function activeMarker(value: Awaited<ReturnType<typeof prepare>>): number {
  return Number((value.database.client.query("SELECT COUNT(*) AS count FROM users WHERE username = 'loop101-active-marker'").get() as any).count);
}

function backupArtifacts(value: Awaited<ReturnType<typeof prepare>>): string[] {
  return readdirSync(value.backupDir).filter((filename) => /^backup_.*\.sqlite3$/.test(filename));
}

function cleanup(value: Awaited<ReturnType<typeof prepare>>): void {
  try { value.database.close(); } catch { /* restore may already have closed it */ }
  rmSync(value.root, { recursive: true, force: true });
}

describe("restore foreign-key validation", () => {
  it("reports actual candidate violations and refuses replacement", async () => {
    const value = await prepare("violations");
    try {
      expect(value.database.client.query("PRAGMA foreign_key_check").all()).toHaveLength(1);
      const checked = await preflight(value);
      expect(checked.source.foreign_key_violation_count).toBe(1);
      expect(checked.source.restore_eligible).toBe(false);
      expect(checked.source.blocking_reasons).toContain("foreign_key_violations");

      const response = await restore(value, checked);
      expect(response.status).toBe(409);
      expect((await response.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
      expect(activeMarker(value)).toBe(1);
    } finally { cleanup(value); }
  }, 30000);

  it("does not convert a foreign-key check error into zero violations", async () => {
    const value = await prepare("check-error");
    try {
      const checked = await preflight(value);
      expect(checked.source.foreign_key_violation_count).toBe(null);
      expect(checked.source.restore_eligible).toBe(false);
      expect(checked.source.blocking_reasons).toContain("foreign_key_check_unavailable");
      const response = await restore(value, checked);
      expect(response.status).toBe(409);
      expect(activeMarker(value)).toBe(1);
    } finally { cleanup(value); }
  }, 30000);

  it("rejects a candidate with new FK violations before replacement", async () => {
    const value = await prepare();
    try {
      const checked = await preflight(value);
      expect(checked.source.foreign_key_violation_count).toBe(0);
      value.tamperArtifactAfterPreflight();
      const response = await restore(value, checked);
      expect(response.status).toBe(500);
      expect((await response.json() as any).detail.code).toBe("RESTORE_ROLLED_BACK");
      expect(activeMarker(value)).toBe(1);
    } finally { cleanup(value); }
  }, 30000);

  it("rolls back post-swap FK failures and reports the measured count on retry", async () => {
    const value = await prepare();
    try {
      value.injectPostSwapViolation();
      const failed = await restore(value, await preflight(value));
      expect(failed.status).toBe(500);
      expect((await failed.json() as any).detail.code).toBe("RESTORE_ROLLED_BACK");
      expect(activeMarker(value)).toBe(1);
      expect(backupArtifacts(value)).toHaveLength(2);
      await login(value.app);

      const retried = await restore(value, await preflight(value));
      expect(retried.status).toBe(200);
      const result = await retried.json() as any;
      expect(result.post_restore_foreign_key_violations).toBe(0);
      expect(result.sessions_revoked).toBe(true);
      expect(activeMarker(value)).toBe(0);

      const operations = readFileSync(join(value.backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(operations.find((entry) => entry.event === "restore_failed")?.rollback_outcome).toBe("rolled_back");
      expect(operations.filter((entry) => entry.event === "restore_completed")).toHaveLength(1);
      const recovery = readFileSync(join(value.backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(recovery.map((entry) => entry.event)).toEqual(["restore_failed", "restore_completed"]);
    } finally { cleanup(value); }
  }, 30000);
});
