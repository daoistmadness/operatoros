import { startServer } from "./server";

/** Candidate-side adapter matching the Phase 0 harness protocol (foundation scope). */
export class ElysiaCandidateAdapter {
  private instance: ReturnType<typeof startServer> | null = null;

  async start(_seedFnName: string) {
    this.instance = startServer({ port: 0 });
    const base = `http://${this.instance.hostname}:${this.instance.port}`;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) return;
      } catch {}
      await Bun.sleep(25);
    }
    this.stop();
    throw new Error("Elysia candidate failed readiness check");
  }

  async replay_step(step: { type: string; method?: string; path?: string }): Promise<{ kind: string; status: number | null }> {
    if (!this.instance) throw new Error("adapter not started");
    if (step.type !== "request") return { kind: step.type, status: null };
    const url = `http://${this.instance.hostname}:${this.instance.port}${step.path ?? "/"}`;
    return fetch(url, { method: step.method ?? "GET" }).then(async (res) => ({
      kind: "request",
      status: res.status,
    }));
  }

  capture_state(): Promise<unknown> {
    return Promise.resolve({ note: "foundation adapter captures no database state" });
  }

  stop() {
    this.instance?.stop();
    this.instance = null;
  }
}
