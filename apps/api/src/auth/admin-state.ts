import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { isAccountUnlocked } from "./sqlite-date";

const passwordHashProbe = randomBytes(32).toString("base64url");

export type RestoreAdministratorCredential = { username: string; password: string };

function usablePasswordHash(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    // A random wrong password checks that the stored hash is parseable without asserting operator knowledge.
    Bun.password.verifySync(passwordHashProbe, value);
    return true;
  } catch {
    return false;
  }
}

export function isFirstAdminSetupRequired(client: Database): boolean {
  const hasUser = Boolean(client.query("SELECT id FROM users LIMIT 1").get());
  const state = client.query<{ completed: number }, []>("SELECT completed FROM first_admin_setup_state WHERE id = 1").get() ?? null;
  return !hasUser && !Boolean(state?.completed);
}

export function restoreIdentityEligible(client: Database): boolean {
  return restoreIdentityState(client).eligible;
}

export function restoreIdentityState(client: Database): { eligible: boolean; blockingReason: string | null } {
  try {
    const admins = client.query<{ username: string; password_hash: string; locked_until: string | null }, []>("SELECT username, password_hash, locked_until FROM users WHERE role = 'admin' AND is_active = 1").all();
    const addressable = admins.filter(({ username }) => typeof username === "string" && username.trim() === username && username.length > 0 && username.length <= 255);
    const parseable = addressable.filter(({ password_hash }) => usablePasswordHash(password_hash));
    if (parseable.some(({ locked_until }) => isAccountUnlocked(locked_until)) || isFirstAdminSetupRequired(client)) return { eligible: true, blockingReason: null };
    if (parseable.length > 0) return { eligible: false, blockingReason: "active_administrator_locked" };
    return { eligible: false, blockingReason: addressable.length ? "active_administrator_password_hash_invalid" : "active_administrator_missing" };
  } catch {
    return { eligible: false, blockingReason: "active_administrator_unavailable" };
  }
}

export function restoreAdministratorCredentialMatches(client: Database, username: unknown, password: unknown): boolean {
  if (typeof username !== "string" || !username || username.trim() !== username || username.length > 255 || typeof password !== "string" || !password) return false;
  try {
    const admin = client.query<{ password_hash: string; locked_until: string | null }, string>("SELECT password_hash, locked_until FROM users WHERE username = ? AND role = 'admin' AND is_active = 1").get(username);
    return Boolean(admin && isAccountUnlocked(admin.locked_until) && Bun.password.verifySync(password, admin.password_hash));
  } catch {
    return false;
  }
}
