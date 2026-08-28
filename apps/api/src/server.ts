import type { Subprocess } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { assertDatabaseMigrationSafe, ensureOperatorOSDirectories, openDatabase, type OperatorOSPaths } from "@operatoros/db";

export interface RunningServer {
  port: number;
  hostname: string;
  paths?: OperatorOSPaths;
  stop(): void;
}

export function startServer(overrides: Partial<import("./config").BackendConfig> = {}): RunningServer {
  const config = { ...loadConfig(), ...overrides };
  const dataPaths = config.dataPaths;
  const canonicalDatabase = dataPaths && config.databasePath === dataPaths.databasePath;
  if (canonicalDatabase) {
    assertDatabaseMigrationSafe(dataPaths);
    ensureOperatorOSDirectories(dataPaths);
  }
  const databaseHandle = config.databaseHandle ?? (config.databasePath ? openDatabase(config.databasePath) : undefined);
  const app = createApp({ ...config, databaseHandle });
  app.listen({ hostname: config.hostname, port: config.port === 0 ? 0 : config.port });
  const bunServer = app.server as unknown as {
    port: number;
    stop(closeActiveConnections?: boolean): Subprocess | undefined;
  };
  if (!bunServer) throw new Error("Elysia did not expose a Bun server");
  return {
    port: bunServer.port,
    hostname: config.hostname,
    paths: config.dataPaths,
    stop: () => {
      bunServer.stop(true);
      databaseHandle?.close();
    },
  };
}

if (import.meta.main) {
  const instance = startServer();
  if (instance.paths) {
    console.log(`OperatorOS local data\n  Data: ${instance.paths.dataDir}\n  Database: ${instance.paths.databasePath}\n  Backups: ${instance.paths.backupDir}\n  Logs: ${instance.paths.logDir}`);
  }
  console.log(`operatoros-api listening on 127.0.0.1:${instance.port}`);
  process.on("SIGINT", () => instance.stop());
  process.on("SIGTERM", () => instance.stop());
}
