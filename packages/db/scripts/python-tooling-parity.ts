#!/usr/bin/env bun
/** Temporary cutover gate. Python is deliberately retained as the behavior oracle. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Database } from "bun:sqlite";
import { CURRENT_SCHEMA_VERSION, createFreshDatabase, openDatabase } from "@operatoros/db";

const repository = resolve(import.meta.dir, "../../..");
type Implementation = "python" | "typescript";
type Result = { exitCode: number; stdout: unknown; stderr: string; effects: unknown };
export type Comparison = { name: string; matched: boolean; intentionalDifference?: string; differences: string[]; python: Result; typescript: Result };

// Only wall-clock fields are nondeterministic. Keep all decisions, identities, and CLI fields.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["created_at", "recorded_at", "startedAt"].includes(key) && !key.endsWith("_at"))
    .map(([key, item]) => [key, stable(item)]));
  return value;
}
function output(text: string): unknown {
  try { return JSON.parse(text); } catch { return text.trim(); }
}
export function compare(name: string, python: Result, typescript: Result): Comparison {
  const differences = (Object.keys(python) as (keyof Result)[]).filter((key) => !isDeepStrictEqual(python[key], typescript[key]));
  const expected = structuredClone(python);
  let reason: string | undefined;
  if (["db:status-current", "db:canonical-schema-validity"].includes(name)) {
    const state = expected.stdout as Record<string, unknown>;
    if (state.schema_checksum_valid === false) {
      state.schema_checksum_valid = true;
      if (name === "db:status-current" && state.compatibility === "INVALID_SCHEMA_STATE") state.compatibility = "COMPATIBLE";
      reason = "The canonical TS validator replaces the Python repr-based schema checksum inspector.";
    }
  }
  if (name === "db:adopt-current") {
    const tighten = (before: any, after: any): void => {
      if (!before || !after || typeof before !== "object" || typeof after !== "object") return;
      for (const key of Object.keys(before)) {
        if (key === "mode" && typeof before[key] === "number" && typeof after[key] === "number" &&
          (after[key] & before[key]) === after[key] && (after[key] & 0o700) === (before[key] & 0o700)) before[key] = after[key];
        else tighten(before[key], after[key]);
      }
    };
    tighten(expected.effects, typescript.effects);
    reason = "Retain TS owner-only permissions on the adopted database.";
  }
  const intentionalDifference = differences.length && reason && isDeepStrictEqual(expected, typescript) ? reason : undefined;
  return { name, matched: !differences.length, ...(intentionalDifference ? { intentionalDifference } : {}), differences, python, typescript };
}
function snapshot(root: string): unknown {
  if (!existsSync(root)) return null;
  return Object.fromEntries(readdirSync(root).sort().map((name) => {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("PARITY_FIXTURE_SYMLINK_UNEXPECTED");
    const content = stat.isDirectory() ? snapshot(path) : name.endsWith(".sqlite") ? databaseContents(path) : name.endsWith(".json") || name.endsWith(".pid")
      ? stable(output(readFileSync(path, "utf8"))) : createHash("sha256").update(readFileSync(path)).digest("hex");
    return [name, { mode: stat.mode & 0o777, content }];
  }));
}
function databaseContents(path: string): unknown {
  let client: Database | undefined;
  try {
    client = new Database(path, { readonly: true });
    const schema = client.query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const tables = client.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    return { schema, rows: Object.fromEntries(tables.map(({ name }) => {
      const rows = client!.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map((row) => {
        const value = { ...row as Record<string, unknown> };
        if (name === "operatoros_schema_migrations") delete value.applied_at;
        return JSON.stringify(value);
      }).sort();
      return [name, rows];
    })) };
  } catch {
    return { unreadable: createHash("sha256").update(readFileSync(path)).digest("hex") };
  } finally { client?.close(); }
}

export async function runParity(): Promise<Comparison[]> {
  const resolver = Bun.spawnSync([process.execPath, join(repository, "scripts/python-tooling-env.ts"), "--repo", repository, "print-executable"], { stdout: "pipe", stderr: "pipe" });
  if (resolver.exitCode !== 0) throw new Error(`Python parity oracle unavailable: ${resolver.stderr.toString().trim()}`);
  const python = resolver.stdout.toString().trim();
  const root = mkdtempSync(join(tmpdir(), "operatoros-python-parity-"));
  const repo = join(root, "repository"), runtime = join(root, "runtime"), data = join(root, "data");
  mkdirSync(repo);
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", XDG_DATA_HOME: join(root, "xdg"), OPERATOROS_DATA_DIR: data, OPERATOROS_PRIMARY_CHECKOUT_PATH: repo };
  for (const key of ["DATABASE_URL", "PROTECTED_DB_PATH", "OPERATOROS_DEV_DATA_DIR"]) delete env[key as keyof typeof env];
  const local = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
  if (local.exitCode !== 0) throw new Error("PARITY_GIT_ENVIRONMENT_UNAVAILABLE");
  for (const key of local.stdout.toString().trim().split("\n")) delete env[key as keyof typeof env];
  const results: Comparison[] = [];
  const git = Bun.spawnSync(["git", "init", "-q", repo], { env, stdout: "pipe", stderr: "pipe" });
  if (git.exitCode !== 0) throw new Error(git.stderr.toString());
  const registry = join(repo, ".git/operatoros-dev-sessions");
  const run = (implementation: Implementation, tool: "db" | "scope", args: string[], effects: () => unknown = () => null): Result => {
    const paths = {
      db: ["scripts/development_database.py", "packages/db/src/dev-db-cli.ts"],
      scope: ["scripts/test_scope.py", "scripts/test-scope.ts"],
    };
    const path = join(repository, paths[tool][implementation === "python" ? 0 : 1]!);
    const result = Bun.spawnSync([implementation === "python" ? python : process.execPath, path, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    return { exitCode: result.exitCode, stdout: output(result.stdout.toString()), stderr: result.stderr.toString().trim(), effects: effects() };
  };
  const reset = () => { for (const path of [runtime, data, registry]) rmSync(path, { recursive: true, force: true }); };
  const dbEffects = () => ({ data: snapshot(data), runtime: snapshot(runtime) });
  const dbArgs = ["--repo", repo, "--data-dir", data, "--expected-schema", CURRENT_SCHEMA_VERSION];
  const caseFor = (name: string, tool: "db", args: string[], setup: () => void = () => {}, effects = dbEffects) => {
    const values = (["python", "typescript"] as const).map((implementation) => { reset(); setup(); return run(implementation, tool, args, effects); });
    const expectedExits: Record<string, number> = {
      "db:adopt-missing-source": 2, "db:adopt-existing-destination": 2,
      "db:reset-no-confirmation": 2, "db:ensure-invalid": 2, "db:ensure-schema-expectation": 2,
    };
    if (values[0]!.exitCode !== (expectedExits[name] ?? 0)) throw new Error(`Python baseline failed for ${name}: ${JSON.stringify(values[0])}`);
    const expectedOutputs: Record<string, unknown> = {
      "db:candidates-empty": [],
    };
    if (name in expectedOutputs && !isDeepStrictEqual(values[0]!.stdout, expectedOutputs[name])) throw new Error(`Python baseline output changed for ${name}`);
    results.push(compare(name, values[0]!, values[1]!));
  };
  const stoppedSession = () => {
    const session = { session_id: "fixture", worktreePath: repo, database_path: join(data, "operatoros.sqlite"), status: "stopped", pids: {} };
    for (const directory of [join(runtime, "sessions/fixture"), join(registry, "fixture")]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, "ownership.json"), JSON.stringify({ application: "OperatorOS", session_id: "fixture", format_version: 1 }), { mode: 0o600 });
      writeFileSync(join(directory, "session.json"), JSON.stringify(session), { mode: 0o600 });
      writeFileSync(join(directory, "ports.json"), JSON.stringify(session), { mode: 0o600 });
    }
    writeFileSync(join(runtime, "active-session"), "fixture\n", { mode: 0o600 });
    writeFileSync(join(runtime, "ports.json"), JSON.stringify(session), { mode: 0o600 });
  };
  const candidateSession = () => {
    stoppedSession();
    const directory = join(runtime, "sessions/fixture/state"); mkdirSync(directory);
    createFreshDatabase(join(directory, "operatoros.sqlite"));
  };
  try {
    const paths = [
      "apps/api/src/core/health.ts", "apps/api/src/auth/session.ts", "apps/api/src/attendance-import.ts", "apps/api/src/attendance.ts", "apps/api/src/openapi-contract.ts", "apps/api/tests/core.test.ts",
      "apps/web/src/components/Card.tsx", "apps/web/src/features/readiness/index.ts", "apps/web/src/routes/index.tsx", "apps/web/src/lib/api/client.ts", "apps/web/src/generated/openapi/schema.ts", "apps/web/vite.config.ts", "apps/web/playwright.config.ts",
      "packages/db/src/schema.ts", "packages/contracts/src/index.ts", "packages/ui/src/button.tsx", "docs/guide.md", "README.md", "e2e/run-smoke.sh", "e2e/fixtures/example.xlsx", "scripts/test-tier.sh", "scripts/new-tool.ts", "Makefile", "unknown/source.xyz",
      "backend/src/main.py", "backend/src/models/student.py", "backend/migrations/new.sql", "backend/src/security/dependencies.py", "backend/src/services/upload.py", "backend/src/services/attendance.py", "backend/tests/fixtures/seed.py", "PROJECT_CONTEXT.md", "f22", "docs/student-data/dapodik-roster-import-design.md", ".\\apps\\web\\src\\routes\\x.tsx",
    ];
    for (const changed of [...paths.map((path) => [path]), paths, ["docs/a.md", "apps/api/src/auth/session.ts", "packages/db/src/schema.ts"]]) {
      const args = changed.flatMap((path) => ["--changed-file", path]);
      const reference = run("python", "scope", args);
      if (reference.exitCode !== 0) throw new Error(`Python scope baseline failed: ${JSON.stringify(reference)}`);
      results.push(compare(`scope:${changed.length === 1 ? changed[0] : `mixed-${changed.length}`}`, reference, run("typescript", "scope", args)));
    }
    caseFor("db:path", "db", ["path", "--repo", repo, "--data-dir", data]);
    caseFor("db:status-missing", "db", ["status", ...dbArgs]);
    caseFor("db:status-invalid", "db", ["status", ...dbArgs], () => { mkdirSync(data); writeFileSync(join(data, "operatoros.sqlite"), "synthetic invalid sqlite"); });
    caseFor("db:status-current", "db", ["status", ...dbArgs], () => { mkdirSync(data); createFreshDatabase(join(data, "operatoros.sqlite")); });
    caseFor("db:candidates-empty", "db", ["candidates", ...dbArgs, "--runtime", runtime]);
    caseFor("db:candidates-current", "db", ["candidates", ...dbArgs, "--runtime", runtime], candidateSession);
    caseFor("db:adopt-current", "db", ["adopt", ...dbArgs, "--runtime", runtime, "--session", "fixture"], candidateSession);
    caseFor("db:adopt-missing-source", "db", ["adopt", ...dbArgs, "--runtime", runtime, "--session", "absent"]);
    caseFor("db:adopt-existing-destination", "db", ["adopt", ...dbArgs, "--runtime", runtime, "--session", "fixture"], () => { mkdirSync(data); writeFileSync(join(data, "operatoros.sqlite"), "synthetic existing destination"); });
    caseFor("db:reset-no-confirmation", "db", ["reset", ...dbArgs], () => { mkdirSync(data); writeFileSync(join(data, "operatoros.sqlite"), "synthetic preserved database"); });
    caseFor("db:ensure-invalid", "db", ["ensure", ...dbArgs], () => { mkdirSync(data); writeFileSync(join(data, "operatoros.sqlite"), "synthetic invalid sqlite"); });
    caseFor("db:ensure-schema-expectation", "db", ["ensure", "--repo", repo, "--data-dir", data, "--expected-schema", "unknown"]);
    // Pin the known Python repr-vs-JSON fingerprint discrepancy against the canonical validator.
    reset(); mkdirSync(data); const database = join(data, "operatoros.sqlite"); createFreshDatabase(database);
    const inspected = Bun.spawnSync([python, "-c", "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); import development_database as d; import json; print(json.dumps(d.inspect(Path(sys.argv[2]), expected_schema=sys.argv[3])))", join(repository, "scripts"), database, CURRENT_SCHEMA_VERSION], { env, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    if (inspected.exitCode !== 0) throw new Error(inspected.stderr.toString());
    const state = JSON.parse(inspected.stdout.toString());
    const handle = openDatabase(database, { readonly: true }); handle.close();
    results.push(compare("db:canonical-schema-validity", { exitCode: 0, stdout: { schema_checksum_valid: state.schema_checksum_valid }, stderr: "", effects: null }, { exitCode: 0, stdout: { schema_checksum_valid: true }, stderr: "", effects: null }));
    return results;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const cases = await runParity();
    console.log(JSON.stringify({ cases: cases.length, matched: cases.filter((item) => item.matched).length,
      intentionalDifferences: cases.filter((item) => item.intentionalDifference), mismatches: cases.filter((item) => !item.matched && !item.intentionalDifference) }, null, 2));
    process.exitCode = cases.every((item) => item.matched || item.intentionalDifference) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
