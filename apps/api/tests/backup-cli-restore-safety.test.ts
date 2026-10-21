import { expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Database } from "bun:sqlite";
import { CURRENT_SCHEMA_VERSION, createFreshDatabase, openDatabase } from "@operatoros/db";
import { loadConfig } from "../src/config";
import { restore as restoreCli } from "../src/backup-cli";
import type { RestoreFileSystem } from "../src/domains/restore-transaction";
import { backupSha256, encryptBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const cli = join(root, "apps/api/src/backup-cli.ts");
const artifactPattern = /^backup_.*\.sqlite3$/;

it("creates a pre-restore safety snapshot with an audit line and preserves the original database on failure", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-restore-safety-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    const label = basename(artifact);

    const marked = openDatabase(databasePath);
    marked.client.run("INSERT INTO students (id, name) VALUES (424242, 'Withdrawn Student')");
    marked.close();

    const restore = command("restore", label);
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout.toString()).toContain("Pre-restore safety snapshot: ");
    expect(restore.stdout.toString()).toContain(`SQLite restore completed: ${databasePath}`);

    const restored = openDatabase(databasePath, { readonly: true });
    expect(restored.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424242").get()).toEqual({ count: 0 });
    restored.close();

    const artifacts = readdirSync(backupDir).filter((name) => artifactPattern.test(name)).sort();
    expect(artifacts).toHaveLength(2);
    const safety = artifacts.find((name) => name !== label);
    if (!safety) throw new Error("pre-restore safety snapshot missing");
    expect(existsSync(join(backupDir, safety))).toBe(true);
    expect(existsSync(join(backupDir, `${safety}.meta.json`))).toBe(true);
    const safetyMeta = JSON.parse(readFileSync(join(backupDir, `${safety}.meta.json`), "utf8")) as { trigger?: string; schema_version?: string };
    expect(safetyMeta.trigger).toBe("pre_restore_auto");
    expect(safetyMeta.schema_version).toBe(CURRENT_SCHEMA_VERSION);

    const safetyCheckDir = join(temporary, "safety-check");
    mkdirSync(safetyCheckDir);
    const safetyRestore = command("restore-disposable", safety, safetyCheckDir);
    expect(safetyRestore.exitCode).toBe(0);
    const safetyHandle = openDatabase(join(safetyCheckDir, "operatoros.sqlite"), { readonly: true });
    expect(safetyHandle.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424242").get()).toEqual({ count: 1 });
    safetyHandle.close();

    const completed = readFileSync(join(backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "restore_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.tool).toBe("backup-cli");
    expect(completed[0]!.filename).toBe(label);
    expect(completed[0]!.safety_backup_filename).toBe(safety);

    const cliRecovery = readFileSync(join(backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(cliRecovery).toHaveLength(1);
    expect(cliRecovery[0]!.event).toBe("restore_completed");
    expect(cliRecovery[0]!.outcome).toBe("COMPLETED");
    expect(cliRecovery[0]!.target_filename).toBe(label);
    expect(cliRecovery[0]!.pre_restore_snapshot_filename).toBe(safety);
    expect(cliRecovery[0]!.reason).toBeNull();
    expect(typeof (cliRecovery[0]!.request_context as { operation_id?: unknown }).operation_id).toBe("string");

    const preserved = readFileSync(databasePath);
    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    const refused = command("restore", label);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(readFileSync(databasePath).equals(preserved)).toBe(true);
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(2);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    writeFileSync(join(backupDir, "backup_2000-01-01T00-00-00Z.sqlite3"), "not an encrypted backup");
    const invalid = command("restore", "backup_2000-01-01T00-00-00Z.sqlite3");
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr.toString()).toContain("Legacy plaintext backups require explicit operator opt-in.");
    expect(readFileSync(databasePath).equals(preserved)).toBe(true);

    const failures = readFileSync(join(backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "restore_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe("DATABASE_SIDECAR_PRESENT");
    expect(failures[0]!.tool).toBe("backup-cli");
    expect(failures[0]!.filename).toBe(label);

    const cliRecoveryLines = readFileSync(join(backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(cliRecoveryLines).toHaveLength(2);
    const cliFailures = cliRecoveryLines.filter((entry) => entry.event === "restore_failed");
    expect(cliFailures).toHaveLength(1);
    expect(cliFailures[0]!.outcome).toBe("FAILED");
    expect(cliFailures[0]!.target_filename).toBe(label);
    expect(cliFailures[0]!.reason).toBe("DATABASE_SIDECAR_PRESENT");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("rejects authenticated SQLite candidates with integrity, foreign-key, or schema failures before replacing the active database", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-invalid-schema-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const key = randomBytes(32).toString("base64");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: key,
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const active = openDatabase(databasePath);
    active.client.run("INSERT INTO students (id, name) VALUES (424243, 'Active marker')");
    active.close();
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifactPath = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    const filename = basename(artifactPath);
    const encryption = parseBackupEncryptionConfig({ activeKey: key, activeKeyId: "synthetic-test", authCookieSecret: env.AUTH_COOKIE_SECRET });
    if (!encryption) throw new Error("synthetic backup encryption config missing");

    const incompatiblePath = join(temporary, "incompatible.sqlite");
    const incompatible = new Database(incompatiblePath);
    incompatible.run("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    const plaintext = incompatible.serialize();
    incompatible.close();
    const manifestPath = `${artifactPath}.meta.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const original = readFileSync(databasePath);
    const rejectCandidate = (candidate: Uint8Array) => {
      const encrypted = encryptBackup(candidate, encryption);
      Object.assign(manifest, {
        backup_file_size_bytes: encrypted.length,
        sqlite_file_size_bytes: candidate.length,
        sha256: backupSha256(encrypted),
        plaintext_sha256: backupSha256(candidate),
      });
      writeFileSync(artifactPath, encrypted);
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      expect(command("restore", filename).exitCode).not.toBe(0);
      expect(readFileSync(databasePath).equals(original)).toBe(true);
    };

    rejectCandidate(plaintext);

    const foreignKeyPath = join(temporary, "foreign-key.sqlite");
    createFreshDatabase(foreignKeyPath);
    const foreignKeyDatabase = new Database(foreignKeyPath);
    try {
      foreignKeyDatabase.run("PRAGMA foreign_keys = OFF");
      foreignKeyDatabase.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'loop102-invalid-candidate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
      rejectCandidate(foreignKeyDatabase.serialize());
    } finally { foreignKeyDatabase.close(); }

    rejectCandidate(Buffer.from("authenticated but not a SQLite database"));
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(1);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("rejects an admin-less candidate with closed setup before making the CLI safety snapshot", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-admin-"));
  const databasePath = join(temporary, "operatoros.sqlite");
  const backupDir = join(temporary, "backups");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: temporary,
    OPERATOROS_REPOSITORY_ROOT: root,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createAccountFixture(databasePath, "golden-active");
    const original = readFileSync(databasePath);
    const candidate = openDatabase(databasePath);
    candidate.client.run("DELETE FROM sessions");
    candidate.client.run("DELETE FROM users WHERE role = 'admin'");
    candidate.client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET completed = 1");
    candidate.close();

    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const filename = basename(backup.stdout.toString().trim().replace("Encrypted backup completed: ", ""));
    writeFileSync(databasePath, original);
    const activeBefore = readFileSync(databasePath);

    expect(() => restoreCli(filename, loadConfig(env))).toThrow("RESTORE_ADMINISTRATOR_REQUIRED");
    expect(readFileSync(databasePath).equals(activeBefore)).toBe(true);
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(1);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("restores an empty CLI candidate while first-admin setup is still open", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-first-run-"));
  const databasePath = join(temporary, "operatoros.sqlite");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: temporary,
    OPERATOROS_REPOSITORY_ROOT: root,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createAccountFixture(databasePath, "golden-active");
    const original = readFileSync(databasePath);
    const candidate = openDatabase(databasePath);
    candidate.client.run("DELETE FROM sessions");
    candidate.client.run("DELETE FROM users");
    candidate.client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET completed = 0");
    candidate.close();

    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const filename = basename(backup.stdout.toString().trim().replace("Encrypted backup completed: ", ""));
    writeFileSync(databasePath, original);
    restoreCli(filename, loadConfig(env));

    const restored = openDatabase(databasePath, { readonly: true });
    expect(restored.client.query("SELECT id FROM users LIMIT 1").get()).toBeNull();
    expect(restored.client.query("SELECT completed FROM first_admin_setup_state WHERE id = 1").get()).toEqual({ completed: 0 });
    restored.close();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("rejects manifest identity, checksum, and envelope-authentication mismatches before changing the active database", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-manifest-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifactPath = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    const filename = basename(artifactPath);
    const changed = openDatabase(databasePath);
    changed.client.run("INSERT INTO students (id, name) VALUES (424244, 'Active marker')");
    changed.close();
    const original = readFileSync(databasePath);
    const manifestPath = `${artifactPath}.meta.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    manifest.filename = "backup_2000-01-01T00-00-00Z.sqlite3";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(command("restore", filename).exitCode).not.toBe(0);
    expect(readFileSync(databasePath).equals(original)).toBe(true);

    manifest.filename = filename;
    manifest.key_id = "unrelated-key";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(command("restore", filename).exitCode).not.toBe(0);
    expect(readFileSync(databasePath).equals(original)).toBe(true);

    manifest.filename = filename;
    manifest.key_id = "synthetic-test";
    manifest.sha256 = "0".repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(command("restore", filename).exitCode).not.toBe(0);
    expect(readFileSync(databasePath).equals(original)).toBe(true);

    const encrypted = JSON.parse(readFileSync(artifactPath, "utf8")) as { tag: string };
    encrypted.tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    const unauthenticated = Buffer.from(JSON.stringify(encrypted));
    manifest.sha256 = backupSha256(unauthenticated);
    writeFileSync(artifactPath, unauthenticated);
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(command("restore", filename).exitCode).not.toBe(0);
    expect(readFileSync(databasePath).equals(original)).toBe(true);
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(1);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("rolls back interrupted and post-swap-invalid replacements, then allows a safe retry", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-rollback-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    OPERATOROS_REPOSITORY_ROOT: root,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const filename = basename(backup.stdout.toString().trim().replace("Encrypted backup completed: ", ""));
    const active = openDatabase(databasePath);
    active.client.run("INSERT INTO students (id, name) VALUES (424245, 'Original marker')");
    active.close();
    const original = readFileSync(databasePath);
    const value = loadConfig(env);
    let fault: "interrupted" | "foreign-key" | "recovery-required" | null = "interrupted";
    let failCandidateParking = false;
    const fileSystem: RestoreFileSystem = {
      rename: (from, to) => {
        if (to === databasePath && from.endsWith(".candidate")) {
          const selected = fault;
          fault = null;
          if (selected === "interrupted") throw new Error("SYNTHETIC_RESTORE_INTERRUPTION");
          if (selected === "foreign-key" || selected === "recovery-required") {
            failCandidateParking = selected === "recovery-required";
            const candidate = new Database(from, { readwrite: true, create: false });
            try {
              candidate.run("PRAGMA foreign_keys = OFF");
              candidate.run("INSERT INTO sessions (user_id, token_hash, expires_at, absolute_expires_at) VALUES (404, 'loop102-invalid-candidate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
            } finally { candidate.close(); }
          }
        }
        if (failCandidateParking && from === databasePath && to.endsWith(".rejected")) {
          failCandidateParking = false;
          throw new Error("SYNTHETIC_RECOVERY_PARK_INTERRUPTION");
        }
        renameSync(from, to);
      },
      remove: (path) => rmSync(path, { force: true }),
      exists: (path) => { try { statSync(path); return true; } catch { return false; } },
    };

    expect(() => restoreCli(filename, value, fileSystem)).toThrow("RESTORE_ROLLED_BACK");
    expect(readFileSync(databasePath).equals(original)).toBe(true);
    expect(readdirSync(source).some((name) => name.endsWith(".rollback"))).toBe(false);

    fault = "foreign-key";
    expect(() => restoreCli(filename, value, fileSystem)).toThrow("RESTORE_ROLLED_BACK");
    expect(readFileSync(databasePath).equals(original)).toBe(true);

    fault = "recovery-required";
    expect(() => restoreCli(filename, value, fileSystem)).toThrow("RESTORE_RECOVERY_REQUIRED");
    const strandedRollback = readdirSync(source).find((name) => name.startsWith("operatoros.sqlite.") && name.endsWith(".rollback"));
    if (!strandedRollback) throw new Error("rollback database missing after synthetic recovery failure");
    expect(readFileSync(join(source, strandedRollback)).equals(original)).toBe(true);
    expect(() => restoreCli(filename, value)).toThrow("RESTORE_RECOVERY_PENDING");
    renameSync(join(source, strandedRollback), databasePath);
    expect(readFileSync(databasePath).equals(original)).toBe(true);

    restoreCli(filename, value);
    const restored = openDatabase(databasePath, { readonly: true });
    expect(restored.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424245").get()).toEqual({ count: 0 });
    restored.close();

    const operations = readFileSync(join(backupDir, "backup_operations_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = operations.filter((entry) => entry.event === "restore_failed");
    expect(failed.map((entry) => entry.rollback_outcome)).toEqual(["rolled_back", "rolled_back", "recovery_required"]);
    expect(operations.filter((entry) => entry.event === "restore_completed")).toHaveLength(1);
    const recovery = readFileSync(join(backupDir, "backup_restore_audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(recovery.map((entry) => entry.outcome)).toEqual(["FAILED", "FAILED", "FAILED", "COMPLETED"]);
    expect(readdirSync(backupDir).filter((name) => artifactPattern.test(name))).toHaveLength(5);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it("restores a valid legacy plaintext backup only with explicit opt-in", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-legacy-"));
  const source = join(temporary, "source");
  mkdirSync(source);
  const databasePath = join(source, "operatoros.sqlite");
  const backupDir = join(source, "backups");
  const legacySourcePath = join(temporary, "legacy-source.sqlite");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    OPERATOROS_REPOSITORY_ROOT: root,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
    ALLOW_LEGACY_PLAINTEXT_BACKUPS: "true",
  };
  try {
    createFreshDatabase(legacySourcePath);
    const before = openDatabase(legacySourcePath);
    before.client.run("INSERT INTO students (id, name) VALUES (424246, 'Legacy marker')");
    before.close();
    mkdirSync(backupDir, { recursive: true });
    const filename = "backup_2026-01-01T00-00-00Z.sqlite3";
    writeFileSync(join(backupDir, filename), readFileSync(legacySourcePath), { flag: "wx", mode: 0o600 });

    restoreCli(filename, loadConfig(env));
    const restored = openDatabase(databasePath, { readonly: true });
    expect(restored.client.query("SELECT COUNT(*) AS count FROM students WHERE id = 424246").get()).toEqual({ count: 1 });
    restored.close();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
