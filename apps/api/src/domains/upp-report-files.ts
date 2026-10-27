import { createHash, randomUUID } from "node:crypto";
import { constants, chmodSync, closeSync, copyFileSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { syncDirectory, syncFile } from "./durable-files";
import type { BackupAttachment, BackupAttachmentSource } from "../security/backup-payload";

const HASH = /^[a-f0-9]{64}$/;
const CHUNK_BYTES = 64 * 1024;

export type FileMetadata = { sha256: string; sizeBytes: number };

export function reportFilePath(dataDir: string, sha256: string): string {
  if (!HASH.test(sha256)) throw new Error("UPP_REPORT_FILE_HASH_INVALID");
  return join(dataDir, "upp-reports", "sha256", sha256.slice(0, 2), sha256);
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UPP_REPORT_STORAGE_INVALID");
  chmodSync(path, 0o700);
}

function digestFile(path: string): FileMetadata {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("UPP_REPORT_FILE_INVALID");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let position = 0;
    while (position < stat.size) {
      const length = Math.min(buffer.length, stat.size - position);
      const count = readSync(fd, buffer, 0, length, position);
      if (count !== length) throw new Error("UPP_REPORT_FILE_CHANGED");
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    return { sha256: hash.digest("hex"), sizeBytes: stat.size };
  } finally { closeSync(fd); }
}

function assertFile(path: string, expected: FileMetadata): void {
  const actual = digestFile(path);
  if (actual.sha256 !== expected.sha256 || actual.sizeBytes !== expected.sizeBytes) throw new Error("UPP_REPORT_FILE_INTEGRITY_FAILED");
}

function existingFileMatches(path: string, expected: FileMetadata): boolean {
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("UPP_REPORT_FILE_INVALID");
    assertFile(path, expected);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function storeReportFile(dataDir: string, bytes: Uint8Array): FileMetadata {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = { sha256, sizeBytes: bytes.byteLength };
  const target = reportFilePath(dataDir, sha256);
  ensurePrivateDirectory(join(dataDir, "upp-reports"));
  ensurePrivateDirectory(join(dataDir, "upp-reports", "sha256"));
  ensurePrivateDirectory(join(dataDir, "upp-reports", "sha256", sha256.slice(0, 2)));
  if (existingFileMatches(target, metadata)) return metadata;
  const temporary = join(join(dataDir, "upp-reports", "sha256", sha256.slice(0, 2)), `.upload-${randomUUID()}`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const value = Buffer.from(bytes);
      let offset = 0;
      while (offset < value.length) {
        const written = writeSync(fd, value, offset, value.length - offset);
        if (written === 0) throw new Error("UPP_REPORT_FILE_WRITE_FAILED");
        offset += written;
      }
    } finally { closeSync(fd); }
    syncFile(temporary);
    try { linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !existingFileMatches(target, metadata)) throw error;
    }
    syncDirectory(join(dataDir, "upp-reports", "sha256", sha256.slice(0, 2)));
  } finally { rmSync(temporary, { force: true }); }
  return metadata;
}

function tableExists(database: Database, name: string): boolean {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function referencedReportFiles(database: Database): FileMetadata[] {
  const parts: string[] = [];
  if (tableExists(database, "upp_report_versions")) parts.push("SELECT file_sha256 AS sha256, file_size_bytes AS sizeBytes FROM upp_report_versions");
  if (tableExists(database, "upp_report_submission_evidence")) parts.push("SELECT file_sha256 AS sha256, file_size_bytes AS sizeBytes FROM upp_report_submission_evidence");
  if (tableExists(database, "student_iom_documents")) parts.push("SELECT file_sha256 AS sha256, file_size_bytes AS sizeBytes FROM student_iom_documents");
  if (!parts.length) return [];
  const rows = database.query(parts.join(" UNION ")).all() as FileMetadata[];
  const entries = new Map<string, number>();
  for (const row of rows) {
    if (!HASH.test(row.sha256) || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes <= 0 || entries.has(row.sha256) && entries.get(row.sha256) !== row.sizeBytes) {
      throw new Error("UPP_REPORT_ATTACHMENT_METADATA_INVALID");
    }
    entries.set(row.sha256, row.sizeBytes);
  }
  return [...entries].map(([sha256, sizeBytes]) => ({ sha256, sizeBytes })).sort((a, b) => a.sha256.localeCompare(b.sha256));
}

export function backupAttachmentSources(database: Database, dataDir: string): BackupAttachmentSource[] {
  return referencedReportFiles(database).map((entry) => {
    const path = reportFilePath(dataDir, entry.sha256);
    assertFile(path, entry);
    return { ...entry, path };
  });
}

export function backupAttachmentsMatch(database: Database, files: BackupAttachment[]): boolean {
  const expected = referencedReportFiles(database);
  return expected.length === files.length && expected.every((entry, index) => entry.sha256 === files[index]?.sha256 && entry.sizeBytes === files[index]?.sizeBytes);
}

export function installBackupAttachments(dataDir: string, attachments: BackupAttachment[]): void {
  for (const attachment of attachments) {
    assertFile(attachment.path, attachment);
    const target = reportFilePath(dataDir, attachment.sha256);
    const directory = join(dataDir, "upp-reports", "sha256", attachment.sha256.slice(0, 2));
    ensurePrivateDirectory(join(dataDir, "upp-reports"));
    ensurePrivateDirectory(join(dataDir, "upp-reports", "sha256"));
    ensurePrivateDirectory(directory);
    if (existingFileMatches(target, attachment)) continue;
    const temporary = join(directory, `.restore-${randomUUID()}`);
    try {
      copyFileSync(attachment.path, temporary, constants.COPYFILE_EXCL);
      chmodSync(temporary, 0o600);
      syncFile(temporary);
      assertFile(temporary, attachment);
      try { linkSync(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !existingFileMatches(target, attachment)) throw error;
      }
      syncDirectory(directory);
    } finally { rmSync(temporary, { force: true }); }
  }
}

export function storedReportFile(dataDir: string, expected: FileMetadata): string {
  const path = reportFilePath(dataDir, expected.sha256);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("UPP_REPORT_FILE_NOT_FOUND");
  assertFile(path, expected);
  return path;
}
