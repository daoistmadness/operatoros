import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const BACKUP_ENVELOPE_MAGIC = "OPERATOROS_BACKUP";
export const BACKUP_ENVELOPE_VERSION = 1;
export const BACKUP_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

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
