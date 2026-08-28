import { isAbsolute, resolve } from "node:path";
import { resolveOperatorOSPaths, type OperatorOSPaths } from "@operatoros/db";

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
}

function sqlitePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("sqlite:///")) return value.slice("sqlite:///".length);
  return value;
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
  return {
    hostname: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8090),
    environment: (env.NODE_ENV as BackendConfig["environment"]) ?? "development",
    databasePath: explicitDataRoot || !configuredDatabase ? dataPaths.databasePath : configuredDatabase,
    destructiveOperationsEnabled: env.ENABLE_DESTRUCTIVE_OPERATIONS === "true",
    backupDir: dataPaths.backupDir,
    dataPaths,
    auth: {
      authCookieSecret: env.AUTH_COOKIE_SECRET,
      cookieSecure: env.COOKIE_SECURE === "true",
      setupToken: env.ASTRYX_SETUP_TOKEN,
      managedDevSetup: env.OPERATOROS_MANAGED_DEV_SETUP === "true",
      auditDir: dataPaths.logDir,
    },
  };
}
