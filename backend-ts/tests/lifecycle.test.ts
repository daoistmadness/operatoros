import { describe, it, expect } from "bun:test";
import { startServer } from "../src/server";

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
    const s1 = startServer({ port: 0 });
    const url1 = `http://${s1.hostname}:${s1.port}/health`;
    const res = await waitForReady(url1);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
    s1.stop();
    await Bun.sleep(50);

    const s2 = startServer({ port: s1.port });
    const res2 = await waitForReady(`http://${s2.hostname}:${s2.port}/health`);
    expect(res2.status).toBe(200);
    s2.stop();
    await Bun.sleep(50);
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
    }
    const procs = Bun.spawnSync(["pgrep", "-f", "backend-ts.*server"]).stdout.toString().trim();
    expect(procs).toBe("");
  }, 20000);
});
