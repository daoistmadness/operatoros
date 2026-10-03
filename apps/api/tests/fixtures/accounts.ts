import { createFreshDatabase, openDatabase } from "@operatoros/db";

export function createAccountFixture(path: string, kind: "golden" | "golden-active" | "readiness"): void {
  createFreshDatabase(path);
  const handle = openDatabase(path);
  try {
    handle.client.transaction(() => {
      const prefix = kind === "readiness" ? "readiness" : "golden";
      const accounts: [string, string, string, number][] = [[`${prefix}-admin`, `${prefix}-admin-pass-1`, "admin", 1], [`${prefix}-staff`, `${prefix}-staff-pass-1`, "staff", 1]];
      if (kind === "golden") accounts.push(["golden-inactive", "golden-inactive-pass", "staff", 0]);
      for (const [username, password, role, active] of accounts) handle.client.run("INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,?)", [username, Bun.password.hashSync(password, "argon2id"), role, active]);
    })();
  } finally { handle.close(); }
}
