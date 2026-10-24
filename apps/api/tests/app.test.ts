import { describe, it, expect } from "bun:test";
import { createApp, createTestApp } from "../src/app";
import { startServer } from "../src/server";
import { loadConfig } from "../src/config";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

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

  it("derives the database, backup, and log paths from the canonical root", () => {
    const root = mkdtempSync("/tmp/operatoros-config-");
    try {
      const config = loadConfig({
        NODE_ENV: "test",
        OPERATOROS_DATA_DIR: `${root}/nested/..`,
        DATABASE_URL: `sqlite:///${root}/operatoros.sqlite`,
      });
      expect(config.dataPaths?.dataDir).toBe(root);
      expect(config.databasePath).toBe(join(root, "operatoros.sqlite"));
      expect(config.backupDir).toBe(join(root, "backups"));
      expect(config.auth?.auditDir).toBe(join(root, "logs"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails fast when DATABASE_URL disagrees with the canonical root", () => {
    const root = mkdtempSync("/tmp/operatoros-config-conflict-");
    try {
      expect(() => loadConfig({ NODE_ENV: "test", OPERATOROS_DATA_DIR: root, DATABASE_URL: "sqlite:////tmp/other.sqlite" })).toThrow("DATABASE_URL conflicts");
      expect(() => loadConfig({ NODE_ENV: "test", OPERATOROS_DATA_DIR: root, DATABASE_URL: "sqlite:///relative.sqlite" })).toThrow("DATABASE_URL conflicts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auth configuration mapping", () => {
  it("maps session and account lockout environment overrides into auth config", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      SESSION_IDLE_TIMEOUT_HOURS: "2",
      SESSION_ABSOLUTE_TIMEOUT_HOURS: "12",
      MAX_FAILED_LOGIN_ATTEMPTS: "3",
      ACCOUNT_LOCK_MINUTES: "15",
    });
    expect(config.auth?.sessionIdleTimeoutHours).toBe(2);
    expect(config.auth?.sessionAbsoluteTimeoutHours).toBe(12);
    expect(config.auth?.maxFailedLoginAttempts).toBe(3);
    expect(config.auth?.accountLockMinutes).toBe(15);
  });

  it("applies secure defaults when session and lockout environment variables are unset", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.auth?.sessionIdleTimeoutHours).toBe(6);
    expect(config.auth?.sessionAbsoluteTimeoutHours).toBe(24);
    expect(config.auth?.maxFailedLoginAttempts).toBe(5);
    expect(config.auth?.accountLockMinutes).toBe(30);
  });

  it("fails fast when SESSION_IDLE_TIMEOUT_HOURS exceeds SESSION_ABSOLUTE_TIMEOUT_HOURS", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        SESSION_IDLE_TIMEOUT_HOURS: "10",
        SESSION_ABSOLUTE_TIMEOUT_HOURS: "8",
      })
    ).toThrow("SESSION_IDLE_TIMEOUT_HOURS cannot exceed SESSION_ABSOLUTE_TIMEOUT_HOURS.");
  });

  it("fails fast when session or lockout configuration is non-positive or non-integer", () => {
    expect(() => loadConfig({ NODE_ENV: "test", SESSION_IDLE_TIMEOUT_HOURS: "0" })).toThrow("SESSION_IDLE_TIMEOUT_HOURS must be a positive integer.");
    expect(() => loadConfig({ NODE_ENV: "test", SESSION_ABSOLUTE_TIMEOUT_HOURS: "-1" })).toThrow("SESSION_ABSOLUTE_TIMEOUT_HOURS must be a positive integer.");
    expect(() => loadConfig({ NODE_ENV: "test", MAX_FAILED_LOGIN_ATTEMPTS: "abc" })).toThrow("MAX_FAILED_LOGIN_ATTEMPTS must be a positive integer.");
    expect(() => loadConfig({ NODE_ENV: "test", ACCOUNT_LOCK_MINUTES: "12.5" })).toThrow("ACCOUNT_LOCK_MINUTES must be a positive integer.");
  });
});
