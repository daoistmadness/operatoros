export interface BackendConfig {
  hostname: string;
  port: number;
  environment: "production" | "development" | "test";
  databasePath?: string;
  auth?: Partial<import("./auth/service").AuthConfig>;
  databaseHandle?: import("@operatoros/db").DatabaseHandle;
  destructiveOperationsEnabled?: boolean;
  backupDir?: string;
}

function sqlitePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("sqlite:///")) return value.slice("sqlite:///".length);
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  return {
    hostname: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8090),
    environment: (env.NODE_ENV as BackendConfig["environment"]) ?? "development",
    databasePath: sqlitePath(env.DATABASE_URL ?? env.DATABASE_PATH),
    destructiveOperationsEnabled: env.ENABLE_DESTRUCTIVE_OPERATIONS === "true",
    backupDir: env.BACKUP_DIR,
    auth: {
      authCookieSecret: env.AUTH_COOKIE_SECRET,
      cookieSecure: env.COOKIE_SECURE === "true",
      setupToken: env.ASTRYX_SETUP_TOKEN,
      managedDevSetup: env.OPERATOROS_MANAGED_DEV_SETUP === "true",
      auditDir: env.BACKUP_DIR,
    },
  };
}
