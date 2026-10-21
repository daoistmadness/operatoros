import { randomUUID } from "node:crypto";
import { accessSync, constants, appendFileSync, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { t } from "elysia";
import { actor } from "./core";
import type { AuthContext } from "../auth/service";
import { isFirstAdminSetupRequired, restoreAdministratorCredentialMatches, restoreIdentityState } from "../auth/admin-state";
import { compareSchemaVersions, CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION, PROTECTED_DATABASE_BASENAME, schemaFingerprint } from "@operatoros/db";
import { BACKUP_ENVELOPE_VERSION, BACKUP_ENCRYPTION_ALGORITHM, backupSha256, decryptBackup, encryptBackup, isEncryptedBackup, type BackupEncryptionConfig } from "../security/backup-crypto";
import { appendRestoreAudit } from "./restore-audit";
import { performRestoreSwap, type RestoreFileSystem } from "./restore-transaction";

type Row = Record<string, any>;
type Context = any;
/** Filesystem capacity probe seam: bytes available to the service user (`availableBytes`) and free bytes (`freeBytes`) for the filesystem hosting the resolved path. */
export type DiskSpaceProbe = (resolvedPath: string) => { availableBytes: number; freeBytes: number };
export type SafetyConfig = { backupDir: string; destructiveOperationsEnabled: boolean; backupEncryption?: BackupEncryptionConfig | null; diskSpaceProbe?: DiskSpaceProbe | null; restoreFileSystem?: RestoreFileSystem | null };

/** Stable refusal codes for the backup free-space preflight. The HTTP detail string is `"<CODE>: <message>"`. */
export const BACKUP_LOW_DISK_SPACE = "BACKUP_LOW_DISK_SPACE";
export const BACKUP_DISK_SPACE_PROBE_FAILED = "BACKUP_DISK_SPACE_PROBE_FAILED";
/** Conservative floor for the preflight minimum on small or empty databases (about 2.95 MiB). */
export const BACKUP_MINIMUM_SPACE_FLOOR_BYTES = 3_088_384;
/** Count-based retention: keep the newest N complete backup generations. The newest backup and a backup selected for restore are never eviction candidates. */
export const BACKUP_RETENTION_LIMIT = 10;

const REQUIRED_TABLES = ["attendance", "attendance_override_history", "student_enrollments"];
const backupFile = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$/;
let backupBusy = false;
let restoreBusy = false;

function now(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
function dbPath(context: AuthContext): string { return context.database.path; }
function backupRoot(config: SafetyConfig): string {
  if (config.backupDir.split(/[\\/]/).includes("..")) throw new Error("BACKUP_DIR must not contain path traversal segments.");
  const path = resolve(config.backupDir);
  if (basename(path) === PROTECTED_DATABASE_BASENAME) throw new Error("BACKUP_DIR cannot be the protected database.");
  return path;
}
function ensureRoot(config: SafetyConfig): string { const path = backupRoot(config); mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); return path; }
function sha256(path: string): string { return backupSha256(readFileSync(path)); }
function rows(context: AuthContext, sql: string, params: any[] = []): Row[] { return context.database.client.query(sql).all(...params) as Row[]; }
function row(context: AuthContext, sql: string, params: any[] = []): Row | null { return (context.database.client.query(sql).get(...params) as Row | null) ?? null; }
function fail(set: any, status: number, detail: unknown): { detail: unknown } { set.status = status; return { detail }; }
function auth(context: AuthContext, ctx: Context): any { return actor(context, ctx, { role: "admin", refreshSession: false }); }
function denied(ctx: Context): { detail: string } { return { detail: ctx.set.status === 401 ? "Authentication required" : "Insufficient permissions" }; }
function regularFile(path: string): boolean { try { return lstatSync(path).isFile(); } catch { return false; } }

function audit(root: string, event: string, values: Record<string, unknown> = {}): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = `${root}/backup_operations_audit.jsonl`;
  appendFileSync(path, `${JSON.stringify({ timestamp: now(), event, ...values })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
function assertOperationsAuditWritable(root: string): void {
  const path = `${root}/backup_operations_audit.jsonl`;
  appendFileSync(path, "", { mode: 0o600 });
  chmodSync(path, 0o600);
}

function dbSchemaVersion(database: Database): string {
  return String((database.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").get() as Row | null)?.version ?? CURRENT_SCHEMA_VERSION);
}

/** Scheduler next run time for the status payload: null when no schedule row exists, the scheduler is disabled, or no run time has been computed yet. */
function scheduledNextRunAt(context: AuthContext): string | null {
  try {
    const value = row(context, "SELECT enabled, next_run_at FROM backup_scheduler_config WHERE id = 1");
    return value?.enabled && value.next_run_at ? String(value.next_run_at) : null;
  } catch { return null; }
}

/** Live SQLite journal mode of the active connection; fail-safe "unknown" when the pragma cannot be read. */
function activeJournalMode(context: AuthContext): string {
  try { return String((context.database.client.query("PRAGMA journal_mode").get() as Row | null)?.journal_mode ?? "unknown"); } catch { return "unknown"; }
}

function inspectDatabase(path: string, checkRestoreIdentity = true): { integrity: string; quick: string; schemaValid: boolean; foreignKeyViolationCount: number | null; tables: Set<string>; counts: Record<string, number | null>; schema: string; identityCompatible: boolean; restoreIdentityEligible: boolean | null; restoreIdentityBlockingReason: string | null } {
  const database = new Database(path, { readonly: true });
  try {
    const integrity = String((database.query("PRAGMA integrity_check").get() as Row | null)?.integrity_check ?? "");
    const quick = String((database.query("PRAGMA quick_check").get() as Row | null)?.quick_check ?? "");
    let foreignKeyViolationCount: number | null;
    try { foreignKeyViolationCount = database.query("PRAGMA foreign_key_check").all().length; }
    catch { foreignKeyViolationCount = null; }
    const migrations = database.query("SELECT version, schema_fingerprint FROM operatoros_schema_migrations").all() as Row[];
    const currentMigration = migrations.find((value) => value.version === CURRENT_SCHEMA_VERSION);
    const schemaValid = currentMigration?.schema_fingerprint === CURRENT_SCHEMA_FINGERPRINT &&
      !migrations.some((value) => compareSchemaVersions(String(value.version), CURRENT_SCHEMA_VERSION) === 1) &&
      schemaFingerprint(database) === CURRENT_SCHEMA_FINGERPRINT;
    const objects = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[];
    const tables = new Set(objects.map((value) => String(value.name)));
    const counts: Record<string, number | null> = {};
    for (const [key, table] of Object.entries({ students: "students", attendance: "attendance", enrollments: "student_enrollments" })) {
      try { counts[key] = tables.has(table) ? Number((database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count) : null; }
      catch { counts[key] = null; }
    }
    const userColumns = new Set((database.query("PRAGMA table_info(users)").all() as Row[]).map((value) => String(value.name)));
    const sessionColumns = new Set((database.query("PRAGMA table_info(sessions)").all() as Row[]).map((value) => String(value.name)));
    const identityCompatible = ["id", "username", "password_hash", "role", "is_active", "failed_login_attempts", "locked_until"].every((value) => userColumns.has(value)) && ["id", "user_id", "token_hash", "created_at", "last_used_at", "expires_at", "absolute_expires_at", "revoked_at"].every((value) => sessionColumns.has(value));
    const restoreIdentity = checkRestoreIdentity ? restoreIdentityState(database) : null;
    return { integrity, quick, schemaValid, foreignKeyViolationCount, tables, counts, schema: dbSchemaVersion(database), identityCompatible, restoreIdentityEligible: restoreIdentity?.eligible ?? null, restoreIdentityBlockingReason: restoreIdentity?.blockingReason ?? null };
  } finally { database.close(); }
}

function validateSnapshot(path: string, sourceTables: Set<string>, checkRestoreIdentity = true): ReturnType<typeof inspectDatabase> {
  const value = inspectDatabase(path, checkRestoreIdentity);
  if (value.integrity !== "ok" || value.quick !== "ok") throw new Error("Backup integrity validation failed.");
  if (value.foreignKeyViolationCount !== 0) throw new Error("Backup foreign-key validation failed.");
  const missing = REQUIRED_TABLES.filter((table) => !value.tables.has(table));
  if (missing.length > 0 || (sourceTables.has("student_subject_grades") && !value.tables.has("student_subject_grades"))) throw new Error(`Backup is missing required operational tables: ${missing.join(", ")}`);
  return value;
}

function nextFilename(root: string): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const base = `backup_${stamp}.sqlite3`;
  const prefix = `backup_${stamp}`;
  let next = 0;
  for (const name of readdirSync(root)) {
    if (name === base || name === `${base}.meta.json`) { next = Math.max(next, 1); continue; }
    if (!name.startsWith(prefix)) continue;
    const suffix = /^_(\d+)\.sqlite3(?:\.meta\.json)?$/.exec(name.slice(prefix.length));
    if (suffix) next = Math.max(next, Number(suffix[1]) + 1);
  }
  return next === 0 ? base : base.replace(".sqlite3", `_${next}.sqlite3`);
}
function statSafe(path: string): boolean { try { statSync(path); return true; } catch { return false; } }

const defaultDiskSpaceProbe: DiskSpaceProbe = (path) => {
  const stats = statfsSync(path);
  return { availableBytes: stats.bsize * stats.bavail, freeBytes: stats.bsize * stats.bfree };
};

function diskSpaceProbeFor(config: SafetyConfig): DiskSpaceProbe { return config.diskSpaceProbe ?? defaultDiskSpaceProbe; }

/** Minimum free bytes required before a backup may start: twice the active database size (the staging directory holds the plaintext snapshot and its encrypted envelope at the same time) with a conservative floor for small databases. */
export function minimumRequiredSpaceBytes(activeDatabasePath: string): number {
  return Math.max(statSafe(activeDatabasePath) ? statSync(activeDatabasePath).size * 2 : 0, BACKUP_MINIMUM_SPACE_FLOOR_BYTES);
}

/** Resolves the nearest existing ancestor of the backup destination so the probe covers the filesystem that will host new output and never an unrelated mount. */
function diskSpaceProbePath(root: string): string {
  let candidate = resolve(root);
  for (;;) {
    try { return realpathSync(candidate); } catch { /* not created yet: keep walking up */ }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Backup destination filesystem could not be resolved.");
    candidate = parent;
  }
}

/** Fails closed (503) when the capacity probe itself fails; refuses (507) when available bytes are below the documented minimum. */
function assertBackupDiskSpace(context: AuthContext, config: SafetyConfig, root: string): void {
  const required = minimumRequiredSpaceBytes(dbPath(context));
  let probe: { availableBytes: number; freeBytes: number };
  try { probe = diskSpaceProbeFor(config)(diskSpaceProbePath(root)); } catch { throw Object.assign(new Error("Backup free-space probe failed; refusing to create a backup."), { status: 503, code: BACKUP_DISK_SPACE_PROBE_FAILED }); }
  if (probe.availableBytes < required) throw Object.assign(new Error(`Insufficient free disk space for backup: ${required} bytes required, ${probe.availableBytes} bytes available.`), { status: 507, code: BACKUP_LOW_DISK_SPACE });
}

function decryptedBackup(config: SafetyConfig, path: string, operation: (path: string, artifact: Buffer) => Row): Row {
  if (!regularFile(path)) throw Object.assign(new Error("Backup artifact is not a regular file."), { status: 404, code: "BACKUP_ARTIFACT_INVALID" });
  const artifact = readFileSync(path);
  if (!config.backupEncryption) throw Object.assign(new Error("BACKUP_ENCRYPTION_KEY is required for backup restore."), { status: 503, code: "BACKUP_ENCRYPTION_KEY_REQUIRED" });
  const directory = mkdtempSync(join(tmpdir(), "operatoros-backup-"));
  chmodSync(directory, 0o700);
  const plaintextPath = join(directory, "snapshot.sqlite");
  try {
    const plaintext = isEncryptedBackup(artifact) ? decryptBackup(artifact, config.backupEncryption) : config.backupEncryption.allowLegacyPlaintext ? artifact : (() => { throw Object.assign(new Error("Legacy plaintext backups require explicit operator opt-in."), { status: 409, code: "LEGACY_PLAINTEXT_BACKUP_REFUSED" }); })();
    writeFileSync(plaintextPath, plaintext, { mode: 0o600 });
    chmodSync(plaintextPath, 0o600);
    return operation(plaintextPath, artifact);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function createBackup(context: AuthContext, config: SafetyConfig, trigger: "manual" | "scheduled" | "pre_restore_auto", preserve?: string): Row {
  if (backupBusy) throw Object.assign(new Error("Another backup execution is already active."), { status: 409 });
  const active = dbPath(context);
  if (basename(active) === PROTECTED_DATABASE_BASENAME) throw new Error("Protected database access is forbidden.");
  const root = backupRoot(config);
  const startedAt = now();
  const started = Date.now();
  backupBusy = true;
  let temporaryDirectory = "";
  try {
    if (!config.backupEncryption) throw Object.assign(new Error("BACKUP_ENCRYPTION_KEY is required. Plaintext backups are disabled."), { status: 503, code: "BACKUP_ENCRYPTION_KEY_REQUIRED" });
    assertBackupDiskSpace(context, config, root);
    ensureRoot(config);
    const filename = nextFilename(root);
    temporaryDirectory = mkdtempSync(join(root, ".operatoros-backup-"));
    chmodSync(temporaryDirectory, 0o700);
    const temporary = join(temporaryDirectory, "snapshot.sqlite");
    const encryptedTemporary = join(temporaryDirectory, "backup.encrypted");
    const metadataTemporary = join(temporaryDirectory, "backup.meta.json");
    context.database.client.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = context.database.client.serialize();
    writeFileSync(temporary, bytes);
    chmodSync(temporary, 0o600);
    const sourceTables = new Set((context.database.client.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((value) => String(value.name)));
    validateSnapshot(temporary, sourceTables, false);
    const encrypted = encryptBackup(readFileSync(temporary), config.backupEncryption);
    writeFileSync(encryptedTemporary, encrypted, { mode: 0o600 });
    chmodSync(encryptedTemporary, 0o600);
    const metadata = { filename, created_at: now(), trigger, schema_version: dbSchemaVersion(context.database.client), sqlite_file_size_bytes: statSync(temporary).size, backup_file_size_bytes: encrypted.length, sha256: backupSha256(encrypted), plaintext_sha256: sha256(temporary), encrypted: true, format_version: 1, algorithm: "aes-256-gcm", key_id: config.backupEncryption.activeKeyId, source_db_path: basename(active), backup_tool_version: "1.0" };
    writeFileSync(metadataTemporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    chmodSync(metadataTemporary, 0o600);
    renameSync(encryptedTemporary, `${root}/${filename}`);
    renameSync(metadataTemporary, `${root}/${filename}.meta.json`);
    let removedBackups: string[] = [];
    try { removedBackups = evictBeyondRetention(root, filename, preserve); }
    catch (error) { try { audit(root, "backup_retention_failed", { error: error instanceof Error ? error.constructor.name : "Error", retention_limit: BACKUP_RETENTION_LIMIT }); } catch { /* retention must not fail the published backup */ } }
    try { audit(root, "backup_succeeded", { filename, trigger, started_at: startedAt, completed_at: now(), duration_seconds: (Date.now() - started) / 1000, size_bytes: metadata.backup_file_size_bytes, checksum: metadata.sha256, integrity_verified: true, removed_backups: removedBackups }); }
    catch { console.error("WARN: backup completed but the operations audit line could not be written."); }
    return metadata;
  } catch (error) {
    try {
      if (statSync(root).isDirectory()) {
        try { audit(root, "backup_failed", { trigger, started_at: startedAt, completed_at: now(), duration_seconds: (Date.now() - started) / 1000, failure_code: typeof (error as Row)?.code === "string" ? (error as Row).code : error instanceof Error ? error.constructor.name : "Error" }); }
        catch { console.error("WARN: backup failed and the operations audit line could not be written."); }
      }
    } catch { /* no existing backup directory is available to hold failure history */ }
    throw error;
  } finally {
    try {
      if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    } finally {
      backupBusy = false;
    }
  }
}

export function createPreResetBackup(context: AuthContext, config: SafetyConfig): string {
  return String(createBackup(context, config, "manual").filename);
}

function backupSequence(filename: string): number {
  const match = /_(\d+)\.sqlite3$/.exec(filename);
  return match ? Number(match[1]) : 0;
}
function backupTimestamp(filename: string): string {
  return /^backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:_\d+)?\.sqlite3$/.exec(filename)?.[1] ?? "";
}
/** Newest first. Filename timestamp and suffix break ties when metadata timestamps have second precision. */
function compareBackupDescending(a: Row, b: Row): number {
  const byCreatedAt = String(b.created_at).localeCompare(String(a.created_at));
  if (byCreatedAt !== 0) return byCreatedAt;
  const byFilenameTimestamp = backupTimestamp(String(b.filename)).localeCompare(backupTimestamp(String(a.filename)));
  if (byFilenameTimestamp !== 0) return byFilenameTimestamp;
  const bySequence = backupSequence(String(b.filename)) - backupSequence(String(a.filename));
  return bySequence !== 0 ? bySequence : String(b.filename).localeCompare(String(a.filename));
}
function metadata(root: string): Row[] {
  return rowsFromFiles(root).sort(compareBackupDescending);
}
function rowsFromFiles(root: string): Row[] {
  const result: Row[] = [];
  for (const entry of (readdirSync(root, { withFileTypes: true }) as { name: string; isFile(): boolean }[])) {
    if (!entry.isFile() || !backupFile.test(entry.name)) continue;
    const manifest = `${root}/${entry.name}.meta.json`;
    try { if (!regularFile(manifest)) continue; const value = JSON.parse(readFileSync(manifest, "utf8")); result.push({ filename: entry.name, created_at: value.created_at, trigger: value.trigger, size: Number(value.backup_file_size_bytes ?? value.sqlite_file_size_bytes), checksum: value.sha256, schema_version: value.schema_version, encrypted: value.encrypted === true, format_version: value.format_version ?? null, algorithm: value.algorithm ?? null, key_id: value.key_id ?? null }); } catch { /* incomplete pairs stay invisible */ }
  }
  return result;
}

function verifiedBackup(root: string, filename: string): string {
  if (!backupFile.test(filename)) throw Object.assign(new Error("Invalid backup filename."), { status: 404 });
  const path = `${root}/${filename}`;
  if (!regularFile(path) || !regularFile(`${path}.meta.json`)) throw Object.assign(new Error("Backup not found."), { status: 404 });
  return path;
}

function deleteBackup(root: string, filename: string): void {
  const path = verifiedBackup(root, filename);
  rmSync(path);
  rmSync(`${path}.meta.json`);
  audit(root, "backup_deleted", { filename });
}

/**
 * Best-effort cleanup after a backup pair is published. Only complete, visible
 * pairs beyond the newest `BACKUP_RETENTION_LIMIT` are candidates. The newest
 * backup, an explicitly preserved restore source, and any file that cannot be
 * removed are skipped. Cleanup never turns a verified backup into a failure.
 */
export function evictBeyondRetention(root: string, newest: string, preserve?: string): string[] {
  const entries = metadata(root);
  if (entries.length <= BACKUP_RETENTION_LIMIT) return [];
  const keep = new Set(entries.slice(0, BACKUP_RETENTION_LIMIT).map((entry) => String(entry.filename)));
  keep.add(newest);
  if (preserve) keep.add(preserve);
  const removed: string[] = [];
  for (const entry of entries.slice(BACKUP_RETENTION_LIMIT)) {
    const filename = String(entry.filename);
    if (keep.has(filename)) continue;
    const path = `${root}/${filename}`;
    if (!statSafe(path) || !statSafe(`${path}.meta.json`)) continue;
    try {
      rmSync(path);
      rmSync(`${path}.meta.json`, { force: true });
    } catch (error) {
      try { audit(root, "backup_eviction_skipped", { filename, reason: error instanceof Error ? error.constructor.name : "Error", retention_limit: BACKUP_RETENTION_LIMIT }); } catch { /* retention must not fail the published backup */ }
      continue;
    }
    removed.push(filename);
    try { audit(root, "backup_evicted", { filename, trigger: entry.trigger ?? null, size_bytes: entry.size ?? null, reason: "retention_limit", retention_limit: BACKUP_RETENTION_LIMIT }); } catch { /* retention must not fail the published backup */ }
  }
  return removed;
}

function readBackupExecutionHistory(root: string): Row[] {
  const path = join(root, "backup_operations_audit.jsonl");
  let lines: string[];
  try {
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("BACKUP_AUDIT_INVALID");
    lines = readFileSync(path, "utf8").split("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const history: Row[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      const event = JSON.parse(line) as Row;
      if (event.event !== "backup_succeeded" && event.event !== "backup_failed") continue;
      const filename = typeof event.filename === "string" && backupFile.test(event.filename) ? event.filename : null;
      let manifest: Row | null = null;
      if (filename) {
        try {
          const manifestPath = join(root, `${filename}.meta.json`);
          const file = lstatSync(manifestPath);
          if (file.isFile() && !file.isSymbolicLink()) manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Row;
        } catch { /* old/evicted artifacts have no readable manifest */ }
      }
      const completedAt = typeof event.completed_at === "string" ? event.completed_at : typeof event.timestamp === "string" ? event.timestamp : null;
      const rawTrigger = String(event.trigger ?? manifest?.trigger ?? "manual").toUpperCase();
      const errorMessage = typeof event.failure_code === "string" ? event.failure_code : typeof event.error === "string" ? event.error : "Backup failed";
      history.push({
        id: index + 1,
        backup_filename: filename,
        started_at: typeof event.started_at === "string" ? event.started_at : completedAt ?? "",
        completed_at: completedAt,
        duration_seconds: Number.isFinite(event.duration_seconds) ? event.duration_seconds : null,
        status: event.event === "backup_succeeded" ? "SUCCESS" : "FAILED",
        error_message: event.event === "backup_failed" ? errorMessage : null,
        trigger_type: rawTrigger,
        size_bytes: Number.isFinite(event.size_bytes) ? event.size_bytes : manifest?.backup_file_size_bytes ?? manifest?.sqlite_file_size_bytes ?? null,
        checksum: typeof event.checksum === "string" ? event.checksum : manifest?.sha256 ?? null,
        integrity_verified: event.event === "backup_succeeded" && typeof event.integrity_verified === "boolean" ? event.integrity_verified : null,
        removed_backups: Array.isArray(event.removed_backups) ? event.removed_backups.filter((value: unknown) => typeof value === "string" && backupFile.test(value)) : [],
      });
    } catch { /* a partial final line or malformed legacy record is not a backup execution */ }
  }
  return history.reverse().slice(0, 200);
}

function statusPayload(context: AuthContext, config: SafetyConfig): Row {
  const root = backupRoot(config); const active = dbPath(context);
  let entries: Row[] = [];
  let available = false;
  let incomplete = false;
  try {
    const destination = diskSpaceProbePath(root);
    available = statSync(destination).isDirectory();
    accessSync(destination, constants.R_OK | constants.W_OK | constants.X_OK);
    if (statSafe(root)) {
      entries = metadata(root);
      const generations = new Set(readdirSync(root).map((name) => name.replace(/\.meta\.json$/, "")).filter((name) => backupFile.test(name)));
      incomplete = generations.size !== entries.length;
    }
  } catch { available = false; }
  const latest = entries[0] ?? null;
  let actualSize: number | null = null;
  let checksumStatus: string | null = latest ? "failed" : null;
  if (latest) {
    try {
      const path = join(root, latest.filename);
      const stats = statSync(path);
      actualSize = stats.size;
      if (!stats.isFile() || stats.size <= 0 || stats.size !== latest.size) throw new Error("Backup size mismatch.");
      const manifest = JSON.parse(readFileSync(`${path}.meta.json`, "utf8"));
      if (manifest.filename !== latest.filename || manifest.source_db_path !== basename(active) ||
        !Number.isFinite(Date.parse(latest.created_at)) || !Number.isSafeInteger(manifest.sqlite_file_size_bytes) || manifest.sqlite_file_size_bytes <= 0 ||
        manifest.backup_file_size_bytes !== stats.size || typeof manifest.schema_version !== "string" || !manifest.schema_version ||
        typeof manifest.plaintext_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.plaintext_sha256)) throw new Error("Backup metadata invalid.");
      const artifact = readFileSync(path);
      if (artifact.length !== stats.size || backupSha256(artifact) !== latest.checksum) throw new Error("Backup checksum mismatch.");
      const envelope = JSON.parse(artifact.toString());
      if (!isEncryptedBackup(artifact) || manifest.encrypted !== true || manifest.format_version !== BACKUP_ENVELOPE_VERSION || manifest.format_version !== envelope.version || manifest.algorithm !== BACKUP_ENCRYPTION_ALGORITHM || manifest.algorithm !== envelope.algorithm || manifest.key_id !== envelope.keyId || latest.encrypted !== true || latest.format_version !== envelope.version || latest.algorithm !== envelope.algorithm || latest.key_id !== envelope.keyId) throw new Error("Backup metadata mismatch.");
      checksumStatus = "verified";
    } catch { /* fail closed; creation-time checks do not verify the current artifact */ }
  }
  const minimumRequired = minimumRequiredSpaceBytes(active);
  let probeValues: { availableBytes: number; freeBytes: number } | null = null;
  try {
    const value = diskSpaceProbeFor(config)(diskSpaceProbePath(root));
    if (Number.isFinite(value.availableBytes) && value.availableBytes >= 0 && Number.isFinite(value.freeBytes) && value.freeBytes >= 0) probeValues = value;
  } catch { /* fail-safe: unknown capacity is never reported as healthy */ }
  const lowSpace = probeValues === null || probeValues.availableBytes < minimumRequired;
  let history: Row[] = [];
  try { history = readBackupExecutionHistory(root); } catch { /* history failure is represented as unknown outcome, not a failed artifact check */ }
  const latestAttempt = history[0] ?? null;
  const lastSuccessful = history.find((entry) => entry.status === "SUCCESS");
  const lastFailed = history.find((entry) => entry.status === "FAILED");
  const latestOutcome = latestAttempt?.status === "FAILED" ? "FAILED" : latestAttempt?.status === "SUCCESS" && latestAttempt.backup_filename === latest?.filename ? "SUCCESS" : null;
  const health = restoreBusy ? "RESTORE_IN_PROGRESS" : backupBusy ? "BACKUP_IN_PROGRESS" : !available ? "DESTINATION_UNAVAILABLE" : incomplete ? "UNKNOWN" : !latest ? "NO_BACKUP" : checksumStatus !== "verified" || probeValues === null ? "UNKNOWN" : lowSpace ? "LOW_DISK_SPACE" : latestAttempt?.status === "FAILED" ? "LAST_BACKUP_FAILED" : "HEALTHY";
  return { health_state: health, last_successful_backup_at: lastSuccessful?.completed_at ?? null, last_failed_backup_at: lastFailed?.completed_at ?? null, last_failure_code: lastFailed?.error_message ?? null, last_failure_message: lastFailed ? "The most recent backup attempt failed." : null, latest_backup_filename: latest?.filename ?? null, latest_backup_type: latest?.trigger ?? null, latest_backup_size_bytes: actualSize, latest_backup_checksum_status: checksumStatus, latest_backup_integrity_status: latest ? "not_checked" : null, latest_backup_schema_version: latest?.schema_version ?? null, latest_backup_encrypted: latest?.encrypted ?? false, latest_backup_key_id: latest?.key_id ?? null, backup_encryption_configured: Boolean(config.backupEncryption), backup_age_seconds: latest ? Math.max(0, Math.floor((Date.now() - Date.parse(latest.created_at)) / 1000)) : null, next_scheduled_backup_at: scheduledNextRunAt(context), backup_count: entries.length, retention_limit: BACKUP_RETENTION_LIMIT, backup_directory_display: basename(root), backup_directory_available: available, free_space_bytes: probeValues?.availableBytes ?? null, minimum_required_space_bytes: minimumRequired, low_space: lowSpace, backup_in_progress: backupBusy, restore_in_progress: restoreBusy, generated_at_utc: now(), latest_backup_timestamp: latest?.created_at ?? null, latest_backup_outcome: latestOutcome, free_disk_space_bytes: probeValues?.freeBytes ?? null, database_basename: basename(active), sqlite_journal_mode: activeJournalMode(context), destructive_operations_enabled: config.destructiveOperationsEnabled, authentication_available: true, restore_support_mode: "single_process_only", restore_requires_admin: true, restore_requires_reauthentication: true, restore_multi_worker_safe: false };
}

function preflight(context: AuthContext, config: SafetyConfig, filename: string): Row {
  if (!backupFile.test(filename)) throw Object.assign(new Error("Invalid backup filename."), { status: 400 });
  const root = backupRoot(config); const target = `${root}/${filename}`;
  if (!regularFile(target) || !regularFile(`${target}.meta.json`)) throw Object.assign(new Error("Backup artifact and metadata must be regular files."), { status: 404, code: "BACKUP_ARTIFACT_INVALID" });
  const manifest = JSON.parse(readFileSync(`${target}.meta.json`, "utf8"));
  return decryptedBackup(config, target, (plaintextPath, artifact) => {
    const sourceChecksum = backupSha256(artifact);
    if (manifest.sha256 !== sourceChecksum) throw Object.assign(new Error("Backup checksum verification failed."), { status: 409, code: "BACKUP_CHECKSUM_MISMATCH" });
    if (isEncryptedBackup(artifact)) {
      let envelope: Row;
      try { envelope = JSON.parse(artifact.toString()) as Row; } catch { throw Object.assign(new Error("Backup metadata is invalid."), { status: 409, code: "BACKUP_METADATA_INVALID" }); }
      const plaintextSize = statSync(plaintextPath).size;
      if (manifest.encrypted !== true || manifest.filename !== filename || manifest.source_db_path !== basename(dbPath(context)) ||
        manifest.created_at === undefined || !Number.isFinite(Date.parse(manifest.created_at)) || !["manual", "scheduled", "pre_restore_auto"].includes(manifest.trigger) ||
        manifest.format_version !== envelope.version || manifest.algorithm !== envelope.algorithm || manifest.key_id !== envelope.keyId ||
        manifest.backup_file_size_bytes !== artifact.length || manifest.sqlite_file_size_bytes !== plaintextSize ||
        manifest.plaintext_sha256 !== sha256(plaintextPath)) throw Object.assign(new Error("Backup metadata does not match the encrypted artifact."), { status: 409, code: "BACKUP_METADATA_INVALID" });
    }
    const source = inspectDatabase(plaintextPath); const active = inspectDatabase(dbPath(context), false); const activeChecksum = backupSha256(context.database.client.serialize()); const plaintextChecksum = sha256(plaintextPath);
    if (isEncryptedBackup(artifact) && manifest.schema_version !== source.schema) throw Object.assign(new Error("Backup schema metadata does not match the encrypted artifact."), { status: 409, code: "BACKUP_METADATA_INVALID" });
    const same = plaintextChecksum === activeChecksum; const compatible = source.schemaValid && source.schema === active.schema && source.identityCompatible;
    const classification = same ? "NO_CHANGE" : !compatible ? "SCHEMA_INCOMPATIBLE" : "LOW_IMPACT";
    const reasons = [
      ...(same ? ["source_identical_to_active"] : []),
      ...(classification === "SCHEMA_INCOMPATIBLE" ? ["schema_incompatible"] : []),
      ...(source.integrity !== "ok" ? ["integrity_check_failed"] : []),
      ...(source.quick !== "ok" ? ["quick_check_failed"] : []),
      ...(source.foreignKeyViolationCount === null ? ["foreign_key_check_unavailable"] : source.foreignKeyViolationCount > 0 ? ["foreign_key_violations"] : []),
      ...(source.restoreIdentityBlockingReason ? [source.restoreIdentityBlockingReason] : []),
    ];
    const sourceStudents = source.counts.students ?? null;
    const sourceAttendance = source.counts.attendance ?? null;
    const sourceEnrollments = source.counts.enrollments ?? null;
    const activeStudents = active.counts.students ?? null;
    const activeAttendance = active.counts.attendance ?? null;
    const activeEnrollments = active.counts.enrollments ?? null;
    const delta = (sourceCount: number | null, activeCount: number | null) => sourceCount === null || activeCount === null ? null : sourceCount - activeCount;
    return { source: { filename, backup_type: manifest.trigger, created_at: manifest.created_at, age_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(manifest.created_at)) / 1000)), size_bytes: manifest.backup_file_size_bytes ?? manifest.sqlite_file_size_bytes, sha256: sourceChecksum, checksum_matches_manifest: sourceChecksum === manifest.sha256, encrypted: manifest.encrypted === true, format_version: manifest.format_version ?? null, algorithm: manifest.algorithm ?? null, key_id: manifest.key_id ?? null, integrity_check: source.integrity, quick_check: source.quick, foreign_key_violation_count: source.foreignKeyViolationCount, schema_version: source.schema, identity_compatible: source.identityCompatible, application_compatible: compatible, restore_eligible: classification === "LOW_IMPACT" && source.integrity === "ok" && source.quick === "ok" && source.foreignKeyViolationCount === 0 && source.restoreIdentityEligible === true, blocking_reasons: reasons, warning_reasons: [] }, active: { active_sha256: activeChecksum, active_schema_version: active.schema, active_students: activeStudents, active_attendance: activeAttendance, active_enrollments: activeEnrollments, source_students: sourceStudents, source_attendance: sourceAttendance, source_enrollments: sourceEnrollments, student_delta: delta(sourceStudents, activeStudents), attendance_delta: delta(sourceAttendance, activeAttendance), enrollment_delta: delta(sourceEnrollments, activeEnrollments), same_database_content: same, source_is_older: null, possible_data_loss: same ? false : null, sessions_will_be_revoked: true, restart_required: true, pre_restore_backup_will_be_created: true }, impact_classification: classification };
  });
}

function missingRestoreFields(body: Row): string[] { return ["acknowledge_complete_replacement", "acknowledge_session_revocation", "acknowledge_restart_required", "acknowledge_safety_backup", "expected_source_sha256", "expected_active_sha256"].filter((key) => body[key] === undefined); }
function restoreValidationError(set: any, fields: string[]): { detail: unknown } { set.status = 422; return { detail: fields.map((field) => ({ loc: ["body", field], msg: "Field required", type: "missing" })) }; }

function restoredAdministratorCredentialsMatch(client: Database, body: Row, operator: { username: string }): boolean {
  return isFirstAdminSetupRequired(client) ||
    restoreAdministratorCredentialMatches(client, operator.username, body.current_password) ||
    restoreAdministratorCredentialMatches(client, body.candidate_admin_username, body.candidate_admin_password);
}

function restore(context: AuthContext, config: SafetyConfig, filename: string, body: Row, operator: { id: number; username: string }): Row {
  if (!config.destructiveOperationsEnabled) throw Object.assign(new Error("Destructive operations are disabled."), { status: 403, code: "RESTORE_DISABLED" });
  if (!body.current_password || !body.confirmation_filename || !body.confirmation_phrase) throw Object.assign(new Error("Restore fields are required."), { status: 422 });
  const user = row(context, "SELECT password_hash FROM users WHERE id = ?", [operator.id]);
  if (!user || !Bun.password.verifySync(body.current_password, String(user.password_hash))) throw Object.assign(new Error("Restore authorization failed."), { status: 401, code: "RESTORE_REAUTHENTICATION_FAILED" });
  if (body.confirmation_filename !== filename) throw Object.assign(new Error("The confirmation filename does not match."), { status: 400, code: "RESTORE_CONFIRMATION_FILENAME_MISMATCH" });
  if (body.confirmation_phrase !== "RESTORE_DATABASE") throw Object.assign(new Error("The restore confirmation phrase is invalid."), { status: 400, code: "RESTORE_CONFIRMATION_PHRASE_INVALID" });
  if (![body.acknowledge_complete_replacement, body.acknowledge_session_revocation, body.acknowledge_restart_required, body.acknowledge_safety_backup].every(Boolean)) throw Object.assign(new Error("Every restore safety acknowledgement is required."), { status: 400, code: "RESTORE_ACKNOWLEDGEMENT_REQUIRED" });
  const checked = preflight(context, config, filename); if (checked.source.sha256 !== body.expected_source_sha256 || checked.active.active_sha256 !== body.expected_active_sha256) throw Object.assign(new Error("The restore source changed after verification."), { status: 409, code: "RESTORE_SOURCE_CHANGED" });
  if (!checked.source.restore_eligible) throw Object.assign(new Error("The selected backup is not eligible for restore."), { status: 409, code: "RESTORE_SOURCE_INVALID" });
  if (restoreBusy) throw Object.assign(new Error("Another destructive operation is already active."), { status: 409, code: "SYSTEM_MAINTENANCE_OPERATION_ACTIVE" });
  restoreBusy = true; const operationId = randomUUID(); const root = backupRoot(config); const active = dbPath(context); const rollback = `${active}.${randomUUID()}.rollback`; const candidate = `${active}.${randomUUID()}.candidate`; let snapshot: Row | null = null;
  const recordFailure = (error: unknown, outcome?: string): void => {
    try { audit(root, "restore_failed", { filename, reason: error instanceof Error ? error.constructor.name : "Error", ...(outcome ? { rollback_outcome: outcome } : {}) }); }
    catch { console.error("WARN: restore failure could not be written to the operations audit."); }
    try { appendRestoreAudit(root, { event: "restore_failed", outcome: "FAILED", target_filename: filename, authenticated_username: operator.username, operation_id: operationId, pre_restore_snapshot_filename: snapshot?.filename ?? null, reason: error instanceof Error ? error.constructor.name : "Error" }); }
    catch { console.error("WARN: restore outcome recorded but the recovery-history line could not be written."); }
  };
  try {
    try {
      decryptedBackup(config, `${root}/${filename}`, (plaintextPath, artifact) => {
        if (backupSha256(artifact) !== checked.source.sha256) throw Object.assign(new Error("The restore source changed after verification."), { status: 409, code: "RESTORE_SOURCE_CHANGED" });
        copyFileSync(plaintextPath, candidate);
        chmodSync(candidate, 0o600);
        const candidateInspection = validateSnapshot(candidate, new Set(REQUIRED_TABLES));
        if (candidateInspection.restoreIdentityEligible !== true) throw new Error("Restore candidate has no eligible active administrator and first-run setup is closed.");
        if (candidateInspection.foreignKeyViolationCount !== 0) throw new Error("Restore candidate foreign-key validation failed.");
        const candidateDatabase = new Database(candidate, { readonly: true });
        try {
          if (!restoredAdministratorCredentialsMatch(candidateDatabase, body, operator)) throw Object.assign(new Error("A password for an active administrator in the selected backup could not be verified."), { status: 409, code: "RESTORE_ADMIN_CREDENTIAL_REQUIRED" });
        } finally { candidateDatabase.close(); }
        return {};
      });
      snapshot = createBackup(context, config, "pre_restore_auto", filename);
      assertOperationsAuditWritable(root);
    } catch (error) {
      recordFailure(error);
      if ((error as Row)?.code === "RESTORE_ADMIN_CREDENTIAL_REQUIRED") throw Object.assign(new Error("Restore was refused because no active administrator credential from the selected backup was verified; the active database is unchanged."), { status: 409, code: "RESTORE_ADMIN_CREDENTIAL_REQUIRED" });
      throw Object.assign(new Error("Restore failed before replacing the active database; the active database is unchanged."), { status: 500, code: "RESTORE_ROLLED_BACK" });
    }
    const swap = performRestoreSwap({
      active, candidate, rollback,
      fileSystem: config.restoreFileSystem ?? undefined,
      close: () => context.database.close(),
      reopen: () => context.database.reopen(),
      afterSwap: () => {
        context.database.client.run("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL");
        const checkedRestored = inspectDatabase(active);
        const postRestoreForeignKeyViolations = checkedRestored.foreignKeyViolationCount;
        if (checkedRestored.integrity !== "ok" || checkedRestored.quick !== "ok" || postRestoreForeignKeyViolations !== 0 || !checkedRestored.restoreIdentityEligible || !restoredAdministratorCredentialsMatch(context.database.client as unknown as Database, body, operator)) throw new Error("Post-restore integrity validation failed.");
        appendRestoreAudit(root, { event: "restore_completed", outcome: "COMPLETED", target_filename: filename, authenticated_username: operator.username, operation_id: operationId, pre_restore_snapshot_filename: snapshot!.filename, reason: null });
        return checkedRestored;
      },
    });
    if (swap.outcome === "committed") {
      const checkedRestored = swap.value!;
      try { audit(root, "restore_completed", { filename, safety_backup_filename: snapshot!.filename }); }
      catch { console.error("WARN: restore completed but the operations audit line could not be written."); }
      return { operation_id: operationId, status: "COMPLETED", restored_backup_filename: filename, completed_at: now(), safety_backup_filename: snapshot!.filename, post_restore_integrity: "ok", post_restore_quick_check: "ok", post_restore_foreign_key_violations: checkedRestored.foreignKeyViolationCount, post_restore_students: checkedRestored.counts.students, post_restore_attendance: checkedRestored.counts.attendance, post_restore_enrollments: checkedRestored.counts.enrollments, sessions_revoked: true, restart_required: true, rollback_attempted: false, safe_message: "Restore completed. Close and reopen OperatorOS, then sign in again." };
    }
    if (swap.outcome === "recovery_required") {
      // The preserved rollback/rejected files are the operator's recovery source.
      try { recordFailure(swap.error, swap.outcome); } catch { console.error("WARN: restore failure could not be fully recorded."); }
      throw Object.assign(new Error("Restore failed and automatic rollback could not be verified. The service preserved the remaining database files in the data directory; stop OperatorOS and recover the prior database before retrying."), { status: 500, code: "RESTORE_ROLLBACK_FAILED" });
    }
    recordFailure(swap.error, swap.outcome);
    throw Object.assign(new Error(swap.outcome === "unchanged" ? "Restore failed before replacing the active database; the active database is unchanged." : "Restore failed and the prior active database was restored and verified."), { status: 500, code: "RESTORE_ROLLED_BACK" });
  } finally { rmSync(candidate, { force: true }); restoreBusy = false; }
}

function schedulerNext(config: Row, at = Date.now()): string | null { if (!config.enabled) return null; const date = new Date(at); if (config.schedule_type === "interval") date.setUTCMinutes(date.getUTCMinutes() + Number(config.interval_minutes)); else { date.setUTCHours(Number(config.hour_utc), Number(config.minute_utc), 0, 0); if (date.getTime() <= at || config.schedule_type === "weekly" && date.getUTCDay() !== Number(config.weekday_utc)) date.setUTCDate(date.getUTCDate() + (config.schedule_type === "weekly" ? ((Number(config.weekday_utc) - date.getUTCDay() + 7) % 7 || 7) : 1)); } return date.toISOString(); }

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  start(context: AuthContext, config: SafetyConfig): void { if (this.timer) return; this.timer = setInterval(() => { const value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); if (value?.enabled && (!value.next_run_at || Date.parse(value.next_run_at) <= Date.now())) { const next = schedulerNext(value); context.database.client.run("UPDATE backup_scheduler_config SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", [next]); try { createBackup(context, config, "scheduled"); } catch { /* history and audit record the failure */ } } }, 30000); this.timer.unref?.(); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  get running(): boolean { return this.timer !== null; }
}
export const backupScheduler = new Scheduler();

const restoreBody = t.Object({ current_password: t.Optional(t.String()), candidate_admin_username: t.Optional(t.String({ minLength: 1, maxLength: 255 })), candidate_admin_password: t.Optional(t.String({ minLength: 1, maxLength: 1024 })), confirmation_filename: t.Optional(t.String()), confirmation_phrase: t.Optional(t.String()), acknowledge_complete_replacement: t.Optional(t.Boolean()), acknowledge_session_revocation: t.Optional(t.Boolean()), acknowledge_restart_required: t.Optional(t.Boolean()), acknowledge_safety_backup: t.Optional(t.Boolean()), expected_source_sha256: t.Optional(t.String()), expected_active_sha256: t.Optional(t.String()) });

export function safetyRoutes(app: any, context: AuthContext, config: SafetyConfig): void {
  app.get("/api/admin/backups/status", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { return statusPayload(context, config); } catch { return fail(ctx.set, 500, { code: "BACKUP_STATUS_UNAVAILABLE", message: "Backup status is unavailable." }); } });
  app.get("/api/admin/backups", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const root = backupRoot(config); return statSafe(root) ? metadata(root) : []; });
  app.post("/api/admin/backups", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { const value = createBackup(context, config, "manual"); const entry = metadata(backupRoot(config)).find((item) => item.filename === value.filename); return { ...(entry ?? value), sha256: value.sha256 }; } catch (error) { const failure = error as any; const message = String((error as Error).message); return fail(ctx.set, Number(failure?.status ?? 400), typeof failure?.code === "string" ? `${failure.code}: ${message}` : message); } });
  app.delete("/api/admin/backups/:filename", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { deleteBackup(backupRoot(config), ctx.params.filename); return { status: "success" }; } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 400), String((error as Error).message)); } });
  app.get("/api/admin/backups/:filename/download", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { const path = verifiedBackup(backupRoot(config), ctx.params.filename); return new Response(readFileSync(path), { headers: { "content-type": "application/vnd.operatoros.backup+json", "cache-control": "no-store, no-cache, must-revalidate, private", "content-disposition": `attachment; filename="${ctx.params.filename}"` } }); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 404), String((error as Error).message)); } });
  app.get("/api/admin/backups/history", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); return readBackupExecutionHistory(backupRoot(config)); });
  app.get("/api/admin/backups/recovery-history", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const root = backupRoot(config); if (!statSafe(`${root}/backup_restore_audit.jsonl`)) return []; return readFileSync(`${root}/backup_restore_audit.jsonl`, "utf8").split("\n").filter(Boolean).map((value) => { try { const item = JSON.parse(value); return { timestamp: item.timestamp ?? null, filename: item.target_filename ?? null, event: item.event ?? null, actor_display: item.authenticated_username ?? "unknown", result: item.outcome ?? null, safe_reason_code: item.reason ?? null, operation_reference_id: item.request_context?.operation_id ?? null, safety_backup_filename: item.pre_restore_snapshot_filename ?? null }; } catch { return null; } }).filter(Boolean); });
  app.get("/api/admin/backups/scheduler", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); let value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); if (!value) { context.database.client.run("INSERT INTO backup_scheduler_config (id, updated_at) VALUES (1, CURRENT_TIMESTAMP)"); value = row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); } return value; });
  app.put("/api/admin/backups/scheduler", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); const body = ctx.body as Row; const next = schedulerNext(body); context.database.client.run("INSERT INTO backup_scheduler_config (id, enabled, schedule_type, interval_minutes, hour_utc, minute_utc, weekday_utc, keep_daily, keep_weekly, keep_monthly, next_run_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, schedule_type=excluded.schedule_type, interval_minutes=excluded.interval_minutes, hour_utc=excluded.hour_utc, minute_utc=excluded.minute_utc, weekday_utc=excluded.weekday_utc, keep_daily=excluded.keep_daily, keep_weekly=excluded.keep_weekly, keep_monthly=excluded.keep_monthly, next_run_at=excluded.next_run_at, updated_at=CURRENT_TIMESTAMP", [body.enabled ? 1 : 0, body.schedule_type, body.interval_minutes, body.hour_utc, body.minute_utc, body.weekday_utc, body.keep_daily, body.keep_weekly, body.keep_monthly, next]); return row(context, "SELECT * FROM backup_scheduler_config WHERE id = 1"); }, { body: t.Object({ enabled: t.Boolean(), schedule_type: t.Union([t.Literal("daily"), t.Literal("weekly"), t.Literal("interval")]), interval_minutes: t.Number({ minimum: 1, maximum: 525600 }), hour_utc: t.Number({ minimum: 0, maximum: 23 }), minute_utc: t.Number({ minimum: 0, maximum: 59 }), weekday_utc: t.Number({ minimum: 0, maximum: 6 }), keep_daily: t.Number({ minimum: 0, maximum: 365 }), keep_weekly: t.Number({ minimum: 0, maximum: 260 }), keep_monthly: t.Number({ minimum: 0, maximum: 120 }) }) });
  app.post("/api/admin/backups/:filename/restore-preflight", (ctx: Context) => { if (!auth(context, ctx)) return denied(ctx); try { return preflight(context, config, ctx.params.filename); } catch (error) { return fail(ctx.set, Number((error as any)?.status ?? 400), String((error as Error).message)); } });
  app.post("/api/admin/backups/:filename/restore", (ctx: Context) => { const user = auth(context, ctx); if (!user) return denied(ctx); const missing = missingRestoreFields(ctx.body ?? {}); if (missing.length > 0) return restoreValidationError(ctx.set, missing); try { return restore(context, config, ctx.params.filename, ctx.body, { id: user.id, username: user.username }); } catch (error) { const value = error as any; return fail(ctx.set, Number(value.status ?? 400), { code: value.code ?? "RESTORE_SOURCE_INVALID", message: String(value.message ?? "Restore failed.") }); } }, { body: restoreBody });
  app.onStart(() => backupScheduler.start(context, config));
  app.onStop(() => backupScheduler.stop());
}
