import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createFreshDatabase } from "./bootstrap";
import { assertDatabasePath, openDatabase, REQUIRED_TABLES, validateDatabase } from "./connection";
import { assertDatabaseMigrationSafe, resolveOperatorOSPaths, type OperatorOSPaths } from "./data-dir";
import { compareSchemaVersions, CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from "./manifest";

function fail(code: string): never { throw new Error(code); }
function kind(path: string): "missing" | "file" | "invalid" {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() ? "file" : "invalid"; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
function noSymlinks(path: string): void {
  for (let current = path; current !== dirname(current); current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) fail("DEVELOPMENT_DATA_SYMLINK_REJECTED"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
function layout(paths: OperatorOSPaths): string {
  const canonical = kind(paths.databasePath), legacy = kind(paths.legacyDatabasePath);
  if (canonical !== "missing" && legacy !== "missing") return "CONFLICT";
  if (canonical === "invalid" || legacy === "invalid") return "INVALID";
  return legacy === "file" ? "LEGACY" : canonical === "file" ? "CANONICAL" : "MISSING";
}

export function inspectDevelopmentDatabase(path: string) {
  assertDatabasePath(path);
  const entry = kind(path);
  const empty = {
    exists: entry !== "missing", regular_file: entry === "file", schema_head: null as string | null,
    ledger: entry === "missing" ? "absent" : "invalid", integrity: entry === "missing" ? "absent" : "unreadable",
    foreign_key_violations: 0, schema_recognized: false, schema_checksum_valid: false,
    administrator_configured: false, users_count: 0, file_size: entry === "file" ? statSync(path).size : 0,
  };
  if (entry !== "file") return empty;
  let client: Database | undefined;
  try {
    client = new Database(path, { readonly: true });
    const rows = client.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at, version").all() as { version: string }[];
    const known = rows.every(({ version }) => SCHEMA_MIGRATIONS.includes(version as typeof SCHEMA_MIGRATIONS[number]));
    const head = known ? SCHEMA_MIGRATIONS.filter((version) => rows.some((row) => row.version === version)).at(-1) ?? null : rows.at(-1)?.version ?? null;
    const tables = new Set((client.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(({ name }) => name));
    const users = tables.has("users") ? (client.query("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count : 0;
    const admins = tables.has("users") ? (client.query("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND is_active=1").get() as { count: number }).count : 0;
    let valid = false;
    try { validateDatabase(client); valid = true; } catch { /* The canonical validator owns checksum/schema acceptance. */ }
    return {
      ...empty, schema_head: head, ledger: rows.length && known ? "valid" : "invalid",
      integrity: (client.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check,
      quick_check: (client.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check,
      foreign_key_violations: client.query("PRAGMA foreign_key_check").all().length,
      schema_recognized: known && !!head && REQUIRED_TABLES.every((table) => tables.has(table)),
      schema_checksum_valid: valid, administrator_configured: admins > 0, users_count: users,
    };
  } catch { return empty; }
  finally { client?.close(); }
}
function compatibility(value: string, state: Partial<ReturnType<typeof inspectDevelopmentDatabase>>): string {
  if (value === "MISSING") return "MISSING";
  if (!["LEGACY", "CANONICAL"].includes(value) || state.integrity !== "ok" || state.ledger !== "valid") return "INVALID_SCHEMA_STATE";
  const comparison = state.schema_head ? compareSchemaVersions(state.schema_head, CURRENT_SCHEMA_VERSION) : undefined;
  if (comparison === -1) return "NEEDS_FORWARD_MIGRATION";
  if (comparison === 1) return "DATABASE_AHEAD_OF_SOURCE";
  return comparison === 0 && state.schema_checksum_valid ? value === "LEGACY" ? "NEEDS_FORWARD_MIGRATION" : "COMPATIBLE" : "INVALID_SCHEMA_STATE";
}
function json(path: string): Record<string, unknown> | undefined {
  try { const value = JSON.parse(readFileSync(path, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
  catch { return undefined; }
}
function prepare(paths: OperatorOSPaths, repo: string): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 }); chmodSync(paths.dataDir, 0o700);
  const result = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) fail("DEVELOPMENT_DATABASE_REPOSITORY_ID_UNAVAILABLE");
  const hash = createHash("sha256").update(resolve(result.stdout.toString().trim())).digest("hex");
  const path = join(paths.dataDir, "database.json");
  if (kind(path) === "missing") {
    writeFileSync(path, `${JSON.stringify({
      format_version: 1, application: "OperatorOS", repository_instance_id: hash.slice(0, 16),
      git_common_directory_hash: hash, created_at: new Date().toISOString(), database_relative_filename: "operatoros.sqlite",
      schema_expectation: CURRENT_SCHEMA_VERSION, persistence_classification: "PERSISTENT_LOCAL_DEVELOPMENT_DATABASE",
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } else {
    const metadata = kind(path) === "file" ? json(path) : undefined;
    if (metadata?.application !== "OperatorOS" || metadata.database_relative_filename !== "operatoros.sqlite" || metadata.git_common_directory_hash !== hash) fail("DEVELOPMENT_DATABASE_METADATA_INVALID");
  }
}
function refuseLegacy(paths: OperatorOSPaths): void {
  assertDatabaseMigrationSafe(paths);
  if (layout(paths) === "INVALID") fail("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE");
  const head = inspectDevelopmentDatabase(paths.databasePath).schema_head;
  if (head && compareSchemaVersions(head, CURRENT_SCHEMA_VERSION) === -1) fail("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
}
function sessionSource(runtime: string, session: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) fail("SESSION_PATH_ESCAPE_REJECTED");
  const directory = join(runtime, "sessions", session); noSymlinks(directory);
  if (!existsSync(directory)) fail("PERSISTENT_DEVELOPMENT_DATABASE_OPERATION_FAILED");
  const ownershipPath = join(directory, "ownership.json");
  const owner = kind(ownershipPath) === "file" ? json(ownershipPath) : undefined;
  if (owner?.application !== "OperatorOS" || owner.session_id !== session) fail("SESSION_OWNERSHIP_UNVERIFIED");
  const path = join(directory, "state/operatoros.sqlite"); noSymlinks(path);
  if (kind(path) !== "file") fail("SESSION_DATABASE_UNAVAILABLE");
  return path;
}
function requireUnused(path: string): void {
  if (kind(path) === "missing") return;
  for (const suffix of ["-wal", "-shm", "-journal"]) if (kind(`${path}${suffix}`) !== "missing") fail("DEVELOPMENT_DATABASE_BUSY");
  if (!Bun.which("lsof")) fail("DEVELOPMENT_DATABASE_LSOF_REQUIRED");
  const result = Bun.spawnSync(["lsof", "-t", "--", path], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode === 0 && result.stdout.toString().trim()) fail("DEVELOPMENT_DATABASE_BUSY");
  if (result.exitCode !== 0 && result.exitCode !== 1) fail("DEVELOPMENT_DATABASE_OPEN_HANDLE_CHECK_FAILED");
}

export function devDatabaseCommand(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const [command, ...options] = args;
  if (!command || !["ensure", "status", "path", "reset", "candidates", "adopt"].includes(command)) fail("DEVELOPMENT_DATABASE_ARGUMENT_INVALID");
  const { values } = parseArgs({ args: options, options: {
    repo: { type: "string" }, "data-dir": { type: "string" }, "expected-schema": { type: "string" },
    runtime: { type: "string" }, session: { type: "string" }, confirm: { type: "string", default: "" },
  } });
  if (!values.repo) fail("DEVELOPMENT_DATABASE_ARGUMENT_INVALID");
  if (command !== "path" && values["expected-schema"] !== CURRENT_SCHEMA_VERSION) fail("SCHEMA_VERSION_EXPECTATION_MISMATCH");
  const repo = resolve(values.repo);
  const paths = resolveOperatorOSPaths({ repositoryRoot: repo, env: { ...env, ...(values["data-dir"] === undefined ? {} : { OPERATOROS_DATA_DIR: values["data-dir"] }) } });
  noSymlinks(paths.dataDir);
  if (command === "path") return paths.databasePath;
  if (command === "status") {
    const value = layout(paths);
    const state = ["CANONICAL", "LEGACY"].includes(value) ? inspectDevelopmentDatabase(value === "LEGACY" ? paths.legacyDatabasePath : paths.databasePath) : { exists: false, schema_head: null };
    const metadata = kind(join(paths.dataDir, "database.json")) === "file" ? json(join(paths.dataDir, "database.json")) : undefined;
    return JSON.stringify({ ...state, path: paths.databasePath, legacy_path: paths.legacyDatabasePath, layout: value,
      migration_required: value === "LEGACY", expected_schema_head: CURRENT_SCHEMA_VERSION, compatibility: compatibility(value, state),
      manifest_consistency: kind(join(paths.dataDir, "database.json")) === "missing" ? "MISSING" : metadata ? metadata.schema_expectation === CURRENT_SCHEMA_VERSION ? "CURRENT" : "STALE" : "INVALID",
      protected: false, persistence_classification: "PERSISTENT_LOCAL_DEVELOPMENT_DATABASE",
    });
  }
  // All mutating commands refuse legacy layouts and older schema heads. No startup migration.
  refuseLegacy(paths);
  prepare(paths, repo);
  if (command === "candidates") {
    if (!values.runtime) fail("DEVELOPMENT_DATABASE_ARGUMENT_INVALID");
    const runtime = resolve(values.runtime), sessions = join(runtime, "sessions"); noSymlinks(sessions);
    const candidates: Record<string, unknown>[] = [];
    if (existsSync(sessions)) for (const session of readdirSync(sessions).sort()) {
      try {
        const state = inspectDevelopmentDatabase(sessionSource(runtime, session));
        candidates.push({ session_id: session, database_size: state.file_size, schema_head: state.schema_head,
          administrator_present: state.administrator_configured, compatibility: state.schema_checksum_valid ? "compatible" : "incompatible" });
      } catch { /* An unowned/unavailable session is not an adoption candidate. */ }
    }
    return JSON.stringify(candidates);
  }
  if (command === "adopt") {
    if (layout(paths) !== "MISSING") fail("PERSISTENT_DESTINATION_ALREADY_EXISTS");
    if (!values.runtime || !values.session) fail("DEVELOPMENT_DATABASE_ARGUMENT_INVALID");
    const sourcePath = sessionSource(resolve(values.runtime), values.session);
    const state = inspectDevelopmentDatabase(sourcePath);
    if (state.schema_head && compareSchemaVersions(state.schema_head, CURRENT_SCHEMA_VERSION) === -1) fail("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
    if (!state.schema_checksum_valid) fail("SESSION_DATABASE_INCOMPATIBLE");
    requireUnused(sourcePath);
    const source = openDatabase(sourcePath, { readonly: true });
    const temporary = join(paths.dataDir, `.operatoros-${randomBytes(12).toString("hex")}.adopting`);
    try {
      writeFileSync(temporary, source.client.serialize(), { flag: "wx", mode: 0o600 });
      const verified = openDatabase(temporary, { readonly: true }); verified.close();
      // Publish without overwriting a concurrently created destination.
      try { linkSync(temporary, paths.databasePath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("PERSISTENT_DESTINATION_ALREADY_EXISTS"); throw error;
      }
    } finally { source.close(); rmSync(temporary, { force: true }); }
    return paths.databasePath;
  }
  if (command === "reset") {
    if (values.confirm !== "RESET") fail("DEVELOPMENT_DATABASE_RESET_CONFIRMATION_REQUIRED");
    requireUnused(paths.databasePath);
    if (kind(paths.databasePath) === "file") {
      const client = new Database(paths.databasePath, { readwrite: true, create: false });
      try { client.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK"); }
      catch { fail("DEVELOPMENT_DATABASE_BUSY"); }
      finally { client.close(); }
      rmSync(paths.databasePath);
    }
  }
  if (kind(paths.databasePath) === "missing") createFreshDatabase(paths.databasePath);
  else {
    try { const handle = openDatabase(paths.databasePath, { readonly: true }); handle.close(); }
    catch { fail("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE"); }
  }
  return paths.databasePath;
}

if (import.meta.main) {
  try { console.log(devDatabaseCommand(process.argv.slice(2))); }
  catch (error) {
    // Preserve the Python CLI's machine-consumed diagnostic channel and exit status.
    console.log(error instanceof Error ? error.message : "PERSISTENT_DEVELOPMENT_DATABASE_OPERATION_FAILED");
    process.exitCode = 2;
  }
}
