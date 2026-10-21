import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { backupSha256, decryptBackup, encryptBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 103).toString("base64");
type CandidateState = "missing" | "inactive" | "malformed" | "noncanonical_active" | "first_run" | "eligible" | "malformed_password_hash" | "locked_active" | "expired_lock" | "different_password";

async function prepare(restoreFileSystem?: RestoreFileSystem) {
  const root = mkdtempSync(join(tmpdir(), "operatoros-restore-admin-"));
  const path = join(root, "synthetic.sqlite");
  const backupDir = join(root, "backups");
  createAccountFixture(path, "golden-active");
  const database = openDatabase(path);
  const backupEncryption = parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret });
  if (!backupEncryption) throw new Error("synthetic backup encryption config missing");
  const app = createApp({
    databaseHandle: database,
    backupDir,
    destructiveOperationsEnabled: true,
    backupEncryption,
    restoreFileSystem,
    diskSpaceProbe: () => ({ availableBytes: 1e12, freeBytes: 1e12 }),
    auth: { authCookieSecret: secret, auditDir: join(root, "audit") },
  });
  try {
    const login = await app.handle(new Request("http://local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
    }));
    const token = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
    if (!token) throw new Error(`synthetic admin login failed (status ${login.status})`);
    const cookie = `astyx_session=${token}`;
    const created = await app.handle(new Request("http://local/api/admin/backups", { method: "POST", headers: { cookie, origin: "http://localhost:5173" } }));
    if (!created.ok) throw new Error(`synthetic API backup failed (status ${created.status})`);
    const { filename } = await created.json() as { filename: string };
    const artifactPath = join(backupDir, filename);
    const manifestPath = `${artifactPath}.meta.json`;
    const basePlaintext = decryptBackup(readFileSync(artifactPath), backupEncryption);
    const marker = Bun.password.hashSync("synthetic-active-marker", "argon2id");
    database.client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES ('loop103-active-marker', ?, 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)", [marker]);
    return { root, path, backupDir, database, app, cookie, filename, artifactPath, manifestPath, basePlaintext, backupEncryption };
  } catch (error) {
    database.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function setCandidate(value: Awaited<ReturnType<typeof prepare>>, state: CandidateState): Promise<void> {
  const candidatePath = join(value.root, "candidate.sqlite");
  writeFileSync(candidatePath, value.basePlaintext);
  const candidate = openDatabase(candidatePath);
  try {
    if (state === "missing") {
      candidate.client.run("DELETE FROM sessions");
      candidate.client.run("DELETE FROM users WHERE role = 'admin'");
      candidate.client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "inactive") {
      candidate.client.run("DELETE FROM sessions");
      candidate.client.run("UPDATE users SET is_active = 0 WHERE role = 'admin'");
      candidate.client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "malformed") {
      candidate.client.run("DELETE FROM sessions");
      candidate.client.run("UPDATE users SET username = '   ' WHERE role = 'admin'");
      candidate.client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "noncanonical_active") {
      candidate.client.run("UPDATE users SET is_active = 2 WHERE role = 'admin'");
    } else if (state === "first_run") {
      candidate.client.run("DELETE FROM sessions");
      candidate.client.run("DELETE FROM users");
      candidate.client.run("INSERT INTO first_admin_setup_state (id, completed, completed_at, created_user_id, normalized_username, provisioning_source) VALUES (1, 0, NULL, NULL, NULL, NULL) ON CONFLICT(id) DO UPDATE SET completed = 0, completed_at = NULL, created_user_id = NULL, normalized_username = NULL, provisioning_source = NULL");
    } else if (state === "malformed_password_hash") {
      candidate.client.run("UPDATE users SET password_hash = 'synthetic-unverified-hash' WHERE role = 'admin'");
    } else if (state === "locked_active") {
      candidate.client.run("UPDATE users SET locked_until = ? WHERE role = 'admin'", [new Date(Date.now() + 60_000).toISOString().replace("T", " ").replace("Z", "")]);
    } else if (state === "expired_lock") {
      candidate.client.run("UPDATE users SET locked_until = ? WHERE role = 'admin'", [new Date(Date.now() - 60_000).toISOString().replace("T", " ").replace("Z", "")]);
    } else if (state === "different_password") {
      candidate.client.run("UPDATE users SET password_hash = ? WHERE role = 'admin'", [Bun.password.hashSync("synthetic-backup-admin-password", "argon2id")]);
    }
    const plaintext = candidate.client.serialize();
    const artifact = encryptBackup(plaintext, value.backupEncryption);
    const manifest = JSON.parse(readFileSync(value.manifestPath, "utf8")) as Record<string, unknown>;
    Object.assign(manifest, {
      sha256: backupSha256(artifact),
      plaintext_sha256: backupSha256(plaintext),
      sqlite_file_size_bytes: plaintext.length,
      backup_file_size_bytes: artifact.length,
    });
    writeFileSync(value.artifactPath, artifact);
    writeFileSync(value.manifestPath, `${JSON.stringify(manifest)}\n`);
  } finally {
    candidate.close();
    rmSync(candidatePath, { force: true });
  }
}

async function preflight(value: Awaited<ReturnType<typeof prepare>>) {
  const response = await value.app.handle(new Request(`http://local/api/admin/backups/${value.filename}/restore-preflight`, {
    method: "POST",
    headers: { cookie: value.cookie, origin: "http://localhost:5173" },
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<any>;
}

async function restore(value: Awaited<ReturnType<typeof prepare>>, checked: any, candidateCredential?: { username: string; password: string }): Promise<Response> {
  return value.app.handle(new Request(`http://local/api/admin/backups/${value.filename}/restore`, {
    method: "POST",
    headers: { cookie: value.cookie, origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({
      current_password: "golden-admin-pass-1",
      ...(candidateCredential ? { candidate_admin_username: candidateCredential.username, candidate_admin_password: candidateCredential.password } : {}),
      confirmation_filename: value.filename,
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

function cleanup(value: Awaited<ReturnType<typeof prepare>>): void {
  try { value.database.close(); } catch { /* restore may have reopened the handle */ }
  rmSync(value.root, { recursive: true, force: true });
}

describe("restore administrator eligibility", () => {
  it("blocks missing, inactive, malformed, or noncanonical administrators before replacement", async () => {
    const value = await prepare();
    try {
      for (const state of ["missing", "inactive", "malformed", "noncanonical_active", "malformed_password_hash", "locked_active"] as const) {
        await setCandidate(value, state);
        const checked = await preflight(value);
        expect(checked.source.restore_eligible).toBe(false);
        const reason = state === "malformed_password_hash" ? "active_administrator_password_hash_invalid" : state === "locked_active" ? "active_administrator_locked" : "active_administrator_missing";
        expect(checked.source.blocking_reasons).toContain(reason);
        const response = await restore(value, checked);
        expect(response.status).toBe(409);
        expect((await response.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
        expect(value.database.client.query("SELECT id FROM users WHERE username = 'golden-admin' AND role = 'admin' AND is_active = 1").get()).toBeDefined();
        expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
        expect(readdirSync(value.backupDir).filter((name) => /^backup_.*\.sqlite3$/.test(name))).toHaveLength(1);
      }

      await setCandidate(value, "eligible");
      expect((await preflight(value)).source.restore_eligible).toBe(true);

      await setCandidate(value, "different_password");
      const differentPassword = await preflight(value);
      expect(differentPassword.source.restore_eligible).toBe(true);
      const refused = await restore(value, differentPassword);
      expect(refused.status).toBe(409);
      expect((await refused.json() as any).detail.code).toBe("RESTORE_ADMIN_CREDENTIAL_REQUIRED");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
      expect(readdirSync(value.backupDir).filter((name) => /^backup_.*\.sqlite3$/.test(name))).toHaveLength(1);
      expect(readFileSync(join(value.backupDir, "backup_operations_audit.jsonl"), "utf8")).not.toContain("synthetic-backup-admin-password");

      const completed = await restore(value, differentPassword, { username: "golden-admin", password: "synthetic-backup-admin-password" });
      expect(completed.status).toBe(200);
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'golden-admin' AND role = 'admin' AND is_active = 1").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("allows an expired administrator lock using the login eligibility rule", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "expired_lock");
      const checked = await preflight(value);
      expect(checked.source.restore_eligible).toBe(true);
      const response = await restore(value, checked);
      expect(response.status).toBe(200);
      expect(value.database.client.query("SELECT locked_until FROM users WHERE username = 'golden-admin'").get()).not.toBeNull();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("allows a genuinely incomplete first-run setup to be restored and provisioned", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "first_run");
      const checked = await preflight(value);
      expect(checked.source.restore_eligible).toBe(true);
      const response = await restore(value, checked);
      expect(response.status).toBe(200);
      const setup = await value.app.handle(new Request("http://local/api/setup/status"));
      expect(await setup.json()).toMatchObject({ setup_required: true });
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rolls back if the verified backup administrator credential changes after replacement, then allows retry", async () => {
    let mutateCandidate = true;
    let activePath = "";
    const restoreFileSystem: RestoreFileSystem = {
      rename: (from, to) => {
        if (mutateCandidate && to === activePath && from.endsWith(".candidate")) {
          mutateCandidate = false;
          const candidate = new Database(from, { readwrite: true, create: false });
          try { candidate.run("UPDATE users SET password_hash = ? WHERE username = 'golden-admin'", [Bun.password.hashSync("different-after-check", "argon2id")]); }
          finally { candidate.close(); }
        }
        renameSync(from, to);
      },
      remove: (path) => rmSync(path, { force: true }),
      exists: (path) => { try { readFileSync(path); return true; } catch { return false; } },
    };
    const value = await prepare(restoreFileSystem);
    activePath = value.path;
    try {
      await setCandidate(value, "different_password");
      const checked = await preflight(value);
      const failed = await restore(value, checked, { username: "golden-admin", password: "synthetic-backup-admin-password" });
      expect(failed.status).toBe(500);
      expect((await failed.json() as any).detail.code).toBe("RESTORE_ROLLED_BACK");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
      expect(readdirSync(value.backupDir).filter((name) => /^backup_.*\.sqlite3$/.test(name))).toHaveLength(2);

      const retried = await restore(value, await preflight(value), { username: "golden-admin", password: "synthetic-backup-admin-password" });
      expect(retried.status).toBe(200);
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'golden-admin' AND role = 'admin'").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);
});
