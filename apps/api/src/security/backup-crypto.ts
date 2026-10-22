import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, openSync, readSync, rmSync, writeSync } from "node:fs";

export const BACKUP_ENVELOPE_MAGIC = "OPERATOROS_BACKUP";
export const BACKUP_ENVELOPE_VERSION = 1;
export const BACKUP_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FILE_CHUNK_BYTES = 64 * 1024;
const ENVELOPE_HEADER_MAX_BYTES = 4096;
const CIPHERTEXT_MARKER = Buffer.from(',"ciphertext":"');
const ENVELOPE_SUFFIX = Buffer.from('"}');

export type BackupEncryptionConfig = {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  allowLegacyPlaintext: boolean;
};

export class BackupEncryptionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BackupEncryptionError";
  }
}

function keyBytes(value: string, field: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.length % 4 !== 0) {
    throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_INVALID", `${field} must be canonical Base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_INVALID", `${field} must decode to 32 bytes.`);
  return decoded;
}

function keyId(value: string | undefined, field: string): string {
  const result = value?.trim() ?? "";
  if (!result || result.length > 64 || !/^[A-Za-z0-9._-]+$/.test(result)) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_ID_INVALID", `${field} must be a short non-empty identifier.`);
  return result;
}

export function parseBackupEncryptionConfig(options: {
  activeKey?: string;
  activeKeyId?: string;
  previousKeys?: string;
  authCookieSecret?: string;
  allowLegacyPlaintext?: boolean;
}): BackupEncryptionConfig | null {
  const activeText = options.activeKey?.trim();
  if (!activeText) {
    if (options.previousKeys?.trim()) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_INVALID", "Previous backup keys require an active backup key.");
    return null;
  }
  if (options.authCookieSecret?.trim() && activeText === options.authCookieSecret.trim()) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_REUSE", "BACKUP_ENCRYPTION_KEY must differ from AUTH_COOKIE_SECRET.");
  const activeId = keyId(options.activeKeyId, "BACKUP_ENCRYPTION_KEY_ID");
  const keys = new Map<string, Buffer>([[activeId, keyBytes(activeText, "BACKUP_ENCRYPTION_KEY")]]);
  if (options.previousKeys?.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(options.previousKeys); } catch { throw new BackupEncryptionError("BACKUP_ENCRYPTION_PREVIOUS_KEYS_INVALID", "Previous backup keys must be a JSON object."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BackupEncryptionError("BACKUP_ENCRYPTION_PREVIOUS_KEYS_INVALID", "Previous backup keys must be a JSON object.");
    for (const [rawId, rawKey] of Object.entries(parsed)) {
      const id = keyId(rawId, "BACKUP_ENCRYPTION_PREVIOUS_KEYS key ID");
      if (keys.has(id) || typeof rawKey !== "string") throw new BackupEncryptionError("BACKUP_ENCRYPTION_PREVIOUS_KEYS_INVALID", "Previous backup key IDs must be unique and values must be Base64.");
      if (options.authCookieSecret?.trim() && rawKey.trim() === options.authCookieSecret.trim()) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_REUSE", "Backup encryption keys must differ from AUTH_COOKIE_SECRET.");
      keys.set(id, keyBytes(rawKey, `backup key ${id}`));
    }
  }
  return { activeKeyId: activeId, keys, allowLegacyPlaintext: options.allowLegacyPlaintext ?? false };
}

function metadata(value: { keyId: string }): Buffer {
  return Buffer.from(JSON.stringify({ magic: BACKUP_ENVELOPE_MAGIC, version: BACKUP_ENVELOPE_VERSION, algorithm: BACKUP_ENCRYPTION_ALGORITHM, keyId: value.keyId }), "utf8");
}

function decode(value: unknown, expectedBytes: number, field: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.length % 4 !== 0) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", `${field} is invalid.`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== expectedBytes) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", `${field} has an invalid length.`);
  return bytes;
}

export function encryptBackup(plaintext: Uint8Array, config: BackupEncryptionConfig): Buffer {
  const key = config.keys.get(config.activeKeyId);
  if (!key) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_UNAVAILABLE", "The active backup encryption key is unavailable.");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
  cipher.setAAD(metadata({ keyId: config.activeKeyId }));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    magic: BACKUP_ENVELOPE_MAGIC,
    version: BACKUP_ENVELOPE_VERSION,
    algorithm: BACKUP_ENCRYPTION_ALGORITHM,
    keyId: config.activeKeyId,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function decryptBackup(encrypted: Uint8Array, config: BackupEncryptionConfig): Buffer {
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(Buffer.from(encrypted).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    value = parsed as Record<string, unknown>;
  } catch { throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup envelope is invalid."); }
  if (value.magic !== BACKUP_ENVELOPE_MAGIC) throw new BackupEncryptionError("BACKUP_FORMAT_UNSUPPORTED", "The backup format is unsupported.");
  if (value.version !== BACKUP_ENVELOPE_VERSION) throw new BackupEncryptionError("BACKUP_VERSION_UNSUPPORTED", "The backup format version is unsupported.");
  if (value.algorithm !== BACKUP_ENCRYPTION_ALGORITHM || typeof value.keyId !== "string") throw new BackupEncryptionError("BACKUP_ALGORITHM_UNSUPPORTED", "The backup encryption algorithm is unsupported.");
  const key = config.keys.get(value.keyId);
  if (!key) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_UNKNOWN", "The backup encryption key is unavailable.");
  const nonce = decode(value.nonce, NONCE_BYTES, "nonce");
  const tag = decode(value.tag, TAG_BYTES, "authentication tag");
  if (typeof value.ciphertext !== "string" || value.ciphertext.length % 4 !== 0) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext is invalid.");
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  try {
    const decipher = createDecipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
    decipher.setAAD(metadata({ keyId: value.keyId }));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch { throw new BackupEncryptionError("BACKUP_AUTHENTICATION_FAILED", "The backup could not be authenticated."); }
}

export function backupSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isEncryptedBackup(bytes: Uint8Array): boolean {
  try { return (JSON.parse(Buffer.from(bytes).toString("utf8")) as { magic?: unknown })?.magic === BACKUP_ENVELOPE_MAGIC; } catch { return false; }
}

export type BackupFileVerification = {
  encrypted: true;
  encryptedSize: number;
  encryptedSha256: string;
  plaintextSize: number;
  plaintextSha256: string;
  envelope: { version: number; algorithm: string; keyId: string };
};

function openRegularBackupFile(path: string): number {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(descriptor).isFile()) throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The backup artifact must be a regular file.");
    return descriptor;
  } catch (error) {
    try { closeSync(descriptor); } catch { /* preserve the validation error */ }
    throw error;
  }
}

function readAt(descriptor: number, target: Buffer, length: number, position: number): void {
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(descriptor, target, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup artifact is truncated.");
    offset += bytesRead;
  }
}

function writeAll(descriptor: number, bytes: Uint8Array, position?: number): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = position === undefined
      ? writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
      : writeSync(descriptor, bytes, offset, bytes.byteLength - offset, position + offset);
    if (written === 0) throw new Error("Backup artifact write made no progress.");
    offset += written;
  }
}

function headerFromBytes(header: Buffer, length: number): { value: Record<string, unknown>; payloadStart: number } | null {
  const markerStart = header.subarray(0, length).indexOf(CIPHERTEXT_MARKER);
  if (markerStart < 0) return null;
  try {
    const prefix = header.subarray(0, markerStart);
    const value = JSON.parse(Buffer.concat([prefix, Buffer.from(',"ciphertext":""}')]).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { value: value as Record<string, unknown>, payloadStart: markerStart + CIPHERTEXT_MARKER.length };
  } catch { return null; }
}

export function isEncryptedBackupFile(path: string): boolean {
  const descriptor = openRegularBackupFile(path);
  try {
    const size = Number(fstatSync(descriptor, { bigint: true }).size);
    const header = Buffer.alloc(Math.min(size, ENVELOPE_HEADER_MAX_BYTES));
    if (header.length) readAt(descriptor, header, header.length, 0);
    return headerFromBytes(header, header.length)?.value.magic === BACKUP_ENVELOPE_MAGIC;
  } finally { closeSync(descriptor); }
}

export function hashBackupFileSync(path: string): string {
  const descriptor = openRegularBackupFile(path);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The backup artifact is too large to hash safely.");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(FILE_CHUNK_BYTES);
    let position = 0;
    while (position < Number(before.size)) {
      const length = Math.min(buffer.length, Number(before.size) - position);
      const bytesRead = readSync(descriptor, buffer, 0, length, position);
      if (bytesRead === 0) throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The backup artifact changed while it was being read.");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.dev !== after.dev || before.ino !== after.ino) {
      throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The backup artifact changed while it was being read.");
    }
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}

export function encryptBackupFileSync(plaintextPath: string, encryptedPath: string, config: BackupEncryptionConfig): BackupFileVerification {
  const key = config.keys.get(config.activeKeyId);
  if (!key) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_UNAVAILABLE", "The active backup encryption key is unavailable.");
  const input = openRegularBackupFile(plaintextPath);
  let output: number | undefined;
  let created = false;
  try {
    const before = fstatSync(input, { bigint: true });
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The plaintext snapshot is too large to encrypt safely.");
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
    cipher.setAAD(metadata({ keyId: config.activeKeyId }));
    const placeholder = "A".repeat(Math.ceil(TAG_BYTES / 3) * 4);
    const json = JSON.stringify({ magic: BACKUP_ENVELOPE_MAGIC, version: BACKUP_ENVELOPE_VERSION, algorithm: BACKUP_ENCRYPTION_ALGORITHM, keyId: config.activeKeyId, nonce: nonce.toString("base64"), tag: placeholder, ciphertext: "" });
    const marker = ',"ciphertext":""}';
    const markerStart = json.lastIndexOf(marker);
    const tagMarker = '"tag":"';
    const tagValueStart = json.indexOf(tagMarker) + tagMarker.length;
    if (markerStart < 0 || tagValueStart < tagMarker.length) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup envelope could not be created.");
    const prefix = Buffer.from(`${json.slice(0, markerStart)},"ciphertext":"`, "utf8");
    const tagOffset = Buffer.byteLength(json.slice(0, tagValueStart), "utf8");
    output = openSync(encryptedPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    writeAll(output, prefix);
    const plaintextHash = createHash("sha256");
    const buffer = Buffer.alloc(FILE_CHUNK_BYTES);
    let position = 0;
    let plaintextSize = 0;
    let carry = Buffer.alloc(0);
    const writeCiphertext = (bytes: Buffer): void => {
      if (!bytes.length) return;
      const combined = carry.length ? Buffer.concat([carry, bytes]) : bytes;
      const completeLength = combined.length - combined.length % 3;
      if (completeLength) writeAll(output!, Buffer.from(combined.subarray(0, completeLength).toString("base64"), "ascii"));
      carry = Buffer.from(combined.subarray(completeLength));
    };
    while (position < Number(before.size)) {
      const length = Math.min(buffer.length, Number(before.size) - position);
      const bytesRead = readSync(input, buffer, 0, length, position);
      if (bytesRead === 0) throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The plaintext snapshot changed while it was being encrypted.");
      const plaintext = buffer.subarray(0, bytesRead);
      plaintextHash.update(plaintext);
      plaintextSize += bytesRead;
      writeCiphertext(cipher.update(plaintext));
      position += bytesRead;
    }
    writeCiphertext(cipher.final());
    if (carry.length) writeAll(output, Buffer.from(carry.toString("base64"), "ascii"));
    writeAll(output, ENVELOPE_SUFFIX);
    writeAll(output, Buffer.from(cipher.getAuthTag().toString("base64"), "ascii"), tagOffset);
    fsyncSync(output);
    const after = fstatSync(input, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.dev !== after.dev || before.ino !== after.ino) {
      throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The plaintext snapshot changed while it was being encrypted.");
    }
    const encryptedSize = Number(fstatSync(output, { bigint: true }).size);
    return { encrypted: true, encryptedSize, encryptedSha256: hashBackupFileSync(encryptedPath), plaintextSize, plaintextSha256: plaintextHash.digest("hex"), envelope: { version: BACKUP_ENVELOPE_VERSION, algorithm: BACKUP_ENCRYPTION_ALGORITHM, keyId: config.activeKeyId } };
  } catch (error) {
    if (output !== undefined) { try { closeSync(output); } catch { /* cleanup follows the failed write */ } output = undefined; }
    if (created) rmSync(encryptedPath, { force: true });
    throw error;
  } finally {
    if (output !== undefined) closeSync(output);
    closeSync(input);
  }
}

export function decryptBackupFileSync(encryptedPath: string, plaintextPath: string, config: BackupEncryptionConfig): BackupFileVerification {
  const input = openRegularBackupFile(encryptedPath);
  let output: number | undefined;
  let created = false;
  try {
    const before = fstatSync(input, { bigint: true });
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup artifact is too large to verify safely.");
    const encryptedSize = Number(before.size);
    const header = Buffer.alloc(Math.min(encryptedSize, ENVELOPE_HEADER_MAX_BYTES));
    if (header.length) readAt(input, header, header.length, 0);
    const parsed = headerFromBytes(header, header.length);
    if (!parsed) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup envelope is invalid.");
    const envelope = parsed.value;
    if (envelope.magic !== BACKUP_ENVELOPE_MAGIC) throw new BackupEncryptionError("BACKUP_FORMAT_UNSUPPORTED", "The backup format is unsupported.");
    if (envelope.version !== BACKUP_ENVELOPE_VERSION) throw new BackupEncryptionError("BACKUP_VERSION_UNSUPPORTED", "The backup format version is unsupported.");
    if (envelope.algorithm !== BACKUP_ENCRYPTION_ALGORITHM || typeof envelope.keyId !== "string") throw new BackupEncryptionError("BACKUP_ALGORITHM_UNSUPPORTED", "The backup encryption algorithm is unsupported.");
    const key = config.keys.get(envelope.keyId);
    if (!key) throw new BackupEncryptionError("BACKUP_ENCRYPTION_KEY_UNKNOWN", "The backup encryption key is unavailable.");
    const nonce = decode(envelope.nonce, NONCE_BYTES, "nonce");
    const tag = decode(envelope.tag, TAG_BYTES, "authentication tag");
    const payloadEnd = encryptedSize - ENVELOPE_SUFFIX.length;
    const payloadLength = payloadEnd - parsed.payloadStart;
    if (payloadLength < 0 || payloadLength % 4 !== 0) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext is invalid.");
    const suffix = Buffer.alloc(ENVELOPE_SUFFIX.length);
    readAt(input, suffix, suffix.length, payloadEnd);
    if (!suffix.equals(ENVELOPE_SUFFIX)) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup envelope ending is invalid.");
    const decipher = createDecipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
    decipher.setAAD(metadata({ keyId: envelope.keyId }));
    decipher.setAuthTag(tag);
    output = openSync(plaintextPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    const encryptedHash = createHash("sha256");
    const plaintextHash = createHash("sha256");
    const buffer = Buffer.alloc(FILE_CHUNK_BYTES);
    let plaintextSize = 0;
    let decodedCharacters = 0;
    let carry = "";
    const decryptBase64 = (bytes: Buffer): void => {
      if (!bytes.length) return;
      for (const byte of bytes) if (byte > 0x7f) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext encoding is invalid.");
      const combined = carry + bytes.toString("ascii");
      const completeLength = combined.length - combined.length % 4;
      const complete = combined.slice(0, completeLength);
      if (complete) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(complete) ||
          complete.includes("=") && decodedCharacters + complete.length !== payloadLength) {
          throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext encoding is invalid.");
        }
        const ciphertext = Buffer.from(complete, "base64");
        if (ciphertext.toString("base64") !== complete) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext encoding is invalid.");
        const plaintext = decipher.update(ciphertext);
        if (plaintext.length) {
          writeAll(output!, plaintext);
          plaintextHash.update(plaintext);
          plaintextSize += plaintext.length;
        }
        decodedCharacters += complete.length;
      }
      carry = combined.slice(completeLength);
    };
    const processFileBytes = (bytes: Buffer, absoluteOffset: number): void => {
      encryptedHash.update(bytes);
      const start = Math.max(parsed.payloadStart, absoluteOffset);
      const end = Math.min(payloadEnd, absoluteOffset + bytes.length);
      if (end > start) decryptBase64(bytes.subarray(start - absoluteOffset, end - absoluteOffset));
    };
    processFileBytes(header, 0);
    let position = header.length;
    while (position < encryptedSize) {
      const length = Math.min(buffer.length, encryptedSize - position);
      const bytesRead = readSync(input, buffer, 0, length, position);
      if (bytesRead === 0) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup artifact is truncated.");
      processFileBytes(buffer.subarray(0, bytesRead), position);
      position += bytesRead;
    }
    if (decodedCharacters !== payloadLength || carry.length) throw new BackupEncryptionError("BACKUP_ENVELOPE_INVALID", "The backup ciphertext length is invalid.");
    try {
      const final = decipher.final();
      if (final.length) {
        writeAll(output, final);
        plaintextHash.update(final);
        plaintextSize += final.length;
      }
    } catch { throw new BackupEncryptionError("BACKUP_AUTHENTICATION_FAILED", "The backup could not be authenticated."); }
    fsyncSync(output);
    const after = fstatSync(input, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.dev !== after.dev || before.ino !== after.ino) {
      throw new BackupEncryptionError("BACKUP_ARTIFACT_INVALID", "The backup artifact changed while it was being read.");
    }
    return { encrypted: true, encryptedSize, encryptedSha256: encryptedHash.digest("hex"), plaintextSize, plaintextSha256: plaintextHash.digest("hex"), envelope: { version: BACKUP_ENVELOPE_VERSION, algorithm: BACKUP_ENCRYPTION_ALGORITHM, keyId: envelope.keyId } };
  } catch (error) {
    if (output !== undefined) { try { closeSync(output); } catch { /* cleanup follows the failed write */ } output = undefined; }
    if (created) rmSync(plaintextPath, { force: true });
    throw error;
  } finally {
    if (output !== undefined) closeSync(output);
    closeSync(input);
  }
}
