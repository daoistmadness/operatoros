import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, S48_SCHEMA_FINGERPRINT, createFreshDatabase, migrateExistingDatabase, openDatabase } from "@operatoros/db";
import { backupSha256, decryptBackup, encryptBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const cli = join(root, "apps/api/src/backup-cli.ts");

it("backs up and rehearses an approved S4.8 migration without changing its source", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-s48-backup-test-"));
  const source = join(temporary, "source");
  const restored = join(temporary, "restored");
  mkdirSync(source);
  mkdirSync(restored);
  const databasePath = join(source, "operatoros.sqlite");
  const env = { ...process.env, OPERATOROS_DATA_DIR: source, DATABASE_URL: `sqlite:///${databasePath}`, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), BACKUP_ENCRYPTION_KEY_ID: "synthetic-test", AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key" };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    const database = new Database(databasePath, { create: true });
    database.exec(readFileSync(join(root, "packages/db/src/s47-schema.sql"), "utf8"));
    database.exec(readFileSync(join(root, "packages/db/src/s48-migration.sql"), "utf8"));
    database.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES ('20261002_s48','20260929_s47',?,'{}','SYNTHETIC_FIXTURE','2026-10-02T00:00:00Z')", [S48_SCHEMA_FINGERPRINT]);
    database.run("INSERT INTO staff_members (id,full_name,normalized_name) VALUES ('synthetic-s48','Synthetic Staff','synthetic staff')");
    database.close();

    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    expect(JSON.parse(readFileSync(`${artifact}.meta.json`, "utf8")).schema_version).toBe("20261002_s48");
    const restore = command("restore-disposable", artifact, restored);
    expect(restore.exitCode).toBe(0);
    const restoredPath = join(restored, "operatoros.sqlite");
    expect(migrateExistingDatabase(restoredPath)).toBe("MIGRATED");
    const result = openDatabase(restoredPath, { readonly: true });
    expect(result.client.query("SELECT full_name FROM staff_members WHERE id='synthetic-s48'").get()).toEqual({ full_name: "Synthetic Staff" });
    result.close();
    const original = new Database(databasePath, { readonly: true });
    expect(original.query("SELECT version FROM operatoros_schema_migrations").get()).toEqual({ version: "20261002_s48" });
    original.close();

    const tampered = new Database(databasePath);
    tampered.run("CREATE TABLE unapproved_change (id INTEGER)");
    tampered.close();
    expect(command("backup").exitCode).not.toBe(0);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 15000);

it("backs up and restores only an explicit disposable data root", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-test-"));
  const source = join(temporary, "source");
  const restored = join(temporary, "restored");
  mkdirSync(source);
  mkdirSync(restored);
  const databasePath = join(source, "operatoros.sqlite");
  const env = {
    ...process.env,
    OPERATOROS_DATA_DIR: source,
    DATABASE_URL: `sqlite:///${databasePath}`,
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BACKUP_ENCRYPTION_KEY_ID: "synthetic-test",
    AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key",
    OPERATOROS_MIGRATION_LOCKED: "1",
  };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    createFreshDatabase(databasePath);
    const active = openDatabase(databasePath);
    expect(command("backup").stderr.toString()).toContain("DATABASE_OPEN_HANDLE");
    active.close();
    const wal = openDatabase(databasePath);
    wal.client.exec("PRAGMA journal_mode=WAL");
    wal.close();
    writeFileSync(`${databasePath}-wal`, "");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    expect(artifact).toStartWith(join(source, "backups"));
    const manifest = JSON.parse(readFileSync(`${artifact}.meta.json`, "utf8")) as { schema_version?: string; trigger?: string };
    expect(manifest.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(manifest.trigger).toBe("manual");
    expect(manifest.schema_version).not.toBe("unknown");

    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("backup").stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(existsSync(`${databasePath}-wal`)).toBe(true);
    expect(existsSync(`${databasePath}-shm`)).toBe(true);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    const restore = command("restore-disposable", artifact, restored);
    expect(restore.exitCode).toBe(0);
    expect(existsSync(join(restored, "operatoros.sqlite-wal"))).toBe(false);
    expect(existsSync(join(restored, "operatoros.sqlite-shm"))).toBe(false);
    const handle = openDatabase(join(restored, "operatoros.sqlite"), { readonly: true });
    handle.close();

    const backupEncryption = parseBackupEncryptionConfig({ activeKey: env.BACKUP_ENCRYPTION_KEY, activeKeyId: env.BACKUP_ENCRYPTION_KEY_ID, authCookieSecret: env.AUTH_COOKIE_SECRET });
    if (!backupEncryption) throw new Error("synthetic backup encryption config missing");
    const plaintextPath = join(temporary, "incomplete-schema.sqlite");
    writeFileSync(plaintextPath, decryptBackup(readFileSync(artifact), backupEncryption), { mode: 0o600 });
    const incomplete = new Database(plaintextPath);
    let plaintext: Uint8Array;
    try { incomplete.run("DROP TABLE attendance"); plaintext = incomplete.serialize(); } finally { incomplete.close(); }
    const invalidArtifact = encryptBackup(plaintext!, backupEncryption);
    const invalidFilename = "backup_2099-01-01T00-00-00Z.sqlite3";
    const invalidPath = join(source, "backups", invalidFilename);
    writeFileSync(invalidPath, invalidArtifact, { mode: 0o600 });
    writeFileSync(`${invalidPath}.meta.json`, JSON.stringify({ ...JSON.parse(readFileSync(`${artifact}.meta.json`, "utf8")), filename: invalidFilename, sha256: backupSha256(invalidArtifact), plaintext_sha256: backupSha256(plaintext!), backup_file_size_bytes: invalidArtifact.length, sqlite_file_size_bytes: plaintext!.length }), { mode: 0o600 });
    const invalidTarget = join(temporary, "invalid-restored");
    mkdirSync(invalidTarget);
    const rejectedDisposable = command("restore-disposable", invalidFilename, invalidTarget);
    expect(rejectedDisposable.exitCode).not.toBe(0);
    expect(rejectedDisposable.stderr.toString()).toContain("EXISTING_SCHEMA_INCOMPLETE");
    expect(existsSync(join(invalidTarget, "operatoros.sqlite"))).toBe(false);
    rmSync(plaintextPath, { force: true });

    writeFileSync(`${databasePath}-wal`, "");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("migrate-existing", artifact, source).stdout.toString()).toContain(`NOOP ${CURRENT_SCHEMA_VERSION}`);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);

    writeFileSync(`${databasePath}-wal`, "nonempty synthetic WAL");
    writeFileSync(`${databasePath}-shm`, "synthetic shared memory");
    expect(command("migrate-existing", artifact, source).stderr.toString()).toContain("DATABASE_SIDECAR_PRESENT");
    expect(existsSync(`${databasePath}-wal`)).toBe(true);
    rmSync(`${databasePath}-wal`);
    rmSync(`${databasePath}-shm`);

    const changed = openDatabase(databasePath);
    changed.client.run("INSERT INTO students (id,name) VALUES (1,'Synthetic Student')");
    changed.close();
    const refused = command("migrate-existing", artifact, source);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("BACKUP_SOURCE_MISMATCH");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 15000);

it("rejects an S4.8 source with an altered migration ledger before backup, disposable restore, or migration", () => {
  const temporary = mkdtempSync(join(tmpdir(), "operatoros-s48-ledger-test-"));
  const source = join(temporary, "source");
  const restored = join(temporary, "restored");
  mkdirSync(source);
  mkdirSync(restored);
  const databasePath = join(source, "operatoros.sqlite");
  const env = { ...process.env, OPERATOROS_DATA_DIR: source, DATABASE_URL: `sqlite:///${databasePath}`, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), BACKUP_ENCRYPTION_KEY_ID: "synthetic-test", AUTH_COOKIE_SECRET: "synthetic-test-cookie-secret-distinct-from-key" };
  const command = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  try {
    const database = new Database(databasePath, { create: true });
    database.exec(readFileSync(join(root, "packages/db/src/s47-schema.sql"), "utf8"));
    database.exec(readFileSync(join(root, "packages/db/src/s48-migration.sql"), "utf8"));
    database.run("INSERT INTO operatoros_schema_migrations (version,predecessor,schema_fingerprint,protected_fingerprints,approved_by,applied_at) VALUES ('20261002_s48','20260929_s47',?,'{}','SYNTHETIC_FIXTURE','2026-10-02T00:00:00Z')", [S48_SCHEMA_FINGERPRINT]);
    database.close();

    const backup = command("backup");
    expect(backup.exitCode).toBe(0);
    const artifact = backup.stdout.toString().trim().replace("Encrypted backup completed: ", "");
    const config = parseBackupEncryptionConfig({ activeKey: env.BACKUP_ENCRYPTION_KEY, activeKeyId: env.BACKUP_ENCRYPTION_KEY_ID, authCookieSecret: env.AUTH_COOKIE_SECRET });
    if (!config) throw new Error("synthetic backup encryption config missing");
    const plaintextPath = join(temporary, "altered-ledger.sqlite");
    writeFileSync(plaintextPath, decryptBackup(readFileSync(artifact), config), { mode: 0o600 });
    const altered = new Database(plaintextPath);
    let plaintext: Uint8Array;
    try { altered.exec("ALTER TABLE operatoros_schema_migrations ADD COLUMN extra TEXT"); plaintext = altered.serialize(); } finally { altered.close(); }
    const encrypted = encryptBackup(plaintext!, config);
    writeFileSync(artifact, encrypted, { mode: 0o600 });
    const manifestPath = `${artifact}.meta.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, sha256: backupSha256(encrypted), plaintext_sha256: backupSha256(plaintext!), backup_file_size_bytes: encrypted.length, sqlite_file_size_bytes: plaintext!.length }), { mode: 0o600 });

    const restore = command("restore-disposable", artifact, restored);
    expect(restore.exitCode).not.toBe(0);
    expect(restore.stderr.toString()).toContain("migration ledger layout differs");
    expect(existsSync(join(restored, "operatoros.sqlite"))).toBe(false);

    const sourceWithBadLedger = new Database(databasePath);
    sourceWithBadLedger.exec("ALTER TABLE operatoros_schema_migrations ADD COLUMN extra TEXT");
    sourceWithBadLedger.close();
    expect(command("backup").stderr.toString()).toContain("migration ledger layout differs");
    expect(() => migrateExistingDatabase(databasePath)).toThrow("migration ledger layout differs");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 15000);
