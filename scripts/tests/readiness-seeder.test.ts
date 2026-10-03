import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { logicalDatabaseContents, logicalFingerprint } from "../../e2e/helpers/db-fingerprint";
import { seedReadinessDatabase } from "../../e2e/helpers/seed-readiness-database";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "operatoros-readiness-fixture-")); roots.push(root); const database = join(root, "state/operatoros.sqlite"); createFreshDatabase(database); return { root, database }; }
test.each([false, true])("readiness seeder preserves canonical schema, credentials, setup ownership, and empty school data", (existingSetup) => {
  const { root, database } = fixture();
  if (existingSetup) { const handle = openDatabase(database); try { handle.client.run("INSERT INTO first_admin_setup_state (id) VALUES (1)"); } finally { handle.close(); } }
  const before = logicalDatabaseContents(database, root);
  seedReadinessDatabase(database, root, "synthetic-readiness-admin", "Synthetic-readiness-password!");
  const after = logicalDatabaseContents(database, root), user = after.tables.users![0]!, setup = after.tables.first_admin_setup_state![0]!;
  expect(after.schemaVersion).toBe(before.schemaVersion); expect(after.schemaFingerprint).toBe(before.schemaFingerprint); expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables)); expect(after.foreignKeyViolations).toEqual([]);
  expect(user).toMatchObject({ id: 1, username: "synthetic-readiness-admin", role: "admin", is_active: 1, failed_login_attempts: 0 });
  expect(Bun.password.verifySync("Synthetic-readiness-password!", String(user.password_hash))).toBe(true); expect(Bun.password.verifySync("wrong", String(user.password_hash))).toBe(false);
  if (existingSetup) { expect(setup).toMatchObject({ completed: 1, created_user_id: user.id, normalized_username: user.username, provisioning_source: "READINESS_UAT" }); expect(setup.completed_at).toBeString(); }
  else expect(after.tables.first_admin_setup_state).toEqual([]);
  for (const [name, rows] of Object.entries(before.tables)) if (name !== "users" && name !== "first_admin_setup_state") expect(after.tables[name]).toEqual(rows);
});
test("logical fingerprints ignore SQLite file layout but detect business changes", () => {
  const { root, database } = fixture(), copy = join(root, "copy.sqlite"); seedReadinessDatabase(database, root, "synthetic-admin", "Synthetic-password!"); copyFileSync(database, copy);
  const before = logicalDatabaseContents(database, root), handle = openDatabase(copy);
  try { handle.client.exec("VACUUM"); } finally { handle.close(); }
  expect(logicalFingerprint(logicalDatabaseContents(copy, root))).toBe(logicalFingerprint(before));
  const changed = openDatabase(copy); try { changed.client.run("UPDATE users SET failed_login_attempts=1"); } finally { changed.close(); }
  expect(logicalFingerprint(logicalDatabaseContents(copy, root))).not.toBe(logicalFingerprint(before));
});
test("seeders reject missing, outside-root, and symlinked paths without creating or changing files", () => {
  const { root, database } = fixture(), bytes = readFileSync(database), alias = join(root, "alias.sqlite"); symlinkSync(database, alias);
  expect(() => seedReadinessDatabase(alias, root, "fixture", "password")).toThrow("symlinks");
  const directoryAlias = join(root, "directory-alias"); symlinkSync(join(root, "state"), directoryAlias);
  expect(() => seedReadinessDatabase(join(directoryAlias, "operatoros.sqlite"), root, "fixture", "password")).toThrow("symlinks");
  expect(() => seedReadinessDatabase(database, join(root, "other"), "fixture", "password")).toThrow("inside the disposable E2E runtime root");
  const missing = join(root, "missing.sqlite"); expect(() => seedReadinessDatabase(missing, root, "fixture", "password")).toThrow(); expect(existsSync(missing)).toBe(false); expect(readFileSync(database)).toEqual(bytes);
  expect(() => seedReadinessDatabase(database, root, "", "password")).toThrow("credentials");
});
test("duplicate readiness provisioning rolls back rather than replacing the administrator", () => {
  const { root, database } = fixture(); seedReadinessDatabase(database, root, "synthetic-admin", "Synthetic-password!");
  const before = logicalDatabaseContents(database, root); expect(() => seedReadinessDatabase(database, root, "synthetic-admin", "different")).toThrow(); expect(logicalDatabaseContents(database, root)).toEqual(before);
});
