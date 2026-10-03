#!/usr/bin/env bun
/** Temporary cutover gate. Python is deliberately retained as the behavior oracle. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
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
  if (["runtime:init-session", "db:adopt-current"].includes(name)) {
    const tighten = (before: any, after: any): void => {
      if (!before || !after || typeof before !== "object" || typeof after !== "object") return;
      for (const key of Object.keys(before)) {
        if (key === "mode" && typeof before[key] === "number" && typeof after[key] === "number" &&
          (after[key] & before[key]) === after[key] && (after[key] & 0o700) === (before[key] & 0o700)) before[key] = after[key];
        else if (name === "runtime:init-session" && key === "launcher" && before[key] === "wsl" && after[key] === "linux") before[key] = "linux";
        else tighten(before[key], after[key]);
      }
    };
    tighten(expected.effects, typescript.effects);
    reason = name === "runtime:init-session" ? "Retain TS owner-only permissions and native Linux launcher metadata." : "Retain TS owner-only permissions on the adopted database.";
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
  const launcher = Bun.spawn(["sleep", "120"], { cwd: repo, env, stdout: "ignore", stderr: "ignore" });
  const server = createServer();
  const livePort = await new Promise<number>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address && typeof address !== "string") done(address.port); });
  });
  const freeServer = createServer();
  const freePort = await new Promise<number>((done, reject) => {
    freeServer.once("error", reject);
    freeServer.listen(0, "127.0.0.1", () => { const address = freeServer.address(); if (address && typeof address !== "string") freeServer.close(() => done(address.port)); });
  });
  const run = (implementation: Implementation, tool: "runtime" | "db" | "scope", args: string[], effects: () => unknown = () => null): Result => {
    const paths = {
      runtime: ["scripts/operatoros-dev-runtime.py", "scripts/operatoros-dev-runtime.ts"],
      db: ["scripts/development_database.py", "packages/db/src/dev-db-cli.ts"],
      scope: ["scripts/test_scope.py", "scripts/test-scope.ts"],
    };
    const path = join(repository, paths[tool][implementation === "python" ? 0 : 1]!);
    const result = Bun.spawnSync([implementation === "python" ? python : process.execPath, path, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
    return { exitCode: result.exitCode, stdout: output(result.stdout.toString()), stderr: result.stderr.toString().trim(), effects: effects() };
  };
  const reset = () => { for (const path of [runtime, data, registry]) rmSync(path, { recursive: true, force: true }); };
  const runtimeEffects = () => ({ runtime: snapshot(runtime), registry: snapshot(registry) });
  const dbEffects = () => ({ data: snapshot(data), runtime: snapshot(runtime) });
  const runtimeArgs = ["--repo", repo, "--runtime", runtime];
  const dbArgs = ["--repo", repo, "--data-dir", data, "--expected-schema", CURRENT_SCHEMA_VERSION];
  const caseFor = (name: string, tool: "runtime" | "db", args: string[], setup: () => void = () => {}, effects = tool === "runtime" ? runtimeEffects : dbEffects) => {
    const values = (["python", "typescript"] as const).map((implementation) => { reset(); setup(); return run(implementation, tool, args, effects); });
    const expectedExits: Record<string, number> = {
      "runtime:cleanup-foreign": 3, "runtime:allocate-occupied": 4,
      "runtime:finalize-bad-owner": 2, "runtime:finalize-session-database": 2,
      "db:adopt-missing-source": 2, "db:adopt-existing-destination": 2,
      "db:reset-no-confirmation": 2, "db:ensure-invalid": 2, "db:ensure-schema-expectation": 2,
    };
    if (values[0]!.exitCode !== (expectedExits[name] ?? 0)) throw new Error(`Python baseline failed for ${name}: ${JSON.stringify(values[0])}`);
    const expectedOutputs: Record<string, unknown> = {
      "runtime:status-empty": { state: "NO_ACTIVE_SESSION" },
      "runtime:status-stale-pointer": { state: "STALE_SESSION_UNVERIFIED" },
      "runtime:status-stopped": { state: "STALE_VERIFIED" },
      "runtime:classify-free": [], "runtime:classify-foreign-decision": "FOREIGN_PROCESS",
      "runtime:allocate-free": freePort, "db:candidates-empty": [],
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
    caseFor("runtime:status-empty", "runtime", ["status", ...runtimeArgs]);
    caseFor("runtime:status-stale-pointer", "runtime", ["status", ...runtimeArgs], () => { mkdirSync(runtime); writeFileSync(join(runtime, "active-session"), "absent\n"); });
    caseFor("runtime:status-stopped", "runtime", ["status", ...runtimeArgs], stoppedSession);
    caseFor("runtime:classify-free", "runtime", ["classify-port", ...runtimeArgs, "--port", String(freePort)]);
    caseFor("runtime:classify-foreign-decision", "runtime", ["classify-port", ...runtimeArgs, "--port", String(livePort), "--decision"]);
    caseFor("runtime:cleanup-foreign", "runtime", ["cleanup-port", ...runtimeArgs, "--host", "127.0.0.1", "--port", String(livePort), "--no-clean"]);
    caseFor("runtime:cleanup-free", "runtime", ["cleanup-port", ...runtimeArgs, "--host", "127.0.0.1", "--port", String(freePort)]);
    caseFor("runtime:allocate-free", "runtime", ["allocate", "--host", "127.0.0.1", "--preferred", String(freePort), "--maximum", String(freePort)]);
    caseFor("runtime:allocate-occupied", "runtime", ["allocate", "--host", "127.0.0.1", "--preferred", String(livePort), "--maximum", String(livePort)]);
    caseFor("runtime:init-session", "runtime", ["init-session", ...runtimeArgs, "--session", "fixture", "--mode", "dev", "--token", "synthetic-token", "--javascript-runtime", "bun", "--javascript-runtime-version", Bun.version, "--launcher-pid", String(launcher.pid), "--frontend-host", "127.0.0.1", "--backend-host", "127.0.0.1", "--frontend-port", "45123", "--backend-port", "45124", "--backend-runtime", "elysia", "--database-path", join(data, "operatoros.sqlite")]);
    caseFor("runtime:register-dead-process", "runtime", ["register", ...runtimeArgs, "--session", "fixture", "--role", "backend", "--token", "synthetic-token", "--pid", "2147483647", "--port", "45124"], stoppedSession);
    caseFor("runtime:mark", "runtime", ["mark", ...runtimeArgs, "--session", "fixture", "--status", "ready"], stoppedSession);
    caseFor("runtime:finalize", "runtime", ["finalize-session", ...runtimeArgs, "--session", "fixture"], stoppedSession);
    caseFor("runtime:finalize-bad-owner", "runtime", ["finalize-session", ...runtimeArgs, "--session", "fixture"], () => { stoppedSession(); writeFileSync(join(runtime, "sessions/fixture/ownership.json"), "{}"); });
    caseFor("runtime:finalize-session-database", "runtime", ["finalize-session", ...runtimeArgs, "--session", "fixture"], () => { stoppedSession(); writeFileSync(join(runtime, "sessions/fixture/session.json"), JSON.stringify({ session_id: "fixture", database_path: join(runtime, "sessions/fixture/state/operatoros.sqlite") })); });
    caseFor("runtime:require-no-active-session", "runtime", ["require-no-active-session", ...runtimeArgs], stoppedSession);
    caseFor("runtime:stop-empty", "runtime", ["stop", ...runtimeArgs]);
    caseFor("runtime:stop-stopped-session", "runtime", ["stop", ...runtimeArgs], stoppedSession);
    caseFor("runtime:stop-owned-empty", "runtime", ["stop-owned-session", ...runtimeArgs, "--session", "fixture", "--timeout", "1"], stoppedSession);
    caseFor("runtime:checkout-identity", "runtime", ["checkout-identity", "--repo", repo]);
    caseFor("runtime:registry-path", "runtime", ["registry-path", "--repo", repo]);
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
    server.close(); freeServer.close();
    launcher.kill(); await launcher.exited;
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
