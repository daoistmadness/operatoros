import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, ensureOperatorOSDirectories, resolveOperatorOSPaths } from "@operatoros/db";
import { startServer } from "../src/server";
import { backupScheduler } from "../src/domains/safety";

async function waitForReady(url: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await Bun.sleep(25);
  }
  throw new Error("candidate not ready within timeout");
}

describe("server lifecycle", () => {
  it("start -> health -> stop -> restart on same port, no leaks", async () => {
    const s1 = await startServer({ port: 0, databasePath: undefined });
    const url1 = `http://${s1.hostname}:${s1.port}/health`;
    const res = await waitForReady(url1);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
    await s1.stop();
    await Bun.sleep(50);

    const s2 = await startServer({ port: s1.port, databasePath: undefined });
    const res2 = await waitForReady(`http://${s2.hostname}:${s2.port}/health`);
    expect(res2.status).toBe(200);
    await s2.stop();
    await Bun.sleep(50);
  }, 15000);

  it("runs Elysia stop hooks before closing the database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "operatoros-server-lifecycle-"));
    const paths = resolveOperatorOSPaths({ env: { OPERATOROS_DATA_DIR: dataDir } });
    ensureOperatorOSDirectories(paths);
    createFreshDatabase(paths.databasePath);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      server = await startServer({
        hostname: "127.0.0.1",
        port: 0,
        environment: "test",
        databasePath: paths.databasePath,
        dataPaths: paths,
        backupDir: paths.backupDir,
        auth: { authCookieSecret: "synthetic-lifecycle-cookie-secret" },
      });
      expect(backupScheduler.running).toBe(true);
      await server.stop();
      expect(backupScheduler.running).toBe(false);
      server = undefined;
    } finally {
      await server?.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("candidate adapter (foundation)", () => {
  it("implements start/request/stop repeatedly without leaks", async () => {
    const { ElysiaCandidateAdapter } = await import("../src/adapter");
    for (let i = 0; i < 2; i++) {
      const adapter = new ElysiaCandidateAdapter();
      await adapter.start("seed_none");
      const res = await adapter.replay_step({ type: "request", method: "GET", path: "/health" });
      expect(res.status).toBe(200);
      await adapter.stop();
      await expect(adapter.replay_step({ type: "request", method: "GET", path: "/health" })).rejects.toThrow("adapter not started");
    }
  }, 20000);
});
