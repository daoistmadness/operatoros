import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateDatabasePath } from "../../e2e/helpers/create-test-workspace";

const repository = resolve(import.meta.dir, "../..");
test("lexical workspace guard rejects escape and protected paths before file access", () => {
  const root = "/tmp/operatoros-e2e-path-only-fixture", runtime = join(root, "runtime"), repo = join(root, "repository");
  expect(existsSync(root)).toBe(false);
  for (const path of ["relative.sqlite", "../state/db.sqlite"]) expect(() => validateDatabasePath(path, runtime, repo)).toThrow("absolute path");
  for (const path of [join(root, "elsewhere.sqlite"), `${runtime}-sibling/state/db.sqlite`, `${runtime}/../outside.sqlite`]) expect(() => validateDatabasePath(path, runtime, repo)).toThrow("inside the disposable E2E runtime root");
  expect(() => validateDatabasePath(join(repo, "backend/attendance.db"), root, repo)).toThrow("protected operational database");
  expect(validateDatabasePath(`${runtime}/run/./state/../state/operatoros.sqlite`, runtime, repo)).toBe(join(runtime, "run/state/operatoros.sqlite"));
  expect(existsSync(root)).toBe(false);
});
test("CLI preserves the selected path, validation diagnostic, and failure status", () => {
  const helper = join(repository, "e2e/helpers/create-test-workspace.ts"), runtime = "/tmp/operatoros-e2e-path-only-fixture/runtime";
  const run = (database: string) => Bun.spawnSync([process.execPath, helper, "--database", database, "--runtime-root", runtime], { stdout: "pipe", stderr: "pipe" });
  const accepted = run(`${runtime}/run/state/operatoros.sqlite`); expect(accepted.exitCode).toBe(0); expect(accepted.stderr.toString()).toBe(""); expect(accepted.stdout.toString()).toBe(`${runtime}/run/state/operatoros.sqlite\n`);
  const rejected = run(`${runtime}-sibling/operatoros.sqlite`); expect(rejected.exitCode).toBe(2); expect(rejected.stdout.toString()).toBe(""); expect(rejected.stderr.toString()).toContain("E2E database must be inside the disposable E2E runtime root");
});

// Retained static isolation coverage scans frozen source without opening any DB.
test("historical backend protected-path references remain restricted to safety evidence", () => {
  const allowed = new Set(["test_dev_launcher.py", "test_fresh_database_parity.py", "test_operational_migration_access_context.py", "test_protected_database_isolation.py", "test_s310d_schema_safety.py", "test_s39_import_provenance_migration.py", "test_s43_startup_smoke.py"]);
  const offenders = readdirSync(join(repository, "backend/tests")).filter(name => /^test_.*\.py$/.test(name) && !allowed.has(name) && /backend\/attendance\.db|PROTECTED_DB_PATH/.test(readFileSync(join(repository, "backend/tests", name), "utf8")));
  expect(offenders).toEqual([]);
});
test("test tiers clear guard-only metadata before starting suites", () => {
  const source = readFileSync(join(repository, "scripts/test-tier.sh"), "utf8");
  expect(source).toContain("unset PROTECTED_DB_PATH"); expect(source.indexOf("unset PROTECTED_DB_PATH")).toBeLessThan(source.indexOf("backend_full()"));
});
test("E2E executable fixture sources reserve protected-path literals for the pre-open guard", () => {
  const offenders: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(py|sh|ts)$/.test(entry.name) && path !== join(repository, "e2e/helpers/create-test-workspace.ts") && readFileSync(path, "utf8").includes("backend/attendance.db")) offenders.push(path.slice(repository.length + 1));
    }
  };
  walk(join(repository, "e2e")); expect(offenders).toEqual([]);
});
