import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { inTransaction, type DatabaseHandle } from "@operatoros/db";
import { resolveOperatorOSPaths } from "@operatoros/db";
import { capabilitiesForRole } from "./capabilities";

export const SESSION_COOKIE_NAME = "astyx_session";
export const SETUP_COOKIE_NAME = "operatoros_setup_authorization";
export const GENERIC_LOGIN_ERROR = "Invalid username or password";
const DUMMY_PASSWORD_HASH = Bun.password.hashSync("astryx-dummy-password-not-an-account", "argon2id");

export interface AuthConfig {
  authCookieSecret: string;
  cookieSecure: boolean;
  sessionIdleTimeoutHours: number;
  sessionAbsoluteTimeoutHours: number;
  maxFailedLoginAttempts: number;
  accountLockMinutes: number;
  setupToken?: string;
  managedDevSetup: boolean;
  allowedOrigins: string[];
  auditDir: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: number;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
}

export interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

export interface AuthContext {
  database: DatabaseHandle;
  config: AuthConfig;
}

export interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

export interface ProvisioningErrorShape {
  code: string;
  message: string;
  status: number;
}

export function defaultAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    authCookieSecret: overrides.authCookieSecret ?? "",
    cookieSecure: overrides.cookieSecure ?? false,
    sessionIdleTimeoutHours: overrides.sessionIdleTimeoutHours ?? 6,
    sessionAbsoluteTimeoutHours: overrides.sessionAbsoluteTimeoutHours ?? 24,
    maxFailedLoginAttempts: overrides.maxFailedLoginAttempts ?? 5,
    accountLockMinutes: overrides.accountLockMinutes ?? 30,
    managedDevSetup: overrides.managedDevSetup ?? false,
    allowedOrigins: overrides.allowedOrigins ?? [
      "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173",
    ],
    auditDir: overrides.auditDir ?? resolveOperatorOSPaths().logDir,
    setupToken: overrides.setupToken,
  };
}

function requireSecret(config: AuthConfig): string {
  if (config.authCookieSecret.trim().length < 32) throw new Error("AUTH_COOKIE_SECRET must be configured with at least 32 characters");
  return config.authCookieSecret;
}

function nowSqlite(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function futureSqlite(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString().replace("T", " ").replace("Z", "");
}

function parseSqliteDate(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

function digest(token: string, config: AuthConfig): string {
  return createHmac("sha256", requireSecret(config)).update(token).digest("hex");
}

function clientIp(request: Request, server: { requestIP(request: Request): { address: string } | null } | null): string | null {
  return server?.requestIP(request)?.address ?? null;
}

function audit(context: AuthContext, event: string, values: Partial<{
  userId: number | null;
  username: string | null;
  sessionIdHash: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  reason: string;
}>): void {
  const directory = context.config.auditDir;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "authentication_audit.jsonl");
  const entry = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event,
    user_id: values.userId ?? null,
    username: values.username?.slice(0, 255) || null,
    session_id_hash: values.sessionIdHash ?? null,
    user_agent: values.userAgent?.slice(0, 1024) || null,
    ip_address: values.ipAddress?.slice(0, 45) || null,
    metadata: values.metadata ?? {},
    ...(values.reason ? { reason: values.reason.slice(0, 128) } : {}),
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function userResponse(user: CurrentUser): CurrentUser {
  return user;
}

function findUser(client: Database, username: string): UserRow | null {
  return client.query<UserRow, string>(
    "SELECT id, username, password_hash, role, is_active, failed_login_attempts, locked_until, last_login_at FROM users WHERE username = ?",
  ).get(username) ?? null;
}

function currentUser(client: Database, id: number): UserRow | null {
  return client.query<UserRow, number>(
    "SELECT id, username, password_hash, role, is_active, failed_login_attempts, locked_until, last_login_at FROM users WHERE id = ?",
  ).get(id) ?? null;
}

async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, passwordHash);
  } catch {
    return false;
  }
}

export async function authenticate(
  context: AuthContext,
  input: { username: string; password: string; userAgent: string | null; ipAddress: string | null },
): Promise<{ user: CurrentUser; token: string; tokenHash: string }> {
  const username = input.username.trim();
  const client = context.database.client;
  const user = findUser(client, username);
  if (!user) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    audit(context, "login_failed", { username, userAgent: input.userAgent, ipAddress: input.ipAddress, reason: "invalid_credentials" });
    throw new Error(GENERIC_LOGIN_ERROR);
  }
  if (!user.is_active) {
    audit(context, "login_failed", { userId: user.id, username: user.username, userAgent: input.userAgent, ipAddress: input.ipAddress, reason: "inactive_account" });
    throw new Error(GENERIC_LOGIN_ERROR);
  }
  const lockedUntil = parseSqliteDate(user.locked_until);
  if (lockedUntil !== null && lockedUntil > Date.now()) {
    audit(context, "login_failed", { userId: user.id, username: user.username, userAgent: input.userAgent, ipAddress: input.ipAddress, reason: "account_locked" });
    throw new Error(GENERIC_LOGIN_ERROR);
  }
  if (!(await verifyPassword(input.password, user.password_hash))) {
    const attempts = user.failed_login_attempts + 1;
    const lock = attempts >= context.config.maxFailedLoginAttempts;
    inTransaction(client, () => {
      client.run("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?", [
        attempts, lock ? futureSqlite(context.config.accountLockMinutes * 60_000) : null, user.id,
      ]);
    });
    audit(context, "login_failed", { userId: user.id, username: user.username, userAgent: input.userAgent, ipAddress: input.ipAddress, reason: "invalid_credentials" });
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  const now = nowSqlite();
  const absoluteExpires = futureSqlite(context.config.sessionAbsoluteTimeoutHours * 3_600_000);
  const idleExpires = futureSqlite(context.config.sessionIdleTimeoutHours * 3_600_000);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest(token, context.config);
  inTransaction(client, () => {
    client.run(
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
      [now, now, user.id],
    );
    client.run(
      "INSERT INTO sessions (user_id, token_hash, created_at, last_used_at, expires_at, absolute_expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [user.id, tokenHash, now, now, idleExpires < absoluteExpires ? idleExpires : absoluteExpires, absoluteExpires, input.userAgent?.slice(0, 1024) || null, input.ipAddress?.slice(0, 45) || null],
    );
  });
  audit(context, "login_success", { userId: user.id, username: user.username, sessionIdHash: tokenHash, userAgent: input.userAgent, ipAddress: input.ipAddress });
  return { user: userResponse({ id: user.id, username: user.username, role: user.role }), token, tokenHash };
}

export function findSession(context: AuthContext, token: string | null): SessionRow | null {
  if (!token) return null;
  return context.database.client.query<SessionRow, string>(
    "SELECT id, user_id, token_hash, expires_at, absolute_expires_at, revoked_at FROM sessions WHERE token_hash = ?",
  ).get(digest(token, context.config)) ?? null;
}

export function validateSession(context: AuthContext, token: string | null, refreshActivity = true): CurrentUser | null {
  const session = findSession(context, token);
  if (!session || session.revoked_at) return null;
  const now = Date.now();
  const expires = parseSqliteDate(session.expires_at);
  const absolute = parseSqliteDate(session.absolute_expires_at);
  if ((expires !== null && now >= expires) || (absolute !== null && now >= absolute)) {
    inTransaction(context.database.client, () => {
      context.database.client.run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [nowSqlite(), session.id]);
    });
    return null;
  }
  const user = currentUser(context.database.client, session.user_id);
  if (!user || !user.is_active) return null;
  const refreshed = futureSqlite(context.config.sessionIdleTimeoutHours * 3_600_000);
  const nextExpiry = refreshed < session.absolute_expires_at ? refreshed : session.absolute_expires_at;
  if (refreshActivity) inTransaction(context.database.client, () => {
    context.database.client.run("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?", [nowSqlite(), nextExpiry, session.id]);
  });
  return { id: user.id, username: user.username, role: user.role };
}

export function authorize(
  context: AuthContext,
  token: string | null,
  requirement: { role?: "admin" | "staff"; capability?: string; refreshSession?: boolean },
  request: { path: string; userAgent: string | null; ipAddress: string | null },
): { user: CurrentUser } | { status: 401 | 403; message: string } {
  const user = validateSession(context, token, requirement.refreshSession !== false);
  if (!user) return { status: 401, message: "Authentication required" };
  const allowed = requirement.role ? user.role === requirement.role : requirement.capability ? capabilitiesForRole(user.role).includes(requirement.capability) : true;
  if (allowed) return { user };
  audit(context, "authorization_denied", {
    userId: user.id, username: user.username, userAgent: request.userAgent, ipAddress: request.ipAddress,
    reason: requirement.role ? `requires_${requirement.role}` : "missing_capability",
    metadata: requirement.capability ? { capability: requirement.capability } : {},
  });
  return { status: 403, message: "Insufficient permissions" };
}

export function logout(context: AuthContext, token: string | null, userAgent: string | null, ipAddress: string | null): void {
  const session = findSession(context, token);
  const user = session ? currentUser(context.database.client, session.user_id) : null;
  if (session) {
    inTransaction(context.database.client, () => {
      context.database.client.run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [nowSqlite(), session.id]);
    });
  }
  audit(context, "logout", {
    userId: user?.id ?? null, username: user?.username ?? null, sessionIdHash: session?.token_hash ?? null,
    userAgent, ipAddress, metadata: { session_found: session !== null },
  });
}

function setupToken(configuration: AuthConfig): string {
  if (!configuration.setupToken) throw { code: "SETUP_AUTHORIZATION_UNAVAILABLE", message: "Initial setup authorization is unavailable.", status: 403 } satisfies ProvisioningErrorShape;
  return configuration.setupToken;
}

export function setupStatus(context: AuthContext): { setup_required: boolean; setup_token_required: boolean } {
  const client = context.database.client;
  const hasUser = Boolean(client.query("SELECT id FROM users LIMIT 1").get());
  const state = client.query<{ completed: number }, []>("SELECT completed FROM first_admin_setup_state WHERE id = 1").get() ?? null;
  const required = !hasUser && !Boolean(state?.completed);
  return { setup_required: required, setup_token_required: required && Boolean(context.config.setupToken) && !context.config.managedDevSetup };
}

function localOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin || !allowedOrigins.includes(origin)) return false;
  try {
    const parsed = new URL(origin);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function issueSetupAuthorization(context: AuthContext, request: Request, server: { requestIP(request: Request): { address: string } | null } | null): string {
  const address = server?.requestIP(request)?.address;
  if (!context.config.managedDevSetup || !address || !["127.0.0.1", "::1", "localhost"].includes(address) || !localOrigin(request.headers.get("origin"), context.config.allowedOrigins)) {
    throw { code: "SETUP_AUTHORIZATION_UNAVAILABLE", message: "Initial setup authorization is unavailable.", status: 403 } satisfies ProvisioningErrorShape;
  }
  const issued = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${issued}.${nonce}`;
  const signature = createHmac("sha256", setupToken(context.config)).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function validateSetupAuthorization(context: AuthContext, value: string | null): string {
  if (!value) throw { code: "SETUP_AUTHORIZATION_REQUIRED", message: "Initial setup authorization is required.", status: 403 } satisfies ProvisioningErrorShape;
  const [issuedText, nonce, supplied] = value.split(".", 3);
  const issued = Number(issuedText);
  if (!nonce || !supplied || !Number.isInteger(issued)) throw { code: "SETUP_AUTHORIZATION_INVALID", message: "Initial setup authorization is invalid.", status: 403 } satisfies ProvisioningErrorShape;
  const current = Math.floor(Date.now() / 1000);
  if (issued > current + 30 || current - issued > 300) throw { code: "SETUP_AUTHORIZATION_EXPIRED", message: "Initial setup authorization has expired.", status: 403 } satisfies ProvisioningErrorShape;
  const payload = `${issued}.${nonce}`;
  const expected = createHmac("sha256", setupToken(context.config)).update(payload).digest("hex");
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw { code: "SETUP_AUTHORIZATION_INVALID", message: "Initial setup authorization is invalid.", status: 403 } satisfies ProvisioningErrorShape;
  }
  return context.config.setupToken ?? "";
}

export async function provisionFirstAdmin(
  context: AuthContext,
  input: { username: string; password: string; confirmation: string; setupToken: string | null; userAgent: string | null; ipAddress: string | null },
): Promise<{ id: number; username: string; role: string }> {
  if (input.password !== input.confirmation) throw { code: "PASSWORD_CONFIRMATION_MISMATCH", message: "Password confirmation does not match.", status: 400 } satisfies ProvisioningErrorShape;
  const username = input.username.trim();
  if (!username || username.length > 255) throw { code: "INVALID_ADMIN_USERNAME", message: "A valid administrator username is required.", status: 400 } satisfies ProvisioningErrorShape;
  if (context.config.setupToken && !context.config.managedDevSetup) {
    const expected = setupToken(context.config);
    if (!input.setupToken || input.setupToken.length !== expected.length || !timingSafeEqual(Buffer.from(input.setupToken), Buffer.from(expected))) {
      throw { code: input.setupToken ? "SETUP_TOKEN_INVALID" : "SETUP_TOKEN_REQUIRED", message: "A valid setup token is required.", status: 403 } satisfies ProvisioningErrorShape;
    }
  }
  if (input.password.length < 12) throw { code: "PASSWORD_POLICY_FAILED", message: "Password must be at least 12 characters long.", status: 400 } satisfies ProvisioningErrorShape;
  const hash = await Bun.password.hash(input.password, "argon2id");
  const client = context.database.client;
  let created: { id: number; username: string; role: string } | null = null;
  inTransaction(client, () => {
    client.run("INSERT INTO first_admin_setup_state (id, completed) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
    const state = client.query<{ completed: number }, number>("SELECT completed FROM first_admin_setup_state WHERE id = ?").get(1);
    const existing = client.query<{ id: number; username: string }, []>("SELECT id, username FROM users ORDER BY id LIMIT 1").get();
    if (state?.completed || existing) throw { code: "SETUP_ALREADY_COMPLETED", message: "Initial administrator setup has already been completed.", status: 409 } satisfies ProvisioningErrorShape;
    const now = nowSqlite();
    const result = client.run("INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at, failed_login_attempts) VALUES (?, ?, 'admin', 1, ?, ?, 0)", [username, hash, now, now]);
    const id = Number(result.lastInsertRowid);
    client.run("UPDATE first_admin_setup_state SET completed = 1, completed_at = ?, created_user_id = ?, normalized_username = ?, provisioning_source = ?, updated_at = ? WHERE id = 1", [now, id, username, "WEB_SETUP", now]);
    created = { id, username, role: "admin" };
  });
  const createdUser = created as { id: number; username: string; role: string } | null;
  if (!createdUser) throw new Error("PROVISIONING_FAILED");
  audit(context, "FIRST_ADMIN_PROVISIONED", { userId: createdUser.id, username: createdUser.username, userAgent: input.userAgent, ipAddress: input.ipAddress, metadata: { provisioning_source: "WEB_SETUP" } });
  return createdUser;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function cookieHeader(name: string, value: string, options: { maxAge: number; path: string; secure: boolean; sameSite: "Lax" | "Strict"; expires?: string }): string {
  const encoded = encodeURIComponent(value);
  const expires = options.expires ? `; Expires=${options.expires}` : `; Expires=${new Date(Date.now() + options.maxAge * 1000).toUTCString()}`;
  return `${name}=${encoded}; Max-Age=${options.maxAge}${expires}; Path=${options.path}; HttpOnly; SameSite=${options.sameSite}${options.secure ? "; Secure" : ""}`;
}

export function deleteCookieHeader(name: string, path: string, secure: boolean, sameSite: "Lax" | "Strict"): string {
  return cookieHeader(name, "", { maxAge: 0, path, secure, sameSite, expires: "Thu, 01 Jan 1970 00:00:00 GMT" });
}

export function requestContext(request: Request, server: { requestIP(request: Request): { address: string } | null } | null): { userAgent: string | null; ipAddress: string | null } {
  return { userAgent: request.headers.get("user-agent"), ipAddress: clientIp(request, server) };
}
