import type { Database } from "bun:sqlite";

export function isFirstAdminSetupRequired(client: Database): boolean {
  const hasUser = Boolean(client.query("SELECT id FROM users LIMIT 1").get());
  const state = client.query<{ completed: number }, []>("SELECT completed FROM first_admin_setup_state WHERE id = 1").get() ?? null;
  return !hasUser && !Boolean(state?.completed);
}

export function restoreIdentityEligible(client: Database): boolean {
  try {
    const admins = client.query<{ username: string }, []>("SELECT username FROM users WHERE role = 'admin' AND is_active = 1").all();
    if (admins.some(({ username }) => typeof username === "string" && username.trim() === username && username.length > 0 && username.length <= 255)) return true;
    return isFirstAdminSetupRequired(client);
  } catch {
    return false;
  }
}
