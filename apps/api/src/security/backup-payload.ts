import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { syncDirectory, syncFile } from "../domains/durable-files";

const MAGIC = Buffer.from("OPOSFULLBACK");
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 100_000;
const COPY_CHUNK_BYTES = 64 * 1024;
const HASH = /^[a-f0-9]{64}$/;

export type BackupAttachmentSource = { sha256: string; sizeBytes: number; path: string };
export type BackupAttachment = { sha256: string; sizeBytes: number; path: string };
type PayloadEntry = { sha256: string; sizeBytes: number };
type PayloadHeader = { format: "OPERATOROS_FULL_BACKUP"; version: 1; database: PayloadEntry; attachments: PayloadEntry[] };

function validEntry(value: unknown): value is PayloadEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sha256 === "string" && HASH.test(entry.sha256) && Number.isSafeInteger(entry.sizeBytes) && Number(entry.sizeBytes) > 0;
}

function readAt(fd: number, buffer: Buffer, position: number): void {
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (count === 0) throw new Error("BACKUP_PAYLOAD_TRUNCATED");
    offset += count;
  }
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset);
    if (written === 0) throw new Error("BACKUP_PAYLOAD_WRITE_FAILED");
    offset += written;
  }
}

function writeAllAt(fd: number, buffer: Buffer, position: number): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (written === 0) throw new Error("BACKUP_PAYLOAD_WRITE_FAILED");
    offset += written;
  }
}

function copyAndHash(sourceFd: number, targetFd: number, sizeBytes: number, sourceOffset = 0): string {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(COPY_CHUNK_BYTES);
  let copied = 0;
  while (copied < sizeBytes) {
    const length = Math.min(chunk.length, sizeBytes - copied);
    const count = readSync(sourceFd, chunk, 0, length, sourceOffset + copied);
    if (count !== length) throw new Error("BACKUP_PAYLOAD_TRUNCATED");
    const bytes = chunk.subarray(0, count);
    hash.update(bytes);
    writeAll(targetFd, bytes);
    copied += count;
  }
  return hash.digest("hex");
}

function sourceFile(entry: BackupAttachmentSource | { path: string; sha256: string; sizeBytes: number }): { fd: number; size: number } {
  const fd = openSync(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size !== entry.sizeBytes) {
    closeSync(fd);
    throw new Error("BACKUP_ATTACHMENT_INVALID");
  }
  return { fd, size: stat.size };
}

export function isBackupPayload(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const prefix = Buffer.alloc(MAGIC.length);
    if (fstatSync(fd).size < prefix.length) return false;
    readAt(fd, prefix, 0);
    return prefix.equals(MAGIC);
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function writeBackupPayload(databasePath: string, attachments: BackupAttachmentSource[], destination: string): { databaseSizeBytes: number; payloadSizeBytes: number; attachments: PayloadEntry[] } {
  if (attachments.length > MAX_ATTACHMENT_COUNT) throw new Error("BACKUP_PAYLOAD_TOO_MANY_ATTACHMENTS");
  const database = { sha256: "", sizeBytes: statSync(databasePath).size };
  if (database.sizeBytes <= 0) throw new Error("BACKUP_DATABASE_INVALID");
  const entries = [...attachments].sort((a, b) => a.sha256.localeCompare(b.sha256));
  if (entries.some((entry, index) => !HASH.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0 || index > 0 && entries[index - 1]!.sha256 === entry.sha256)) {
    throw new Error("BACKUP_ATTACHMENT_INVALID");
  }
  const header: PayloadHeader = {
    format: "OPERATOROS_FULL_BACKUP",
    version: 1,
    database: { sha256: "0".repeat(64), sizeBytes: database.sizeBytes },
    attachments: entries.map(({ sha256, sizeBytes }) => ({ sha256, sizeBytes })),
  };
  const json = Buffer.from(JSON.stringify(header), "utf8");
  if (json.length > MAX_HEADER_BYTES) throw new Error("BACKUP_PAYLOAD_HEADER_TOO_LARGE");
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  const db = openSync(databasePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const opened: number[] = [];
  try {
    if (!fstatSync(db).isFile() || fstatSync(db).size !== database.sizeBytes) throw new Error("BACKUP_DATABASE_INVALID");
    writeAll(fd, MAGIC);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(json.length);
    writeAll(fd, length);
    writeAll(fd, json);
    database.sha256 = copyAndHash(db, fd, database.sizeBytes);
    if (database.sha256 !== header.database.sha256) {
      header.database.sha256 = database.sha256;
      const updated = Buffer.from(JSON.stringify(header), "utf8");
      if (updated.length !== json.length) throw new Error("BACKUP_PAYLOAD_HEADER_CHANGED");
      writeAllAt(fd, updated, MAGIC.length + 4);
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const openedSource = sourceFile(entry);
      opened.push(openedSource.fd);
      if (copyAndHash(openedSource.fd, fd, openedSource.size) !== entry.sha256) throw new Error("BACKUP_ATTACHMENT_CHECKSUM_MISMATCH");
    }
    fsyncSync(fd);
  } finally {
    closeSync(db);
    for (const source of opened) closeSync(source);
    closeSync(fd);
  }
  syncFile(destination);
  syncDirectory(dirname(destination));
  return { databaseSizeBytes: database.sizeBytes, payloadSizeBytes: statSync(destination).size, attachments: header.attachments };
}

function parseHeader(value: unknown): PayloadHeader {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BACKUP_PAYLOAD_INVALID");
  const header = value as Record<string, unknown>;
  if (header.format !== "OPERATOROS_FULL_BACKUP" || header.version !== 1 || !validEntry(header.database) || !Array.isArray(header.attachments) || header.attachments.length > MAX_ATTACHMENT_COUNT || !header.attachments.every(validEntry)) {
    throw new Error("BACKUP_PAYLOAD_INVALID");
  }
  const seen = new Set<string>();
  for (const entry of header.attachments) {
    if (seen.has(entry.sha256)) throw new Error("BACKUP_PAYLOAD_DUPLICATE_ATTACHMENT");
    seen.add(entry.sha256);
  }
  return header as unknown as PayloadHeader;
}

export function extractBackupPayload(path: string, targetDirectory: string): { databasePath: string; attachments: BackupAttachment[] } {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const created: string[] = [];
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < MAGIC.length + 4) throw new Error("BACKUP_PAYLOAD_INVALID");
    const prefix = Buffer.alloc(MAGIC.length + 4);
    readAt(fd, prefix, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("BACKUP_PAYLOAD_INVALID");
    const headerSize = prefix.readUInt32BE(MAGIC.length);
    if (headerSize === 0 || headerSize > MAX_HEADER_BYTES) throw new Error("BACKUP_PAYLOAD_HEADER_INVALID");
    const headerBytes = Buffer.alloc(headerSize);
    readAt(fd, headerBytes, prefix.length);
    const header = parseHeader(JSON.parse(headerBytes.toString("utf8")));
    const expectedLength = BigInt(prefix.length) + BigInt(headerSize) + BigInt(header.database.sizeBytes) + header.attachments.reduce((total, entry) => total + BigInt(entry.sizeBytes), 0n);
    if (expectedLength !== BigInt(stat.size)) throw new Error("BACKUP_PAYLOAD_LENGTH_INVALID");
    mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    const databasePath = join(targetDirectory, "snapshot.sqlite");
    const databaseFd = openSync(databasePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created.push(databasePath);
    try {
      const checksum = copyAndHash(fd, databaseFd, header.database.sizeBytes, prefix.length + headerSize);
      if (checksum !== header.database.sha256) throw new Error("BACKUP_DATABASE_CHECKSUM_MISMATCH");
      fsyncSync(databaseFd);
    } finally { closeSync(databaseFd); }
    let offset = prefix.length + headerSize + header.database.sizeBytes;
    const attachments: BackupAttachment[] = [];
    for (const entry of header.attachments) {
      const directory = join(targetDirectory, "attachments");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const attachmentPath = join(directory, entry.sha256);
      const attachmentFd = openSync(attachmentPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      created.push(attachmentPath);
      try {
        const checksum = copyAndHash(fd, attachmentFd, entry.sizeBytes, offset);
        if (checksum !== entry.sha256) throw new Error("BACKUP_ATTACHMENT_CHECKSUM_MISMATCH");
        fsyncSync(attachmentFd);
      } finally { closeSync(attachmentFd); }
      offset += entry.sizeBytes;
      attachments.push({ ...entry, path: attachmentPath });
    }
    syncFile(databasePath);
    syncDirectory(targetDirectory);
    return { databasePath, attachments };
  } catch (error) {
    for (const createdPath of created) {
      try { rmSync(createdPath, { force: true }); } catch {}
    }
    throw error;
  } finally { closeSync(fd); }
}

