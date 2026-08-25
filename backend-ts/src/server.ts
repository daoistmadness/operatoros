import type { Subprocess } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";

export interface RunningServer {
  port: number;
  hostname: string;
  stop(): void;
}

export function startServer(overrides: Partial<{ hostname: string; port: number }> = {}): RunningServer {
  const config = { ...loadConfig(), ...overrides };
  const app = createApp(config);
  app.listen({ hostname: config.hostname, port: config.port === 0 ? 0 : config.port });
  const bunServer = app.server as unknown as {
    port: number;
    stop(closeActiveConnections?: boolean): Subprocess | undefined;
  };
  if (!bunServer) throw new Error("Elysia did not expose a Bun server");
  return {
    port: bunServer.port,
    hostname: config.hostname,
    stop: () => bunServer.stop(true),
  };
}

if (import.meta.main) {
  const instance = startServer();
  console.log(`backend-ts listening on 127.0.0.1:${instance.port}`);
  process.on("SIGINT", () => instance.stop());
  process.on("SIGTERM", () => instance.stop());
}
