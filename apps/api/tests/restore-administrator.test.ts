import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { CURRENT_SCHEMA_VERSION, openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { backupSha256, decryptBackup, encryptBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 103).toString("base64");
type CandidateState = "missing" | "inactive" | "malformed" | "noncanonical_active" | "first_run" | "eligible" | "malformed_password_hash" | "locked_active" | "expired_lock" | "different_password" | "migration_ledger_view" | "migration_ledger_without_primary_key" | "migration_ledger_generated_column" | "varchar_migration_ledger" | "sqlitez_extra_trigger" | "ledger_named_trigger" | "users_view" | "fts5_virtual_table" | "upp_report_fts5_table";

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
  const candidate = new Database(candidatePath);
  try {
    if (state === "missing") {
      candidate.run("DELETE FROM sessions");
      candidate.run("DELETE FROM users WHERE role = 'admin'");
      candidate.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "inactive") {
      candidate.run("DELETE FROM sessions");
      candidate.run("UPDATE users SET is_active = 0 WHERE role = 'admin'");
      candidate.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "malformed") {
      candidate.run("DELETE FROM sessions");
      candidate.run("UPDATE users SET username = '   ' WHERE role = 'admin'");
      candidate.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    } else if (state === "noncanonical_active") {
      candidate.run("UPDATE users SET is_active = 2 WHERE role = 'admin'");
    } else if (state === "first_run") {
      candidate.run("DELETE FROM sessions");
      candidate.run("DELETE FROM users");
      candidate.run("INSERT INTO first_admin_setup_state (id, completed, completed_at, created_user_id, normalized_username, provisioning_source) VALUES (1, 0, NULL, NULL, NULL, NULL) ON CONFLICT(id) DO UPDATE SET completed = 0, completed_at = NULL, created_user_id = NULL, normalized_username = NULL, provisioning_source = NULL");
    } else if (state === "malformed_password_hash") {
      candidate.run("UPDATE users SET password_hash = 'synthetic-unverified-hash' WHERE role = 'admin'");
    } else if (state === "locked_active") {
      candidate.run("UPDATE users SET locked_until = ? WHERE role = 'admin'", [new Date(Date.now() + 60_000).toISOString().replace("T", " ").replace("Z", "")]);
    } else if (state === "expired_lock") {
      candidate.run("UPDATE users SET locked_until = ? WHERE role = 'admin'", [new Date(Date.now() - 60_000).toISOString().replace("T", " ").replace("Z", "")]);
    } else if (state === "different_password") {
      candidate.run("UPDATE users SET password_hash = ? WHERE role = 'admin'", [Bun.password.hashSync("synthetic-backup-admin-password", "argon2id")]);
    } else if (state === "migration_ledger_view") {
      candidate.run("DROP TABLE operatoros_schema_migrations");
      candidate.run("CREATE VIEW operatoros_schema_migrations AS SELECT version, schema_fingerprint FROM operatoros_cve_missing_migration_sentinel");
    } else if (state === "migration_ledger_without_primary_key") {
      const migration = candidate.query("SELECT version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at FROM operatoros_schema_migrations").get() as {
        version: string;
        predecessor: string | null;
        schema_fingerprint: string;
        protected_fingerprints: string;
        approved_by: string;
        applied_at: string;
      } | null;
      if (!migration) throw new Error("synthetic migration ledger row is missing");
      candidate.run("DROP TABLE operatoros_schema_migrations");
      candidate.run("CREATE TABLE operatoros_schema_migrations (version TEXT, predecessor TEXT NULL, schema_fingerprint TEXT NOT NULL, protected_fingerprints TEXT NOT NULL, approved_by TEXT NOT NULL, applied_at TEXT NOT NULL)");
      candidate.run("INSERT INTO operatoros_schema_migrations VALUES (?, ?, ?, ?, ?, ?)", [migration.version, migration.predecessor, migration.schema_fingerprint, migration.protected_fingerprints, migration.approved_by, migration.applied_at]);
    } else if (state === "migration_ledger_generated_column") {
      candidate.run("ALTER TABLE operatoros_schema_migrations ADD COLUMN cve_generated_ledger_probe TEXT GENERATED ALWAYS AS (version) VIRTUAL");
    } else if (state === "varchar_migration_ledger") {
      const rows = candidate.query("SELECT version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at FROM operatoros_schema_migrations").all() as { version: string; predecessor: string | null; schema_fingerprint: string; protected_fingerprints: string; approved_by: string; applied_at: string }[];
      const triggers = candidate.query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'operatoros_schema_migrations'").all() as { sql: string }[];
      candidate.run("DROP TABLE operatoros_schema_migrations");
      candidate.run("CREATE TABLE operatoros_schema_migrations (version VARCHAR(64) PRIMARY KEY, predecessor VARCHAR(64), schema_fingerprint VARCHAR(64) NOT NULL, protected_fingerprints VARCHAR(4096) NOT NULL, approved_by VARCHAR(255) NOT NULL, applied_at VARCHAR(64) NOT NULL)");
      for (const row of rows) candidate.run("INSERT INTO operatoros_schema_migrations VALUES (?, ?, ?, ?, ?, ?)", [row.version, row.predecessor, row.schema_fingerprint, row.protected_fingerprints, row.approved_by, row.applied_at]);
      for (const trigger of triggers) candidate.exec(trigger.sql);
    } else if (state === "sqlitez_extra_trigger") {
      candidate.run("CREATE TRIGGER sqlitez_extra AFTER UPDATE ON users BEGIN SELECT 1; END");
    } else if (state === "ledger_named_trigger") {
      candidate.run("CREATE TRIGGER operatoros_schema_migrations AFTER UPDATE ON users BEGIN SELECT 1; END");
    } else if (state === "users_view") {
      candidate.run("ALTER TABLE users RENAME TO users_original");
      candidate.run("CREATE VIEW users AS SELECT id, username, password_hash, role, is_active, failed_login_attempts, locked_until FROM operatoros_cve_missing_users_sentinel");
    } else if (state === "fts5_virtual_table") {
      candidate.run("CREATE VIRTUAL TABLE operatoros_cve_test_fts USING fts5(content)");
    } else if (state === "upp_report_fts5_table") {
      candidate.run("DROP TABLE upp_report_versions");
      candidate.run("CREATE VIRTUAL TABLE upp_report_versions USING fts5(content)");
    }
    const plaintext = candidate.serialize();
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
  const response = await preflightResponse(value);
  expect(response.status).toBe(200);
  return response.json() as Promise<any>;
}

async function preflightResponse(value: Awaited<ReturnType<typeof prepare>>): Promise<Response> {
  return value.app.handle(new Request(`http://local/api/admin/backups/${value.filename}/restore-preflight`, {
    method: "POST",
    headers: { cookie: value.cookie, origin: "http://localhost:5173" },
  }));
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

describe("restore preflight schema objects", () => {
  it("rejects a migration-ledger view before evaluating its sentinel source", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "migration_ledger_view");
      const response = await preflightResponse(value);
      const payload = await response.json() as any;
      if (response.status !== 200) throw new Error(`preflight returned ${response.status}: ${JSON.stringify(payload)}`);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.schema_version).toBe("unknown");
      expect(payload.source.restore_eligible).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("operatoros_cve_missing_migration_sentinel");
      expect(payload.active.active_schema_version).toBe("unknown");
      expect(payload.active.active_students).toBe(null);
      const denied = await restore(value, payload);
      expect(denied.status).toBe(409);
      expect((await denied.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rejects a migration-ledger table that lacks the canonical primary key", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "migration_ledger_without_primary_key");
      const response = await preflightResponse(value);
      const payload = await response.json() as any;
      if (response.status !== 200) throw new Error(`preflight returned ${response.status}: ${JSON.stringify(payload)}`);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.schema_version).toBe("unknown");
      expect(payload.source.restore_eligible).toBe(false);
      const denied = await restore(value, payload);
      expect(denied.status).toBe(409);
      expect((await denied.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("does not inspect restore identity through a users view when the schema is invalid", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "users_view");
      const response = await preflightResponse(value);
      const payload = await response.json() as any;
      if (response.status !== 200) throw new Error(`preflight returned ${response.status}: ${JSON.stringify(payload)}`);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.blocking_reasons).not.toContain("active_administrator_missing");
      expect(payload.source.identity_compatible).toBe(false);
      expect(payload.source.schema_version).toBe("unknown");
      expect(payload.source.restore_eligible).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("operatoros_cve_missing_users_sentinel");
      const denied = await restore(value, payload);
      expect(denied.status).toBe(409);
      expect((await denied.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rejects FTS5 virtual tables before running integrity or identity checks", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "fts5_virtual_table");
      const response = await preflightResponse(value);
      const payload = await response.json() as any;
      if (response.status !== 200) throw new Error(`preflight returned ${response.status}: ${JSON.stringify(payload)}`);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.schema_version).toBe("unknown");
      expect(payload.source.identity_compatible).toBe(false);
      expect(payload.source.integrity_check).toBe("not_checked");
      expect(payload.source.quick_check).toBe("not_checked");
      expect(payload.source.foreign_key_violation_count).toBe(null);
      expect(payload.source.restore_eligible).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("operatoros_cve_test_fts");
      const denied = await restore(value, payload);
      expect(denied.status).toBe(409);
      expect((await denied.json() as any).detail.code).toBe("RESTORE_SOURCE_INVALID");
      expect(value.database.client.query("SELECT id FROM users WHERE username = 'loop103-active-marker'").get()).toBeDefined();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rejects FTS5 report attachment tables before querying their rows", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "upp_report_fts5_table");
      const response = await preflightResponse(value);
      const payload = await response.json() as any;
      expect(response.status).toBe(200);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.integrity_check).toBe("not_checked");
      expect(payload.source.restore_eligible).toBe(false);
      expect(payload.active.active_schema_version).toBe("unknown");
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rejects generated migration-ledger columns hidden from table_info", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "migration_ledger_generated_column");
      const payload = await preflight(value);
      expect(payload.source.blocking_reasons).toContain("schema_incompatible");
      expect(payload.source.schema_version).toBe("unknown");
      expect(payload.source.restore_eligible).toBe(false);
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("accepts a migration ledger with equivalent VARCHAR text affinity", async () => {
    const value = await prepare();
    try {
      await setCandidate(value, "varchar_migration_ledger");
      const payload = await preflight(value);
      expect(payload.source.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(payload.source.application_compatible).toBe(true);
      expect(payload.source.restore_eligible).toBe(true);
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("fingerprints sqlite-like names and triggers named like the migration table", async () => {
    for (const state of ["sqlitez_extra_trigger", "ledger_named_trigger"] as const) {
      const value = await prepare();
      try {
        await setCandidate(value, state);
        const payload = await preflight(value);
        expect(payload.source.blocking_reasons).toContain("schema_incompatible");
        expect(payload.source.schema_version).toBe("unknown");
        expect(payload.source.restore_eligible).toBe(false);
      } finally {
        cleanup(value);
      }
    }
  }, 30000);
});

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
      const deniedEvents = readFileSync(join(value.backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).slice(-2);
      expect(deniedEvents.map((entry) => entry.event)).toEqual(["restore_requested", "restore_denied"]);
      expect(deniedEvents[1]!.reason).toBe("RESTORE_ADMIN_CREDENTIAL_REQUIRED");
      expect((deniedEvents[0]!.request_context as { operation_id: string }).operation_id).toBe((deniedEvents[1]!.request_context as { operation_id: string }).operation_id);
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
      syncFile: () => {},
      syncDirectory: () => {},
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
