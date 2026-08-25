export interface BackendConfig {
  hostname: string;
  port: number;
  environment: "production" | "development" | "test";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  return {
    hostname: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8090),
    environment: (env.NODE_ENV as BackendConfig["environment"]) ?? "development",
  };
}
