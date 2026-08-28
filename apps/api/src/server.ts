import type { Subprocess } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/connection";

export interface RunningServer {
  port: number;
  hostname: string;
  stop(): void;
}

export function startServer(overrides: Partial<{ hostname: string; port: number; databasePath?: string }> = {}): RunningServer {
  const config = { ...loadConfig(), ...overrides };
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
    stop: () => {
      bunServer.stop(true);
      databaseHandle?.close();
    },
  };
}

if (import.meta.main) {
  const instance = startServer();
  console.log(`operatoros-api listening on 127.0.0.1:${instance.port}`);
  process.on("SIGINT", () => instance.stop());
  process.on("SIGTERM", () => instance.stop());
}
