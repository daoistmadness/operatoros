#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { openDatabase } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

export function seedReadinessDatabase(database: string, runtimeRoot: string, username: string, password: string): void {
  if (!username || !password) throw new Error("Readiness administrator credentials are required");
  const selected = validateExistingDatabasePath(database, runtimeRoot);
  const hash = Bun.password.hashSync(password, "argon2id"), handle = openDatabase(selected);
  try {
    handle.client.transaction(() => {
      const inserted = handle.client.run("INSERT INTO users (username,password_hash,role,is_active,failed_login_attempts) VALUES (?,?,'admin',1,0)", [username, hash]);
      handle.client.run("UPDATE first_admin_setup_state SET completed=1,completed_at=CURRENT_TIMESTAMP,created_user_id=?,normalized_username=?,provisioning_source='READINESS_UAT' WHERE id=1", [inserted.lastInsertRowid, username]);
    })();
  } finally { handle.close(); }
}
if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { database: { type: "string" }, "runtime-root": { type: "string" } } });
    if (!values.database || !values["runtime-root"]) throw new TypeError("--database and --runtime-root are required");
    seedReadinessDatabase(values.database, values["runtime-root"], process.env.OPERATOROS_E2E_ADMIN_USERNAME ?? "", process.env.OPERATOROS_E2E_ADMIN_PASSWORD ?? "");
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = error instanceof TypeError ? 2 : 1; }
}
