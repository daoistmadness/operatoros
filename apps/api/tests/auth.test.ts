import { describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import { LoginRateLimiter } from "../src/auth/rate-limit";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { authorize } from "../src/auth/service";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "astryx-test-only-cookie-secret-32-chars";

function pathFor(label: string): string {
  return `/tmp/operatoros-auth-${label}-${process.pid}-${Date.now()}.db`;
}

function seedUsers(path: string, includeUsers = true): void {
  if (includeUsers) createAccountFixture(path, "golden"); else createFreshDatabase(path);
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

  it("counts simultaneous failures through the lockout threshold", async () => {
    const value = setup("concurrent-failures");
    try {
      const responses = await Promise.all(Array.from({ length: 5 }, (_, attempt) => value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: `parallel-bad-${attempt}` }),
      }))));
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);

      const user = value.database.client.query<{ failed_login_attempts: number; locked_until: string | null }, []>(
        "SELECT failed_login_attempts, locked_until FROM users WHERE username = 'golden-staff'",
      ).get();
      expect(user?.failed_login_attempts).toBe(5);
      expect(user?.locked_until).not.toBeNull();

      const lockedLogin = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      expect(lockedLogin.status).toBe(401);
      expect(value.database.client.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()?.count).toBe(0);
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("does not let a valid login clear a lock established while its password is verifying", async () => {
    const value = setup("concurrent-lock-race");
    const originalVerify = Bun.password.verify;
    let releaseVerification!: () => void;
    let markVerificationStarted!: () => void;
    const verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const verificationStarted = new Promise<void>((resolve) => { markVerificationStarted = resolve; });
    let correctAttempt: Promise<Response> | undefined;

    Bun.password.verify = async (password, passwordHash) => {
      if (password === "golden-staff-pass-1") {
        markVerificationStarted();
        await verificationGate;
      }
      return originalVerify.call(Bun.password, password, passwordHash);
    };

    try {
      correctAttempt = value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      await verificationStarted;

      const failures = await Promise.all(Array.from({ length: 5 }, (_, attempt) => value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: `race-bad-${attempt}` }),
      }))));
      expect(failures.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);

      releaseVerification();
      expect((await correctAttempt).status).toBe(401);
      expect(value.database.client.query<{ failed_login_attempts: number; locked_until: string | null }, []>(
        "SELECT failed_login_attempts, locked_until FROM users WHERE username = 'golden-staff'",
      ).get()).toMatchObject({ failed_login_attempts: 5 });
      expect(value.database.client.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()?.count).toBe(0);
    } finally {
      releaseVerification();
      await correctAttempt?.catch(() => undefined);
      Bun.password.verify = originalVerify;
      cleanup(value);
    }
  }, 30000);

  it("allows login after lock expiry and resets persisted failure state", async () => {
    const value = setup("expired-lock");
    try {
      value.database.client.run(
        "UPDATE users SET failed_login_attempts = 5, locked_until = datetime('now', '-1 minute') WHERE username = 'golden-staff'",
      );
      const response = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      expect(response.status).toBe(200);
      expect(value.database.client.query<{ failed_login_attempts: number; locked_until: string | null }, []>(
        "SELECT failed_login_attempts, locked_until FROM users WHERE username = 'golden-staff'",
      ).get()).toEqual({ failed_login_attempts: 0, locked_until: null });
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("keeps limiter windows stable across a backward wall-clock step", () => {
    // Regression: the limiter must run on a monotonic clock. A backward NTP
    // step previously stretched Retry-After from 60 to 61 seconds and could
    // extend windows unpredictably.
    const limiter = new LoginRateLimiter({ windowMs: 60_000, perIp: 20, perAccount: 2, global: 20, maxEntries: 20 });
    const first = limiter.consume("203.0.113.9", "clock-user");
    expect(first.allowed).toBe(true);
    const second = limiter.consume("203.0.113.9", "clock-user");
    expect(second.allowed).toBe(true);
    const third = limiter.consume("203.0.113.9", "clock-user");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(60);
  });

  it("applies a second layered login limiter without changing generic failures", async () => {
    const value = setup("rate-limit", true, { rateLimit: { windowMs: 60_000, perIp: 20, perAccount: 2, global: 20, maxEntries: 20 } });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await value.app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: `wrong-${attempt}` }) }));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ detail: "Invalid username or password" });
      }
      const limited = await value.app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "wrong-3" }) }));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(await limited.json()).toEqual({ detail: "Too many login attempts. Try again later." });
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
      const me = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" } }));
      expect(me.status).toBe(200);
      const logout = await value.app.handle(new Request("http://local/api/auth/logout", { method: "POST", headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" } }));
      expect(logout.status).toBe(204);
      const afterLogout = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" } }));
      expect(afterLogout.status).toBe(401);

      const secondLogin = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const secondCookie = cookieValue(secondLogin.headers.get("set-cookie"));
      value.database.client.run("UPDATE sessions SET expires_at = datetime('now', '-8 hours'), last_used_at = datetime('now', '-8 hours')");
      const afterExpiry = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: `astyx_session=${secondCookie}`, origin: "http://localhost:5173" } }));
      expect(afterExpiry.status).toBe(401);
      expect(value.database.client.query<{ revoked_at: string | null }, []>("SELECT revoked_at FROM sessions ORDER BY id DESC LIMIT 1").get()?.revoked_at).not.toBeNull();
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("rejects cross-origin logout without revoking the current session", async () => {
    const value = setup("logout-origin");
    try {
      const login = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const cookie = cookieValue(login.headers.get("set-cookie"));

      const rejected = await value.app.handle(new Request("http://local/api/auth/logout", {
        method: "POST", headers: { cookie: `astyx_session=${cookie}`, origin: "http://evil.example" },
      }));
      expect(rejected.status).toBe(403);

      const stillActive = await value.app.handle(new Request("http://local/api/auth/me", {
        headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" },
      }));
      expect(stillActive.status).toBe(200);

      const confirmed = await value.app.handle(new Request("http://local/api/auth/logout", {
        method: "POST", headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" },
      }));
      expect(confirmed.status).toBe(204);

      const afterLogout = await value.app.handle(new Request("http://local/api/auth/me", {
        headers: { cookie: `astyx_session=${cookie}`, origin: "http://localhost:5173" },
      }));
      expect(afterLogout.status).toBe(401);
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

  it("rechecks a synthetic same-user role change on the existing session", async () => {
    const value = setup("role-change");
    try {
      const login = await value.app.handle(new Request("http://local/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
      }));
      const cookie = cookieValue(login.headers.get("set-cookie"));
      const session = `astyx_session=${cookie}`;
      const authContext = {
        database: value.database,
        config: { authCookieSecret: secret, cookieSecure: false, sessionIdleTimeoutHours: 6, sessionAbsoluteTimeoutHours: 24, maxFailedLoginAttempts: 5, accountLockMinutes: 30, managedDevSetup: false, allowedOrigins: [], auditDir: value.auditDir },
      };
      const request = { path: "/api/admin-only", userAgent: null, ipAddress: null };
      const before = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: session } }));
      const beforeUser = await before.json() as { id: number; role: string; capabilities: string[] };
      expect(beforeUser.role).toBe("admin");

      value.database.client.run("UPDATE users SET role = 'staff' WHERE id = ?", [beforeUser.id]);
      const after = await value.app.handle(new Request("http://local/api/auth/me", { headers: { cookie: session } }));
      expect(after.status).toBe(200);
      const afterUser = await after.json() as { id: number; role: string; capabilities: string[] };
      expect(afterUser).toMatchObject({ id: beforeUser.id, role: "staff" });
      expect(afterUser.capabilities).not.toContain("manage_staff");
      expect(authorize(authContext, cookie, { role: "admin" }, request)).toEqual({ status: 403, message: "Insufficient permissions" });
      expect(authorize(authContext, cookie, { capability: "manage_staff" }, request)).toEqual({ status: 403, message: "Insufficient permissions" });
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
        method: "POST", headers: { "content-type": "application/json", cookie: `operatoros_setup_authorization=${setupCookie}`, origin: "http://localhost:5173" },
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

  it("provisions the first administrator with the configured setup token outside managed development", async () => {
    const value = setup("setup-token-production", false, { setupToken: "synthetic-production-setup-token" });
    try {
      const initial = await value.app.handle(new Request("http://local/api/setup/status"));
      expect(await initial.json()).toEqual({ setup_required: true, setup_token_required: true });

      const withoutToken = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password" }),
      }));
      expect(withoutToken.status).toBe(403);
      expect(((await withoutToken.json()) as any).detail.code).toBe("SETUP_TOKEN_REQUIRED");

      const wrongToken = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password", setup_token: "wrong-synthetic-token" }),
      }));
      expect(wrongToken.status).toBe(403);
      expect(((await wrongToken.json()) as any).detail.code).toBe("SETUP_TOKEN_INVALID");

      const created = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password", setup_token: "synthetic-production-setup-token" }),
      }));
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: 1, username: "first-admin", role: "admin" });

      const repeated = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "second-admin", password: "second-admin-password", password_confirmation: "second-admin-password", setup_token: "synthetic-production-setup-token" }),
      }));
      expect(repeated.status).toBe(409);
      expect(((await repeated.json()) as any).detail.code).toBe("SETUP_ALREADY_COMPLETED");

      const after = await value.app.handle(new Request("http://local/api/setup/status"));
      expect(await after.json()).toEqual({ setup_required: false, setup_token_required: false });
      expect(value.database.client.query("SELECT username FROM users ORDER BY id").all()).toEqual([{ username: "first-admin" }]);
      for (const file of readdirSync(value.auditDir, { withFileTypes: true }).filter((entry) => entry.isFile())) {
        expect(readFileSync(join(value.auditDir, file.name), "utf8")).not.toContain("synthetic-production-setup-token");
      }
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("keeps first-run provisioning closed when no setup token is configured", async () => {
    const value = setup("setup-closed", false);
    try {
      const status = await value.app.handle(new Request("http://local/api/setup/status"));
      expect(await status.json()).toEqual({ setup_required: true, setup_token_required: false });
      const admin = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password" }),
      }));
      expect(admin.status).toBe(403);
      expect(((await admin.json()) as any).detail.code).toBe("SETUP_AUTHORIZATION_REQUIRED");
      const bootstrap = await value.app.handle(new Request("http://local/api/setup/bootstrap", { method: "POST" }));
      expect(bootstrap.status).toBe(403);
      expect(((await bootstrap.json()) as any).detail.code).toBe("SETUP_AUTHORIZATION_UNAVAILABLE");
      expect(value.database.client.query("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    } finally {
      cleanup(value);
    }
  }, 30000);

  it("does not accept a raw setup token in managed development without the setup cookie", async () => {
    const value = setup("setup-managed-raw", false, { managedDevSetup: true, setupToken: "managed-synthetic-token" });
    try {
      const admin = await value.app.handle(new Request("http://local/api/setup/admin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "first-admin", password: "first-admin-password", password_confirmation: "first-admin-password", setup_token: "managed-synthetic-token" }),
      }));
      expect(admin.status).toBe(403);
      expect(((await admin.json()) as any).detail.code).toBe("SETUP_AUTHORIZATION_REQUIRED");
      expect(value.database.client.query("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    } finally {
      cleanup(value);
    }
  }, 30000);
});
