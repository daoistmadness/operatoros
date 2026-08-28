import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";
import { authorize } from "../src/auth/service";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";

function pathFor(label: string): string {
  return `/tmp/operatoros-auth-${label}-${process.pid}-${Date.now()}.db`;
}

function seedUsers(path: string, includeUsers = true): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "from argon2 import PasswordHasher",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); ph = PasswordHasher()",
    "db = sqlite3.connect(path)",
    "include_users = sys.argv[2] == '1'; db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)', [(\"golden-admin\", ph.hash(\"golden-admin-pass-1\"), \"admin\", 1), (\"golden-staff\", ph.hash(\"golden-staff-pass-1\"), \"staff\", 1), (\"golden-inactive\", ph.hash(\"golden-inactive-pass\"), \"staff\", 0)] if include_users else []); db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path, includeUsers ? "1" : "0"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function setup(label: string, includeUsers = true, authOverrides: Record<string, unknown> = {}) {
  const path = pathFor(label);
  const auditDir = `/tmp/operatoros-auth-audit-${process.pid}-${Date.now()}`;
  mkdirSync(auditDir, { recursive: true });
  seedUsers(path, includeUsers);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir, ...authOverrides } });
  return { path, auditDir, database, app };
}

function cleanup(value: ReturnType<typeof setup>): void {
  value.database.close();
  rmSync(value.path, { force: true });
  rmSync(value.auditDir, { recursive: true, force: true });
}

function cookieValue(header: string | null): string {
  const match = header?.match(/astyx_session=([^;]+)/);
  const value = match?.[1];
  if (!value) throw new Error(`session cookie missing: ${header}`);
  return value;
}

describe("authentication parity", () => {
  it("verifies Python Argon2id hashes and preserves the session cookie contract", async () => {
    const value = setup("login");
    try {
      const response = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json", "user-agent": "golden-agent" },
        body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1", role: "staff" }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 1, username: "golden-admin", role: "admin" });
      expect(response.headers.get("set-cookie")).toMatch(/astyx_session=.*HttpOnly.*SameSite=Lax/);
      expect(response.headers.get("set-cookie")).not.toMatch(/Secure/);
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("returns the same generic failure for unknown, wrong, inactive, and locked accounts", async () => {
    const value = setup("failures");
    try {
      for (const input of [
        { username: "ghost-user", password: "whatever" },
        { username: "golden-admin", password: "wrong-pass" },
        { username: "golden-inactive", password: "golden-inactive-pass" },
      ]) {
        const response = await value.app.handle(new Request("http://local/api/auth/login", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
        }));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ detail: "Invalid username or password" });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        await value.app.handle(new Request("http://local/api/auth/login", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "golden-staff", password: `bad-${attempt}` }),
        }));
      }
      const locked = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      expect(locked.status).toBe(401);
      expect(value.database.client.query<{ failed_login_attempts: number }, []>("SELECT failed_login_attempts FROM users WHERE username = 'golden-staff'").get()?.failed_login_attempts).toBe(5);
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("refreshes valid sessions and revokes them on logout or expiry", async () => {
    const value = setup("sessions");
    try {
      const login = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const cookie = cookieValue(login.headers.get("set-cookie"));
      const me = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${cookie}` } }));
      expect(me.status).toBe(200);
      const logout = await value.app.handle(new Request("http://local/api/auth/logout", { method: "POST", headers: { cookie: `astyx_session=${cookie}` } }));
      expect(logout.status).toBe(204);
      const afterLogout = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${cookie}` } }));
      expect(afterLogout.status).toBe(401);

      const secondLogin = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const secondCookie = cookieValue(secondLogin.headers.get("set-cookie"));
      value.database.client.run("UPDATE sessions SET expires_at = datetime('now', '-8 hours'), last_used_at = datetime('now', '-8 hours')");
      const afterExpiry = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${secondCookie}` } }));
      expect(afterExpiry.status).toBe(401);
      expect(value.database.client.query<{ revoked_at: string | null }, []>("SELECT revoked_at FROM sessions ORDER BY id DESC LIMIT 1").get()?.revoked_at).not.toBeNull();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("reports setup status without exposing setup authorization", async () => {
    const value = setup("setup-status");
    try {
      const response = await value.app.handle(new Request("http://local/api/setup/status"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ setup_required: false, setup_token_required: false });
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("resolves role and capability authorization from server state", async () => {
    const value = setup("authorization");
    try {
      const login = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const cookie = cookieValue(login.headers.get("set-cookie"));
      const request = { path: "/api/admin-only", userAgent: null, ipAddress: null };
      expect(authorize({ database: value.database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: value.auditDir } }, cookie, { role: "admin" }, request)).toEqual({ status: 403, message: "Insufficient permissions" });
      expect(authorize({ database: value.database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: value.auditDir } }, cookie, { role: "staff" }, request)).toMatchObject({ user: { username: "golden-staff", role: "staff" } });
      expect(authorize({ database: value.database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: value.auditDir } }, cookie, { capability: "manage_staff" }, request)).toEqual({ status: 403, message: "Insufficient permissions" });
      expect(authorize({ database: value.database, config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: value.auditDir } }, cookie, { capability: "view_student" }, request)).toMatchObject({ user: { username: "golden-staff" } });
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("completes the managed setup token flow and clears the setup cookie", async () => {
    const value = setup("setup-flow", false, { managedDevSetup: true, setupToken: "managed-setup-token" });
    const listener = value.app.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.server as unknown as { port: number }).port;
    try {
      const bootstrap = await fetch(`http://127.0.0.1:${port}/api/setup/bootstrap`, { method: "POST", headers: { origin: "http://127.0.0.1:5173" } });
      expect(bootstrap.status).toBe(204);
      const setupCookie = bootstrap.headers.get("set-cookie")?.match(/operatoros_setup_authorization=([^;]+)/)?.[1];
      expect(setupCookie).toBeTruthy();
      const admin = await fetch(`http://127.0.0.1:${port}/api/setup/admin`, {
        method: "POST", headers: { "content-type": "application/json", cookie: `operatoros_setup_authorization=${setupCookie}` },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password" }),
      });
      expect(admin.status).toBe(201);
      expect(admin.headers.get("set-cookie")).toMatch(/operatoros_setup_authorization=.*Max-Age=0.*SameSite=Strict/);
      expect(await admin.json()).toEqual({ id: 1, username: "first-admin", role: "admin" });
      const status = await fetch(`http://127.0.0.1:${port}/api/setup/status`);
      expect(await status.json()).toEqual({ setup_required: false, setup_token_required: false });
    } finally {
      listener.stop(true);
      cleanup(value);
    }
  }, 30000);
});
