import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { syncDirectory, syncFile } from "./domains/durable-files";
import { pathToFileURL } from "node:url";
import { promptHidden } from "./cli/prompt-hidden";
import { Database, constants } from "bun:sqlite";
import { compareSchemaVersions, CURRENT_SCHEMA_VERSION, migrateExistingDatabase, openDatabase, PROTECTED_DATABASE_BASENAME, resolveOperatorOSPaths, validateDatabase } from "@operatoros/db";
import { loadConfig, type BackendConfig } from "./config";
import { isFirstAdminSetupRequired, restoreAdministratorCredentialMatches, restoreIdentityEligible, type RestoreAdministratorCredential } from "./auth/admin-state";
import { backupSha256, decryptBackup, encryptBackup, isEncryptedBackup } from "./security/backup-crypto";
import { appendRestoreAudit, restoreAuditReason, type RestoreAuditEvent, type RestoreAuditOutcome } from "./domains/restore-audit";
import { BACKUP_RETENTION_LIMIT, evictBeyondRetention } from "./domains/safety";
import { nodeRestoreFileSystem, performRestoreSwap, type RestoreFileSystem } from "./domains/restore-transaction";
import { BACKUP_OPERATION_LOCK_FILENAME } from "./domains/backup-operation-lock";
import { cleanupInterruptedBackupScratch } from "./domains/backup-scratch";

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

function verifiedArtifact(selected: string, value: ReturnType<typeof config>, artifact?: Buffer): { plaintext: Buffer; schemaVersion: string; createdAt: string } {
  if (!value.backupEncryption || !value.backupDir || !value.databasePath) throw new Error("Encrypted backup configuration is required.");
  const path = resolve(isAbsolute(selected) ? selected : join(value.backupDir, selected));
  if (dirname(path) !== resolve(value.backupDir) || !backupName.test(basename(path)) ||
    !existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error("Backup must be an encrypted artifact in the canonical backup directory.");
  const manifestPath = `${path}.meta.json`;
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) throw new Error("BACKUP_MANIFEST_INVALID");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const encrypted = artifact ?? readFileSync(path);
  const envelope = JSON.parse(encrypted.toString("utf8")) as Record<string, unknown>;
  if (manifest.encrypted !== true || manifest.algorithm !== "aes-256-gcm" ||
    manifest.format_version !== envelope.version || manifest.key_id !== envelope.keyId || manifest.algorithm !== envelope.algorithm ||
    manifest.filename !== basename(path) || manifest.source_db_path !== basename(value.databasePath) ||
    typeof manifest.created_at !== "string" || !Number.isFinite(Date.parse(manifest.created_at)) ||
    !["manual", "scheduled", "pre_restore_auto"].includes(manifest.trigger) ||
    typeof manifest.schema_version !== "string" || !manifest.schema_version ||
    manifest.sha256 !== backupSha256(encrypted) || !isEncryptedBackup(encrypted)) throw new Error("BACKUP_VERIFICATION_FAILED");
  const plaintext = decryptBackup(encrypted, value.backupEncryption);
  if (manifest.backup_file_size_bytes !== encrypted.length || manifest.sqlite_file_size_bytes !== plaintext.length ||
    manifest.plaintext_sha256 !== backupSha256(plaintext)) throw new Error("BACKUP_VERIFICATION_FAILED");
  return { plaintext, schemaVersion: manifest.schema_version, createdAt: manifest.created_at };
}

function restoreDisposable(selected: string, targetDir: string): void {
  if (!process.env.OPERATOROS_DATA_DIR || !isAbsolute(targetDir)) throw new Error("Explicit source and disposable data directories are required.");
  const value = config();
  const target = resolveOperatorOSPaths({ repositoryRoot: root, env: { OPERATOROS_DATA_DIR: targetDir } });
  if (!value.dataPaths || !target.dataDir.startsWith(`${tmpdir()}${sep}`) ||
    !existsSync(target.dataDir) || !lstatSync(target.dataDir).isDirectory() ||
    lstatSync(target.dataDir).isSymbolicLink() || readdirSync(target.dataDir).length > 0) {
    throw new Error("DISPOSABLE_RESTORE_TARGET_INVALID");
  }
  const targetRoot = realpathSync(target.dataDir);
  const sourceRoot = realpathSync(value.dataPaths.dataDir);
  const temporaryRoot = realpathSync(tmpdir());
  if (!targetRoot.startsWith(`${temporaryRoot}${sep}`) || targetRoot === sourceRoot ||
    targetRoot.startsWith(`${sourceRoot}${sep}`) || sourceRoot.startsWith(`${targetRoot}${sep}`)) {
    throw new Error("DISPOSABLE_RESTORE_TARGET_INVALID");
  }
  const { plaintext, schemaVersion } = verifiedArtifact(selected, value);
  chmodSync(target.dataDir, 0o700);
  let created = false;
  try {
    writeFileSync(target.databasePath, plaintext, { flag: "wx", mode: 0o600 });
    created = true;
    const database = openOfflineSnapshot(target.databasePath);
    try {
      validateDatabase(database);
      if (snapshotSchemaVersion(database) !== schemaVersion) throw new Error("BACKUP_VERIFICATION_FAILED");
    } finally { database.close(); }
    syncFile(target.databasePath);
    syncDirectory(target.dataDir);
  } catch (error) {
    if (created) {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${target.databasePath}${suffix}`, { force: true });
      try { syncDirectory(target.dataDir); } catch { /* disposable files are not an active recovery source */ }
    }
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
  const { plaintext, schemaVersion, createdAt } = verifiedArtifact(selected, value);
  const age = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000) throw new Error("FRESH_BACKUP_REQUIRED");
  clearOrphanedEmptyWal(path);
  const database = openOfflineSnapshot(path);
  let current: Uint8Array;
  try {
    if (snapshotSchemaVersion(database) !== schemaVersion) throw new Error("BACKUP_VERIFICATION_FAILED");
    current = database.serialize();
  } finally { database.close(); }
  if (backupSha256(current) !== backupSha256(plaintext)) throw new Error("BACKUP_SOURCE_MISMATCH");
  console.log(`${migrateExistingDatabase(path)} ${CURRENT_SCHEMA_VERSION}`);
}

function nextFilename(directory: string): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const base = `backup_${stamp}.sqlite3`;
  for (let index = 0; ; index++) { const value = index ? base.replace(".sqlite3", `_${index}.sqlite3`) : base; if (!exists(join(directory, value)) && !exists(join(directory, `${value}.meta.json`))) return value; }
}

function snapshotSchemaVersion(database: Database): string {
  const versions = (database.query("SELECT version FROM operatoros_schema_migrations").all() as { version: string }[]).map((value) => String(value.version));
  return versions.reduce((latest, version) => {
    const order = compareSchemaVersions(version, latest);
    return order === 1 || order === undefined && version > latest ? version : latest;
  }, versions[0] ?? CURRENT_SCHEMA_VERSION);
}

function validateRestoreSnapshot(path: string, credential?: RestoreAdministratorCredential, expectedSchemaVersion?: string): string | null {
  const database = openDatabase(path, { readonly: true });
  try {
    if (expectedSchemaVersion && snapshotSchemaVersion(database.client as unknown as Database) !== expectedSchemaVersion) throw new Error("BACKUP_VERIFICATION_FAILED");
    if ((database.client.query("PRAGMA quick_check").get() as { quick_check?: string } | null)?.quick_check !== "ok") throw new Error("RESTORE_QUICK_CHECK_FAILED");
    if (!restoreIdentityEligible(database.client as unknown as Database)) throw new Error("RESTORE_ADMINISTRATOR_REQUIRED");
    const firstAdminSetupRequired = isFirstAdminSetupRequired(database.client as unknown as Database);
    if (!firstAdminSetupRequired && !restoreAdministratorCredentialMatches(database.client as unknown as Database, credential?.username, credential?.password)) throw new Error("RESTORE_ADMIN_CREDENTIAL_REQUIRED");
    return firstAdminSetupRequired ? null : credential?.username ?? null;
  } finally { database.close(); }
}

function revokeRestoredSessions(path: string): void {
  const database = openDatabase(path);
  try {
    database.client.run("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL");
    if (database.client.query("SELECT 1 FROM sessions WHERE revoked_at IS NULL LIMIT 1").get()) throw new Error("RESTORE_SESSION_REVOCATION_FAILED");
  } finally { database.close(); }
}

function assertRestoredSessionsRevoked(database: Database): void {
  if (database.query("SELECT 1 FROM sessions WHERE revoked_at IS NULL LIMIT 1").get()) throw new Error("RESTORE_SESSION_REVOCATION_FAILED");
}

function hasPendingRestoreRollback(path: string): boolean {
  const prefix = `${basename(path)}.`;
  return readdirSync(dirname(path)).some((name) => name.startsWith(prefix) && name.endsWith(".rollback"));
}

function audit(root: string, event: string, values: Record<string, unknown> = {}): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = `${root}/backup_operations_audit.jsonl`;
  appendFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), event, tool: "backup-cli", ...values })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function recordRestoreEvent(root: string, event: RestoreAuditEvent, outcome: RestoreAuditOutcome, filename: string, actor: string | null, operationId: string, safety: { filename: string } | null, reason: string | null): void {
  try { appendRestoreAudit(root, { event, outcome, target_filename: filename, authenticated_username: actor, operation_id: operationId, pre_restore_snapshot_filename: safety?.filename ?? null, reason }); }
  catch { console.error(`WARN: CLI ${event} could not be written to recovery history.`); }
}

function recordRestoreFailure(root: string, filename: string, actor: string | null, operationId: string, safety: { filename: string } | null, rollbackOutcome: string | undefined, restoreStarted: boolean, error: unknown): void {
  const reason = restoreAuditReason(error);
  try { audit(root, "restore_failed", { filename, operation_id: operationId, reason, ...(rollbackOutcome ? { rollback_outcome: rollbackOutcome } : {}) }); }
  catch { console.error("WARN: CLI restore failure could not be written to the operations audit."); }
  const event = !restoreStarted ? "restore_denied" : rollbackOutcome === "rolled_back" ? "restore_rolled_back" : "restore_failed";
  const outcome = event === "restore_denied" ? "DENIED" : event === "restore_rolled_back" ? "ROLLED_BACK" : "FAILED";
  recordRestoreEvent(root, event, outcome, filename, actor, operationId, safety, reason);
}

function recordRestoreCliRefusal(root: string, selected: string | undefined, reason: string): void {
  const filename = backupName.test(basename(selected ?? "")) ? basename(selected!) : "unknown";
  const operationId = randomUUID();
  recordRestoreEvent(root, "restore_requested", "REQUESTED", filename, null, operationId, null, null);
  recordRestoreFailure(root, filename, null, operationId, null, undefined, false, new Error(reason));
}

/** Single encrypted-artifact pipeline shared by `backup` and by the pre-restore safety snapshot. `pre_restore_auto` marks snapshots taken automatically before a CLI restore. */
function publishBackup(value: ReturnType<typeof config>, trigger: "manual" | "pre_restore_auto", preserve?: string): { filename: string; path: string } {
  if (!value.backupEncryption) throw new Error("BACKUP_ENCRYPTION_KEY is required. Plaintext backups are disabled.");
  const databasePath = value.databasePath;
  const backupDir = value.backupDir;
  if (!databasePath || !backupDir) throw new Error("Canonical SQLite paths are unavailable.");
  if (!exists(databasePath)) throw new Error("SQLite database file not found.");
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const started = Date.now();
  mkdirSync(backupDir, { recursive: true, mode: 0o700 }); chmodSync(backupDir, 0o700);
  syncDirectory(dirname(backupDir));
  const directory = mkdtempSync(join(backupDir, ".operatoros-backup-cli-")); chmodSync(directory, 0o700);
  const name = nextFilename(backupDir);
  try {
    clearOrphanedEmptyWal(databasePath);
    const database = openOfflineSnapshot(databasePath);
    let plaintext: Uint8Array;
    let schemaVersion: string;
    try {
      validateDatabase(database);
      if ((database.query("PRAGMA quick_check").get() as { quick_check?: string } | null)?.quick_check !== "ok") throw new Error("BACKUP_QUICK_CHECK_FAILED");
      schemaVersion = snapshotSchemaVersion(database);
      plaintext = database.serialize();
    } finally { database.close(); }
    const encrypted = encryptBackup(plaintext, value.backupEncryption);
    const metadata = { filename: name, created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), trigger, schema_version: schemaVersion, sqlite_file_size_bytes: plaintext.length, backup_file_size_bytes: encrypted.length, sha256: backupSha256(encrypted), plaintext_sha256: backupSha256(plaintext), encrypted: true, format_version: 1, algorithm: "aes-256-gcm", key_id: value.backupEncryption.activeKeyId, source_db_path: basename(databasePath), backup_tool_version: "1.0" };
    const artifact = join(directory, name); const manifest = join(directory, `${name}.meta.json`);
    writeFileSync(artifact, encrypted, { mode: 0o600 }); writeFileSync(manifest, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    syncFile(artifact); syncFile(manifest);
    renameSync(artifact, join(backupDir, name)); renameSync(manifest, join(backupDir, `${name}.meta.json`));
    syncDirectory(directory);
    syncDirectory(backupDir);
    let removedBackups: string[] = [];
    try { removedBackups = evictBeyondRetention(backupDir, name, preserve); }
    catch (error) { try { audit(backupDir, "backup_retention_failed", { error: error instanceof Error ? error.constructor.name : "Error", retention_limit: BACKUP_RETENTION_LIMIT }); } catch { /* retention must not fail the published backup */ } }
    try { syncDirectory(backupDir); }
    catch (error) { try { audit(backupDir, "backup_retention_failed", { error: error instanceof Error ? error.constructor.name : "Error", retention_limit: BACKUP_RETENTION_LIMIT }); } catch { /* retention must not fail the published backup */ } }
    try { audit(backupDir, "backup_succeeded", { filename: name, trigger, started_at: startedAt, completed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), duration_seconds: (Date.now() - started) / 1000, size_bytes: encrypted.length, checksum: metadata.sha256, integrity_verified: true, removed_backups: removedBackups }); } catch { console.error("WARN: backup completed but the operations audit line could not be written."); }
    return { filename: name, path: join(backupDir, name) };
  } catch (error) {
    try { audit(backupDir, "backup_failed", { error: error instanceof Error ? error.constructor.name : "Error", failure_code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : error instanceof Error ? error.constructor.name : "Error", trigger, started_at: startedAt, completed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), duration_seconds: (Date.now() - started) / 1000 }); } catch { /* audit failure must not mask the backup error */ }
    throw error;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function backup(): void {
  const published = publishBackup(config(), "manual");
  console.log(`Encrypted backup completed: ${published.path}`);
}

export function restore(selected: string, value: BackendConfig = config(), fileSystem: RestoreFileSystem = nodeRestoreFileSystem, credential?: RestoreAdministratorCredential): void {
  const databasePath = value.databasePath;
  const backupDir = value.backupDir;
  const operationId = randomUUID();
  let actor: string | null = null;
  const requestedFilename = backupName.test(basename(selected)) ? basename(selected) : "unknown";
  if (backupDir) recordRestoreEvent(backupDir, "restore_requested", "REQUESTED", requestedFilename, actor, operationId, null, null);
  let label = "unknown";
  let directory: string | null = null;
  let safety: { filename: string; path: string } | null = null;
  let rollbackOutcome: string | undefined;
  let restoreStarted = false;
  let completed = false;
  try {
    if (!value.backupEncryption) throw new Error("BACKUP_ENCRYPTION_KEY is required for backup restore.");
    if (!databasePath || !backupDir) throw new Error("Canonical SQLite paths are unavailable.");
    if (credential && (!credential.username || credential.username.trim() !== credential.username || credential.username.length > 255)) throw new Error("RESTORE_ADMIN_CREDENTIAL_REQUIRED");
    if (hasPendingRestoreRollback(databasePath)) throw new Error("RESTORE_RECOVERY_PENDING: inspect the existing rollback database before retrying.");
    const path = resolve(isAbsolute(selected) ? selected : join(backupDir, selected));
    if (resolve(dirname(path)) !== resolve(backupDir)) throw new Error("Backup must be selected from the canonical backup directory.");
    if (!backupName.test(basename(path)) || !exists(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error("Invalid encrypted backup file.");
    label = basename(path);
    const artifact = readFileSync(path);
    const verified = isEncryptedBackup(artifact) ? verifiedArtifact(label, value, artifact) : null;
    if (!verified && !value.backupEncryption.allowLegacyPlaintext) throw new Error("Legacy plaintext backups require explicit operator opt-in.");
    const plaintext = verified?.plaintext ?? artifact;
    directory = mkdtempSync(join(dirname(databasePath), ".operatoros-restore-cli-")); chmodSync(directory, 0o700);
    const target = join(directory, `${randomUUID()}.candidate`);
    writeFileSync(target, plaintext, { flag: "wx", mode: 0o600 });
    actor = validateRestoreSnapshot(target, credential, verified?.schemaVersion);
    revokeRestoredSessions(target);
    safety = exists(databasePath) ? publishBackup(value, "pre_restore_auto", label) : null;
    restoreStarted = true;
    recordRestoreEvent(backupDir, "restore_started", "STARTED", label, actor, operationId, safety, null);
    if (safety) {
      let opened: ReturnType<typeof openDatabase> | null = null;
      const close = () => { opened?.close(); opened = null; };
      const swap = performRestoreSwap({
        active: databasePath,
        candidate: target,
        rollback: `${databasePath}.${randomUUID()}.rollback`,
        fileSystem,
        close,
        reopen: () => { opened = openDatabase(databasePath, { readonly: true }); },
        afterSwap: () => {
          if ((opened?.client.query("PRAGMA quick_check").get() as { quick_check?: string } | null)?.quick_check !== "ok") throw new Error("RESTORE_QUICK_CHECK_FAILED");
          if (!opened || !restoreIdentityEligible(opened.client as unknown as Database)) throw new Error("RESTORE_ADMINISTRATOR_REQUIRED");
          if (verified?.schemaVersion && snapshotSchemaVersion(opened.client as unknown as Database) !== verified.schemaVersion) throw new Error("BACKUP_VERIFICATION_FAILED");
          if (!isFirstAdminSetupRequired(opened.client as unknown as Database) && !restoreAdministratorCredentialMatches(opened.client as unknown as Database, credential?.username, credential?.password)) throw new Error("RESTORE_ADMIN_CREDENTIAL_REQUIRED");
          assertRestoredSessionsRevoked(opened.client as unknown as Database);
          close();
        },
      });
      rollbackOutcome = swap.outcome;
      if (swap.outcome !== "committed") {
        close();
        const reason = swap.error instanceof Error ? ` ${swap.error.message}` : "";
        throw new Error(swap.outcome === "recovery_required"
          ? `RESTORE_RECOVERY_REQUIRED: automatic rollback could not be verified; preserve the remaining database files for operator recovery.${reason}`
          : `RESTORE_ROLLED_BACK: active database was preserved.${reason}`);
      }
    } else {
      fileSystem.syncFile(target);
      linkSync(target, databasePath);
      try {
        fileSystem.syncDirectory(dirname(databasePath));
        validateRestoreSnapshot(databasePath, credential, verified?.schemaVersion);
        const restored = openDatabase(databasePath, { readonly: true });
        try { assertRestoredSessionsRevoked(restored.client as unknown as Database); } finally { restored.close(); }
      }
      catch (error) {
        try { fileSystem.remove(databasePath); fileSystem.syncDirectory(dirname(databasePath)); }
        catch { throw new Error("RESTORE_RECOVERY_REQUIRED: no prior database existed and the failed candidate could not be durably removed."); }
        throw error;
      }
    }
    completed = true;
    console.log(`Pre-restore safety snapshot: ${safety ? safety.path : "none (no active database to preserve)"}`);
    console.log(`SQLite restore completed: ${databasePath}`);
    try { audit(backupDir, "restore_completed", { filename: label, operation_id: operationId, safety_backup_filename: safety ? safety.filename : null }); }
    catch { console.error("WARN: restore completed but the operations audit line could not be written."); }
    try { appendRestoreAudit(backupDir, { event: "restore_completed", outcome: "COMPLETED", target_filename: label, authenticated_username: actor, operation_id: operationId, pre_restore_snapshot_filename: safety ? safety.filename : null, reason: null }); }
    catch { console.error("WARN: restore completed but the recovery-history line could not be written."); }
  } catch (error) {
    if (!completed && backupDir) recordRestoreFailure(backupDir, label, actor, operationId, safety, rollbackOutcome, restoreStarted, error);
    throw error;
  } finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
}

export async function runBackupCli(args: string[]): Promise<void> {
  const [action, selected, targetDir] = args;
  try {
    if (["backup", "restore", "restore-disposable", "migrate-existing"].includes(action ?? "")) {
      const value = config();
      if (!value.databasePath || !value.backupDir) throw new Error("Canonical SQLite paths are unavailable.");
      try { cleanupInterruptedBackupScratch(value.databasePath, value.backupDir); }
      catch (error) {
        if (action === "restore" && value.backupDir) recordRestoreCliRefusal(value.backupDir, selected, "RESTORE_STALE_CANDIDATE_CLEANUP_FAILED");
        if (action === "backup" && value.backupDir) {
          const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
          try { audit(value.backupDir, "backup_failed", { failure_code: "BACKUP_CLI_RESTORE_CANDIDATE_CLEANUP_FAILED", trigger: "manual", started_at: at, completed_at: at }); }
          catch { /* cleanup failure must not mask the original error */ }
        }
        throw error;
      }
    }
    if (action === "backup") backup();
    else if (action === "restore" && selected) {
      const usernameIndex = args.indexOf("--admin-user");
      const username = usernameIndex >= 0 ? args[usernameIndex + 1] : undefined;
      const validUsername = Boolean(username && username.trim() === username && username.length <= 255);
      const password = validUsername ? await promptHidden(`Password for backup administrator '${username}': `) : "";
      restore(selected, config(), nodeRestoreFileSystem, usernameIndex >= 0 ? { username: username ?? "", password } : undefined);
    }
    else if (action === "restore-disposable" && selected && targetDir) restoreDisposable(selected, targetDir);
    else if (action === "migrate-existing" && selected && targetDir) migrateVerifiedExisting(selected, targetDir);
    else throw new Error("Usage: backup-cli.ts backup | restore <backup-file> [--admin-user <username>] | restore-disposable <backup-file> <empty-data-dir> | migrate-existing <backup-file> <data-dir>");
  } catch (error) { console.error(error instanceof Error ? error.message : "Backup operation failed."); process.exit(1); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [action, selected] = args;
  if (["backup", "restore", "restore-disposable", "migrate-existing"].includes(args[0] ?? "")) {
    let value: ReturnType<typeof config> | undefined;
    try {
      value = config();
      if (!value.dataPaths) throw new Error("Canonical data paths are unavailable.");
      const lockPath = join(value.dataPaths.dataDir, BACKUP_OPERATION_LOCK_FILENAME);
      const lockStat = lstatSync(lockPath, { throwIfNoEntry: false });
      if (lockStat && !lockStat.isFile()) throw new Error("BACKUP_CLI_LOCK_INVALID");
      writeFileSync(lockPath, "", { flag: "a", mode: 0o600 });
      chmodSync(lockPath, 0o600);
      const runner = join(import.meta.dir, "backup-cli-runner.ts");
      const result = Bun.spawnSync([
        "flock", "--nonblock", "--exclusive", "--conflict-exit-code", "75", lockPath,
        process.execPath, runner, ...args,
      ], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
      if (result.exitCode === 75) {
        if (action === "restore") recordRestoreCliRefusal(value.backupDir!, selected, "RESTORE_CLI_OPERATION_BUSY");
        else if (action === "backup") {
          const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
          try { audit(value.backupDir!, "backup_failed", { failure_code: "BACKUP_CLI_OPERATION_BUSY", trigger: "manual", started_at: at, completed_at: at }); }
          catch { /* a busy CLI operation must not proceed without the lock */ }
        }
        console.error("Another backup or restore operation is already active for this data root.");
        process.exit(1);
      }
      if (result.exitCode === 127) {
        if (action === "restore") recordRestoreCliRefusal(value.backupDir!, selected, "RESTORE_CLI_LOCK_UNAVAILABLE");
        else if (action === "backup") {
          const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
          try { audit(value.backupDir!, "backup_failed", { failure_code: "BACKUP_CLI_LOCK_UNAVAILABLE", trigger: "manual", started_at: at, completed_at: at }); }
          catch { /* lock failure must fail closed */ }
        }
        console.error("BACKUP_CLI_LOCK_UNAVAILABLE: flock is required for backup operations.");
        process.exit(1);
      }
      if (result.stdout.length) process.stdout.write(result.stdout);
      if (result.stderr.length) process.stderr.write(result.stderr);
      process.exit(result.exitCode ?? 1);
    } catch (error) {
      const lockFailure = error instanceof Error && error.message === "BACKUP_CLI_LOCK_INVALID" ? "INVALID" : "UNAVAILABLE";
      if (value && action === "restore") recordRestoreCliRefusal(value.backupDir!, selected, `RESTORE_CLI_LOCK_${lockFailure}`);
      if (value && action === "backup") {
        const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
        try { audit(value.backupDir!, "backup_failed", { failure_code: `BACKUP_CLI_LOCK_${lockFailure}`, trigger: "manual", started_at: at, completed_at: at }); }
        catch { /* lock failure must fail closed */ }
      }
      console.error(error instanceof Error ? error.message : "Backup operation failed.");
      process.exit(1);
    }
  }
  void runBackupCli(args);
}
