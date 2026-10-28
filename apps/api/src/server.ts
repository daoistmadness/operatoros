import { createApp } from "./app";
import { assertAuthCookieSecret } from "./auth/service";
import { loadConfig } from "./config";
import { assertDatabaseMigrationSafe, ensureOperatorOSDirectories, openDatabase, type OperatorOSPaths } from "@operatoros/db";
import { acquireBackupOperationLock } from "./domains/backup-operation-lock";
import { cleanupInterruptedBackupScratch } from "./domains/backup-scratch";

export interface RunningServer {
  port: number;
  hostname: string;
  paths?: OperatorOSPaths;
  stop(): Promise<void>;
}

export async function startServer(overrides: Partial<import("./config").BackendConfig> = {}): Promise<RunningServer> {
  const config = { ...loadConfig(), ...overrides };
  if (config.environment !== "test") assertAuthCookieSecret(config.auth?.authCookieSecret);
  const dataPaths = config.dataPaths;
  const canonicalDatabase = dataPaths && config.databasePath === dataPaths.databasePath;
  let operationLock: Awaited<ReturnType<typeof acquireBackupOperationLock>> | undefined;
  let databaseHandle = config.databaseHandle;
  let app: ReturnType<typeof createApp> | undefined;
  let stopping: Promise<void> | undefined;
  let operationLockLost = false;
  try {
    if (canonicalDatabase) {
      assertDatabaseMigrationSafe(dataPaths);
      ensureOperatorOSDirectories(dataPaths);
      if (process.platform === "linux") operationLock = await acquireBackupOperationLock(dataPaths.dataDir);
      cleanupInterruptedBackupScratch(dataPaths.databasePath, dataPaths.backupDir);
    }
    databaseHandle ??= config.databasePath ? openDatabase(config.databasePath) : undefined;
    app = createApp({ ...config, databaseHandle });
    app.listen({ hostname: config.hostname, port: config.port === 0 ? 0 : config.port });
    const bunServer = app.server as unknown as { port: number };
    if (!bunServer) throw new Error("Elysia did not expose a Bun server");
    const stop = (): Promise<void> => stopping ??= (async () => {
      try { await app!.stop(true); }
      finally {
        databaseHandle?.close();
        await operationLock?.release();
      }
    })();
    operationLock?.onLost(() => { operationLockLost = true; void stop(); });
    if (operationLockLost) throw Object.assign(new Error("BACKUP_OPERATION_LOCK_UNAVAILABLE"), { code: "BACKUP_OPERATION_LOCK_UNAVAILABLE" });
    return {
      port: bunServer.port,
      hostname: config.hostname,
      paths: config.dataPaths,
      stop,
    };
  } catch (error) {
    if (stopping) await stopping;
    else {
      try { await app?.stop(true); }
      finally {
        databaseHandle?.close();
        await operationLock?.release();
      }
    }
    throw error;
  }
}

if (import.meta.main) {
  const config = loadConfig();
  const instance = await startServer(config);
  if (instance.paths) {
    console.log(`OperatorOS local data\n  Data: ${instance.paths.dataDir}\n  Database: ${instance.paths.databasePath}\n  Backups: ${instance.paths.backupDir}\n  Logs: ${instance.paths.logDir}`);
  }
  console.log(`OperatorOS security\n  Backup encryption: ${config.backupEncryption ? "configured" : "not configured"}\n  Active backup key ID: ${config.backupEncryption?.activeKeyId ?? "none"}\n  Trusted proxy: ${config.auth?.trustedProxyAddresses?.length ? "enabled" : "disabled"}\n  Allowed origins: ${config.auth?.allowedOrigins?.length ?? 0}`);
  console.log(`operatoros-api listening on 127.0.0.1:${instance.port}`);
  process.on("SIGINT", () => { void instance.stop(); });
  process.on("SIGTERM", () => { void instance.stop(); });
}
