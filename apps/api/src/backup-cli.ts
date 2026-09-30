import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database, constants } from "bun:sqlite";
import { migrateExistingDatabase, PROTECTED_DATABASE_BASENAME, resolveOperatorOSPaths } from "@operatoros/db";
import { loadConfig } from "./config";
import { backupSha256, decryptBackup, encryptBackup, isEncryptedBackup } from "./security/backup-crypto";

const root = resolve(import.meta.dir, "../../");
const backupName = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$/;

function config() {
  if (!process.env.OPERATOROS_DATA_DIR?.trim()) throw new Error("OPERATOROS_DATA_DIR is required for explicit backup operations.");
  const paths = resolveOperatorOSPaths({ env: process.env, repositoryRoot: root });
  const cookieFile = join(paths.dataDir, "auth-cookie-secret");
  const cookieSecret = process.env.AUTH_COOKIE_SECRET ?? (existsSync(cookieFile) ? readFileSync(cookieFile, "utf8").trim() : undefined);
  const value = loadConfig({ ...process.env, AUTH_COOKIE_SECRET: cookieSecret, OPERATOROS_REPOSITORY_ROOT: root });
  if (!value.databasePath || !isAbsolute(value.databasePath)) throw new Error("DATABASE_URL must use an absolute SQLite path.");
  if (basename(value.databasePath) === PROTECTED_DATABASE_BASENAME) throw new Error("Protected database access is forbidden.");
  return value;
}

function exists(path: string): boolean { try { statSync(path); return true; } catch { return false; } }

function openOfflineSnapshot(path: string): Database {
  if (["-wal", "-shm", "-journal"].some((suffix) => existsSync(`${path}${suffix}`))) throw new Error("DATABASE_SIDECAR_PRESENT");
  const handles = Bun.spawnSync(["lsof", "-nP", "--", path], { stdout: "pipe", stderr: "pipe" });
  if (handles.exitCode === 0) throw new Error("DATABASE_OPEN_HANDLE");
  if (handles.exitCode !== 1) throw new Error("DATABASE_OPEN_HANDLE_CHECK_FAILED");
  return new Database(`${pathToFileURL(path).href}?immutable=1`, constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI);
}

function clearOrphanedEmptyWal(path: string): void {
  const wal = `${path}-wal`;
  const shm = `${path}-shm`;
  const journal = `${path}-journal`;
  const sidecars = [wal, shm, journal].filter(existsSync);
  if (!sidecars.length) return;
  const handles = Bun.spawnSync(["lsof", "-nP", "--", path, ...sidecars], { stdout: "pipe", stderr: "pipe" });
  if (handles.exitCode === 0) throw new Error("DATABASE_OPEN_HANDLE");
  if (handles.exitCode !== 1) throw new Error("DATABASE_OPEN_HANDLE_CHECK_FAILED");
  if (existsSync(journal) || !existsSync(wal) || !existsSync(shm) || statSync(wal).size !== 0) throw new Error("DATABASE_SIDECAR_PRESENT");
  rmSync(wal);
  rmSync(shm);
}

function verifiedArtifact(selected: string, value: ReturnType<typeof config>): Buffer {
  if (!value.backupEncryption || !value.backupDir || !value.databasePath) throw new Error("Encrypted backup configuration is required.");
  const path = resolve(isAbsolute(selected) ? selected : join(value.backupDir, selected));
  if (dirname(path) !== resolve(value.backupDir) || !backupName.test(basename(path)) ||
    !existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error("Backup must be an encrypted artifact in the canonical backup directory.");
  const manifestPath = `${path}.meta.json`;
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) throw new Error("BACKUP_MANIFEST_INVALID");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const encrypted = readFileSync(path);
  if (manifest.encrypted !== true || manifest.algorithm !== "aes-256-gcm" ||
    manifest.filename !== basename(path) || manifest.source_db_path !== basename(value.databasePath) ||
    manifest.sha256 !== backupSha256(encrypted) || !isEncryptedBackup(encrypted)) throw new Error("BACKUP_VERIFICATION_FAILED");
  const plaintext = decryptBackup(encrypted, value.backupEncryption);
  if (manifest.plaintext_sha256 !== backupSha256(plaintext)) throw new Error("BACKUP_VERIFICATION_FAILED");
  return plaintext;
}

function restoreDisposable(selected: string, targetDir: string): void {
  if (!process.env.OPERATOROS_DATA_DIR || !isAbsolute(targetDir)) throw new Error("Explicit source and disposable data directories are required.");
  const value = config();
  const target = resolveOperatorOSPaths({ repositoryRoot: root, env: { OPERATOROS_DATA_DIR: targetDir } });
  if (!value.dataPaths || !target.dataDir.startsWith(`${tmpdir()}/`) ||
    !existsSync(target.dataDir) || !lstatSync(target.dataDir).isDirectory() ||
    target.dataDir === value.dataPaths.dataDir || realpathSync(target.dataDir) === realpathSync(value.dataPaths.dataDir) ||
    target.dataDir.startsWith(`${value.dataPaths.dataDir}/`) || value.dataPaths.dataDir.startsWith(`${target.dataDir}/`) ||
    lstatSync(target.dataDir).isSymbolicLink() || readdirSync(target.dataDir).length > 0) {
    throw new Error("DISPOSABLE_RESTORE_TARGET_INVALID");
  }
  const plaintext = verifiedArtifact(selected, value);
  chmodSync(target.dataDir, 0o700);
  let created = false;
  try {
    writeFileSync(target.databasePath, plaintext, { flag: "wx", mode: 0o600 });
    created = true;
    const database = openOfflineSnapshot(target.databasePath);
    try {
      if ((database.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok" ||
        database.query("PRAGMA foreign_key_check").all().length) throw new Error("DISPOSABLE_RESTORE_INTEGRITY_FAILED");
    } finally { database.close(); }
  } catch (error) {
    if (created) for (const suffix of ["", "-wal", "-shm"]) rmSync(`${target.databasePath}${suffix}`, { force: true });
    throw error;
  }
  console.log(`RESTORED_DISPOSABLE ${target.dataDir}`);
}

function migrateVerifiedExisting(selected: string, targetDir: string): void {
  if (process.env.OPERATOROS_MIGRATION_LOCKED !== "1") throw new Error("MIGRATION_LOCK_REQUIRED");
  if (!process.env.OPERATOROS_DATA_DIR || !isAbsolute(targetDir)) throw new Error("Explicit development data directory is required.");
  const value = config();
  if (!value.dataPaths || value.dataPaths.dataDir !== resolve(targetDir) || !value.databasePath) throw new Error("MIGRATION_TARGET_MISMATCH");
  const path = value.databasePath;
  const plaintext = verifiedArtifact(selected, value);
  const manifestPath = resolve(value.backupDir!, `${basename(selected)}.meta.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const age = Date.now() - Date.parse(manifest.created_at);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000) throw new Error("FRESH_BACKUP_REQUIRED");
  clearOrphanedEmptyWal(path);
  const database = openOfflineSnapshot(path);
  let current: Uint8Array;
  try { current = database.serialize(); } finally { database.close(); }
  if (backupSha256(current) !== backupSha256(plaintext)) throw new Error("BACKUP_SOURCE_MISMATCH");
  console.log(`${migrateExistingDatabase(path)} 20260929_s47`);
}

function nextFilename(directory: string): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const base = `backup_${stamp}.sqlite3`;
  for (let index = 0; ; index++) { const value = index ? base.replace(".sqlite3", `_${index}.sqlite3`) : base; if (!exists(join(directory, value)) && !exists(join(directory, `${value}.meta.json`))) return value; }
}

function backup(): void {
  const value = config();
  if (!value.backupEncryption) throw new Error("BACKUP_ENCRYPTION_KEY is required. Plaintext backups are disabled.");
  const databasePath = value.databasePath;
  const backupDir = value.backupDir;
  if (!databasePath || !backupDir) throw new Error("Canonical SQLite paths are unavailable.");
  if (!exists(databasePath)) throw new Error("SQLite database file not found.");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 }); chmodSync(backupDir, 0o700);
  const directory = mkdtempSync(join(backupDir, ".operatoros-backup-cli-")); chmodSync(directory, 0o700);
  const name = nextFilename(backupDir);
  try {
    clearOrphanedEmptyWal(databasePath);
    const database = openOfflineSnapshot(databasePath); const plaintext = database.serialize(); database.close();
    const encrypted = encryptBackup(plaintext, value.backupEncryption);
    const metadata = { filename: name, created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), trigger: "manual", schema_version: "unknown", sqlite_file_size_bytes: plaintext.length, backup_file_size_bytes: encrypted.length, sha256: backupSha256(encrypted), plaintext_sha256: backupSha256(plaintext), encrypted: true, format_version: 1, algorithm: "aes-256-gcm", key_id: value.backupEncryption.activeKeyId, source_db_path: basename(databasePath), backup_tool_version: "1.0" };
    const artifact = join(directory, name); const manifest = join(directory, `${name}.meta.json`);
    writeFileSync(artifact, encrypted, { mode: 0o600 }); writeFileSync(manifest, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    renameSync(artifact, join(backupDir, name)); renameSync(manifest, join(backupDir, `${name}.meta.json`));
    console.log(`Encrypted backup completed: ${join(backupDir, name)}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function restore(selected: string): void {
  const value = config();
  if (!value.backupEncryption) throw new Error("BACKUP_ENCRYPTION_KEY is required for backup restore.");
  const databasePath = value.databasePath;
  const backupDir = value.backupDir;
  if (!databasePath || !backupDir) throw new Error("Canonical SQLite paths are unavailable.");
  const path = resolve(isAbsolute(selected) ? selected : join(backupDir, selected));
  if (resolve(dirname(path)) !== resolve(backupDir)) throw new Error("Backup must be selected from the canonical backup directory.");
  if (!backupName.test(basename(path)) || !exists(path)) throw new Error("Invalid encrypted backup file.");
  const artifact = readFileSync(path);
  const plaintext = isEncryptedBackup(artifact) ? decryptBackup(artifact, value.backupEncryption) : value.backupEncryption.allowLegacyPlaintext ? artifact : (() => { throw new Error("Legacy plaintext backups require explicit operator opt-in."); })();
  const directory = mkdtempSync(join(tmpdir(), "operatoros-restore-cli-")); chmodSync(directory, 0o700);
  const candidate = join(directory, "candidate.sqlite"); const target = `${databasePath}.${process.pid}.restore`;
  try {
    writeFileSync(candidate, plaintext, { mode: 0o600 }); const database = new Database(candidate, { readonly: true }); database.close();
    writeFileSync(target, plaintext, { mode: 0o600 }); renameSync(target, databasePath); console.log(`SQLite restore completed: ${databasePath}`);
  } finally { rmSync(directory, { recursive: true, force: true }); rmSync(target, { force: true }); }
}

const [action, selected, targetDir] = process.argv.slice(2);
try {
  if (action === "backup") backup();
  else if (action === "restore" && selected) restore(selected);
  else if (action === "restore-disposable" && selected && targetDir) restoreDisposable(selected, targetDir);
  else if (action === "migrate-existing" && selected && targetDir) migrateVerifiedExisting(selected, targetDir);
  else throw new Error("Usage: backup-cli.ts <backup|restore|restore-disposable|migrate-existing> [backup-file] [target-data-dir]");
} catch (error) { console.error(error instanceof Error ? error.message : "Backup operation failed."); process.exit(1); }
