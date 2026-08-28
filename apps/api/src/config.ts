import { isAbsolute, resolve } from "node:path";
import { resolveOperatorOSPaths, type OperatorOSPaths } from "@operatoros/db";
import { DEFAULT_LOGIN_RATE_LIMIT } from "./auth/rate-limit";
import { parseAllowedOrigins, parseTrustedProxyAddresses } from "./security/http";
import { parseBackupEncryptionConfig, type BackupEncryptionConfig } from "./security/backup-crypto";

export interface BackendConfig {
  hostname: string;
  port: number;
  environment: "production" | "development" | "test";
  databasePath?: string;
  auth?: Partial<import("./auth/service").AuthConfig>;
  databaseHandle?: import("@operatoros/db").DatabaseHandle;
  destructiveOperationsEnabled?: boolean;
  backupDir?: string;
  dataPaths?: OperatorOSPaths;
  backupEncryption?: BackupEncryptionConfig | null;
}

function sqlitePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("sqlite:///")) return value.slice("sqlite:///".length);
  return value;
}

function positiveInteger(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  const dataPaths = resolveOperatorOSPaths({ env, repositoryRoot: env.OPERATOROS_REPOSITORY_ROOT });
  const explicitDataRoot = Boolean(env.OPERATOROS_DATA_DIR?.trim() || env.OPERATOROS_DEV_DATA_DIR?.trim());
  const configuredDatabase = sqlitePath(env.DATABASE_URL ?? env.DATABASE_PATH);
  if (explicitDataRoot && configuredDatabase && (!isAbsolute(configuredDatabase) || resolve(configuredDatabase) !== dataPaths.databasePath)) {
    throw new Error(`DATABASE_URL conflicts with OPERATOROS_DATA_DIR: ${configuredDatabase} != ${dataPaths.databasePath}`);
  }
  const configuredBackup = env.BACKUP_DIR?.trim();
  if (configuredBackup && resolve(configuredBackup) !== dataPaths.backupDir) {
    throw new Error(`BACKUP_DIR must equal the canonical backup path: ${dataPaths.backupDir}`);
  }
  const authCookieSecret = env.AUTH_COOKIE_SECRET;
  const rateLimit = {
    windowMs: positiveInteger(env, "LOGIN_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_LOGIN_RATE_LIMIT.windowMs / 1000) * 1000,
    perIp: positiveInteger(env, "LOGIN_RATE_LIMIT_PER_IP", DEFAULT_LOGIN_RATE_LIMIT.perIp),
    perAccount: positiveInteger(env, "LOGIN_RATE_LIMIT_PER_ACCOUNT", DEFAULT_LOGIN_RATE_LIMIT.perAccount),
    global: positiveInteger(env, "LOGIN_RATE_LIMIT_GLOBAL", DEFAULT_LOGIN_RATE_LIMIT.global),
    maxEntries: positiveInteger(env, "LOGIN_RATE_LIMIT_MAX_ENTRIES", DEFAULT_LOGIN_RATE_LIMIT.maxEntries),
  };
  return {
    hostname: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8090),
    environment: (env.NODE_ENV as BackendConfig["environment"]) ?? "development",
    databasePath: explicitDataRoot || !configuredDatabase ? dataPaths.databasePath : configuredDatabase,
    destructiveOperationsEnabled: env.ENABLE_DESTRUCTIVE_OPERATIONS === "true",
    backupDir: dataPaths.backupDir,
    dataPaths,
    backupEncryption: parseBackupEncryptionConfig({ activeKey: env.BACKUP_ENCRYPTION_KEY, activeKeyId: env.BACKUP_ENCRYPTION_KEY_ID, previousKeys: env.BACKUP_ENCRYPTION_PREVIOUS_KEYS, authCookieSecret, allowLegacyPlaintext: env.ALLOW_LEGACY_PLAINTEXT_BACKUPS === "true" }),
    auth: {
      authCookieSecret,
      cookieSecure: env.COOKIE_SECURE === "true",
      setupToken: env.ASTRYX_SETUP_TOKEN,
      managedDevSetup: env.OPERATOROS_MANAGED_DEV_SETUP === "true",
      allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS, ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"]),
      rateLimit,
      trustedProxyAddresses: parseTrustedProxyAddresses(env.TRUSTED_PROXY_ADDRESSES),
      auditDir: dataPaths.logDir,
    },
  };
}
