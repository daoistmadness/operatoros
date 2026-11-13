import { node } from "@elysiajs/node";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
  let serverInfo: {
    port: number;
    hostname: string;
    raw?: {
      ready?(): Promise<unknown>;
      node?: { server?: import("node:http").Server };
      bun?: { server?: { port: number; address?: { port: number } } };
    };
  } | undefined;
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
    app = createApp({ ...config, databaseHandle }, process.versions.bun ? undefined : node());
    app.listen({ hostname: config.hostname, port: config.port }, (value) => {
      serverInfo = value as unknown as typeof serverInfo;
      app!.server = value;
    });
    if (!serverInfo) throw new Error("Elysia Node adapter did not expose its server");
    await serverInfo.raw?.ready?.();
    const listener = serverInfo.raw?.node?.server;
    const address = listener?.address();
    const port = address && typeof address !== "string"
      ? address.port
      : serverInfo.raw?.bun?.server?.address?.port ?? serverInfo.raw?.bun?.server?.port ?? serverInfo.port;
    if (!port) throw new Error("Elysia adapter did not expose its bound TCP port");
    const stop = (): Promise<void> => stopping ??= (async () => {
      try {
        await app!.stop(true);
      }
      finally {
        databaseHandle?.close();
        await operationLock?.release();
      }
    })();
    operationLock?.onLost(() => { operationLockLost = true; void stop(); });
    if (operationLockLost) throw Object.assign(new Error("BACKUP_OPERATION_LOCK_UNAVAILABLE"), { code: "BACKUP_OPERATION_LOCK_UNAVAILABLE" });
    return {
      port,
      hostname: config.hostname,
      paths: config.dataPaths,
      stop,
    };
  } catch (error) {
    if (stopping) await stopping;
    else {
      try {
        if (serverInfo) await app?.stop(true);
      }
      finally {
        databaseHandle?.close();
        await operationLock?.release();
      }
    }
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = loadConfig();
  const instance = await startServer(config);
  if (instance.paths) {
    console.log(`OperatorOS local data\n  Data: ${instance.paths.dataDir}\n  Database: ${instance.paths.databasePath}\n  Backups: ${instance.paths.backupDir}\n  Logs: ${instance.paths.logDir}`);
  }
  console.log(`OperatorOS security\n  Backup encryption: ${config.backupEncryption ? "configured" : "not configured"}\n  Active backup key ID: ${config.backupEncryption?.activeKeyId ?? "none"}\n  Trusted proxy: ${config.auth?.trustedProxyAddresses?.length ? "enabled" : "disabled"}\n  Allowed origins: ${config.auth?.allowedOrigins?.length ?? 0}`);
  console.log(`operatoros-api listening on 127.0.0.1:${instance.port}`);
  const shutdown = () => { void instance.stop().catch((error) => { console.error("OperatorOS API shutdown failed.", error); process.exitCode = 1; }); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
