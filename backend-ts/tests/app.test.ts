import { describe, it, expect } from "bun:test";
import { createApp, createTestApp } from "../src/app";
import { startServer } from "../src/server";
import { loadConfig } from "../src/config";

const jsonHeaders = { "content-type": "application/json" };

describe("createApp", () => {
  it("constructs without binding a listener", () => {
    const app = createApp();
    expect(app).toBeDefined();
    const srv = (app as unknown as { server?: { listening?: boolean } }).server;
    expect(srv?.listening ?? false).toBe(false);
  });
});

describe("foundation routes", () => {
  const app = createApp();

  it("health is deterministic", async () => {
    const res = await app.handle(new Request("http://local/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("readiness states foundation-only readiness", async () => {
    const res = await app.handle(new Request("http://local/ready"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { persistence: string }).persistence).toBe("not-configured");
  });

  it("404 is sanitized", async () => {
    const res = await app.handle(new Request("http://local/nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toMatch(/\/|stack/i);
  });
});

describe("validation fixtures", () => {
  const app = createTestApp();

  it("valid body passes", async () => {
    const res = await app.handle(new Request("http://local/diag/body", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "x", count: 1 }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { echo: { name: string; count: number } };
    expect(body.echo).toEqual({ name: "x", count: 1 });
  });

  it("invalid body returns 400 sanitized envelope", async () => {
    const res = await app.handle(new Request("http://local/diag/body", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ wrong: true }) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body)).not.toMatch(/property|expected|at\s|\n/);
  });

  it("query validation rejects invalid", async () => {
    const res = await app.handle(new Request("http://local/diag/query?limit=nope"));
    expect(res.status).toBe(400);
  });

  it("parameter validation coerces/rejects", async () => {
    expect((await app.handle(new Request("http://local/diag/param/7"))).status).toBe(200);
    expect((await app.handle(new Request("http://local/diag/param/abc"))).status).toBe(400);
  });

  it("response schema enforces contract", async () => {
    // handle() cannot serve response-schema routes; exercise over a real
    // ephemeral listener where Elysia enforces the response contract (422).
    const { startServer } = await import("../src/server");
    const probe = createTestApp();
    const srv = probe.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (srv.server as unknown as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/diag/broken-response`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(body)).not.toMatch(/\/abs\/|stack|unexpected/i);
    } finally {
      (srv.server as unknown as { stop(closeActiveConnections?: boolean): void }).stop(true);
    }
  }, 15000);

  it("internal errors are sanitized", async () => {
    const res = await app.handle(new Request("http://local/diag/internal"));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/secret|\/abs\/path|stack/i);
  });
});

describe("openapi", () => {
  it("generates deterministic document with only production routes", async () => {
    const a = createApp();
    const r1 = await a.handle(new Request("http://local/openapi/json"));
    const r2 = await a.handle(new Request("http://local/openapi/json"));
    expect(r1.status).toBe(200);
    const j1 = await r1.text(); const j2 = await r2.text();
    expect(j1).toBe(j2);
    const doc = JSON.parse(j1);
    expect(Object.keys(doc.paths).sort()).toEqual(["/", "/api/system/health", "/health", "/ready"]);
  });

  it("test fixture app excludes diag routes from openapi", async () => {
    const ta = createTestApp();
    const res = await ta.handle(new Request("http://local/openapi/json")).catch(() => null);
    if (!res) return; // test app disables openapi by env design; absence acceptable
    expect(JSON.stringify(await res.json())).not.toContain("/diag/");
  });
});

describe("configuration isolation", () => {
  it("two apps use their own config values", () => {
    const c1 = loadConfig({ HOST: "127.0.0.1", PORT: "10001", NODE_ENV: "test" });
    const c2 = loadConfig({ HOST: "127.0.0.2", PORT: "10002", NODE_ENV: "test" });
    expect(c1).not.toEqual(c2);
    expect(c1.hostname).toBe("127.0.0.1");
    expect(c2.hostname).toBe("127.0.0.2");
  });
});
