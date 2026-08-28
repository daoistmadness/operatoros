import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { PROTECTED_DATABASE_BASENAME } from "@operatoros/db";
import { loadConfig } from "./config";
import { backupSha256, decryptBackup, encryptBackup, isEncryptedBackup } from "./security/backup-crypto";

const root = resolve(import.meta.dir, "../../");
const backupName = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_\d+)?\.sqlite3$/;

function config() {
  const value = loadConfig({ ...process.env, OPERATOROS_REPOSITORY_ROOT: root });
  if (!value.databasePath || !isAbsolute(value.databasePath)) throw new Error("DATABASE_URL must use an absolute SQLite path.");
  if (basename(value.databasePath) === PROTECTED_DATABASE_BASENAME) throw new Error("Protected database access is forbidden.");
  return value;
}

function exists(path: string): boolean { try { statSync(path); return true; } catch { return false; } }

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
  const directory = mkdtempSync(join(tmpdir(), "operatoros-backup-cli-")); chmodSync(directory, 0o700);
  const name = nextFilename(backupDir);
  try {
    const database = new Database(databasePath, { readonly: true }); const plaintext = database.serialize(); database.close();
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

const [action, selected] = process.argv.slice(2);
try {
  if (action === "backup") backup();
  else if (action === "restore" && selected) restore(selected);
  else throw new Error("Usage: backup-cli.ts <backup|restore> [backup-file]");
} catch (error) { console.error(error instanceof Error ? error.message : "Backup operation failed."); process.exit(1); }
