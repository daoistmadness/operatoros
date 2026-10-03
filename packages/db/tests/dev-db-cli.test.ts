import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase } from "../src/bootstrap";
import { devDatabaseCommand, inspectDevelopmentDatabase } from "../src/dev-db-cli";
import { CURRENT_SCHEMA_VERSION } from "../src/manifest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-dev-db-cli-")); roots.push(root);
  const repo = join(root, "repository"), data = join(root, "data"), runtime = join(root, "runtime"); mkdirSync(repo);
  const env = { ...process.env };
  const local = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" });
  expect(local.exitCode).toBe(0);
  for (const name of local.stdout.toString().trim().split("\n")) delete env[name];
  for (const name of ["DATABASE_URL", "OPERATOROS_DATA_DIR", "OPERATOROS_DEV_DATA_DIR", "PROTECTED_DB_PATH"]) delete env[name];
  const initialized = Bun.spawnSync(["git", "init", "-q", repo], { env, stdout: "pipe", stderr: "pipe" }); expect(initialized.exitCode).toBe(0);
  const database = join(data, "operatoros.sqlite");
  const run = (command: string, ...options: string[]) => devDatabaseCommand([command, "--repo", repo, "--data-dir", data, ...(command === "path" ? [] : ["--expected-schema", CURRENT_SCHEMA_VERSION]), ...options], env);
  const seed = (path = database, version = CURRENT_SCHEMA_VERSION) => {
    createFreshDatabase(path);
    if (version !== CURRENT_SCHEMA_VERSION) {
      const client = new Database(path);
      try { client.run("UPDATE operatoros_schema_migrations SET version=?, schema_fingerprint='synthetic-older-schema'", [version]); }
      finally { client.close(); }
    }
  };
  const session = (version = CURRENT_SCHEMA_VERSION) => {
    const directory = join(runtime, "sessions/fixture"), path = join(directory, "state/operatoros.sqlite");
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "ownership.json"), JSON.stringify({ application: "OperatorOS", session_id: "fixture" }));
    seed(path, version); return path;
  };
  return { root, repo, data, runtime, database, env, run, seed, session };
}

describe("development DB CLI canonical authority", () => {
  test("path/status do not create missing data and ignore ambient DATABASE_URL", () => {
    const f = fixture(); f.env.DATABASE_URL = "sqlite:///never-open-this-path";
    expect(f.run("path")).toBe(f.database);
    const status = JSON.parse(f.run("status"));
    expect(status.compatibility).toBe("MISSING"); expect(status.path).toBe(f.database);
    expect(existsSync(f.data)).toBe(false);
  });
  test("ensure creates current schema and status accepts its canonical checksum", () => {
    const f = fixture(); expect(f.run("ensure")).toBe(f.database);
    const status = JSON.parse(f.run("status"));
    expect(status.schema_head).toBe(CURRENT_SCHEMA_VERSION); expect(status.compatibility).toBe("COMPATIBLE");
    expect(status.schema_checksum_valid).toBe(true); expect(status.administrator_configured).toBe(false);
    expect(status.manifest_consistency).toBe("CURRENT");
    const before = hash(f.database); f.run("ensure"); expect(hash(f.database)).toBe(before);
  });
  test.each(["20260724_s42", "20260725_s43"])("ensure/reset preserve and refuse %s", (version) => {
    const f = fixture(); f.seed(f.database, version); const before = hash(f.database);
    for (const command of ["ensure", "reset"]) expect(() => f.run(command, ...(command === "reset" ? ["--confirm", "RESET"] : []))).toThrow("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
    expect(hash(f.database)).toBe(before); expect(readdirSync(f.data)).toEqual(["operatoros.sqlite"]);
    expect(JSON.parse(f.run("status")).compatibility).toBe("NEEDS_FORWARD_MIGRATION");
  });
  test("legacy filename is preserved without automatic migration", () => {
    const f = fixture(), path = join(f.data, "operatoros-development.db"); f.seed(path, "20260724_s42"); const before = hash(path);
    for (const command of ["ensure", "reset", "adopt", "candidates"]) expect(() => f.run(command, "--runtime", f.runtime, "--session", "fixture", "--confirm", "RESET")).toThrow("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
    expect(hash(path)).toBe(before); expect(existsSync(f.database)).toBe(false); expect(readdirSync(f.data)).toEqual(["operatoros-development.db"]);
  });
  test.each(["20260724_s42", "20260725_s43"])("adopt refuses a %s source and candidates classify it incompatible", (version) => {
    const f = fixture(), source = f.session(version), before = hash(source);
    const candidates = JSON.parse(f.run("candidates", "--runtime", f.runtime)); expect(candidates[0].compatibility).toBe("incompatible");
    expect(() => f.run("adopt", "--runtime", f.runtime, "--session", "fixture")).toThrow("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
    expect(hash(source)).toBe(before); expect(existsSync(f.database)).toBe(false);
  });
  test("adopt validates a current source and never overwrites a destination", () => {
    const f = fixture(), source = f.session(), before = hash(source);
    expect(JSON.parse(f.run("candidates", "--runtime", f.runtime))[0].compatibility).toBe("compatible");
    expect(f.run("adopt", "--runtime", f.runtime, "--session", "fixture")).toBe(f.database);
    expect(inspectDevelopmentDatabase(f.database).schema_checksum_valid).toBe(true); expect(hash(source)).toBe(before);
    const adopted = hash(f.database);
    expect(() => f.run("adopt", "--runtime", f.runtime, "--session", "fixture")).toThrow("PERSISTENT_DESTINATION_ALREADY_EXISTS");
    expect(hash(f.database)).toBe(adopted);
  });
  test("reset needs confirmation and refuses open handles", () => {
    const f = fixture(); f.run("ensure"); const before = hash(f.database);
    expect(() => f.run("reset")).toThrow("DEVELOPMENT_DATABASE_RESET_CONFIRMATION_REQUIRED");
    expect(hash(f.database)).toBe(before);
    const handle = new Database(f.database, { readonly: true });
    try { expect(() => f.run("reset", "--confirm", "RESET")).toThrow("DEVELOPMENT_DATABASE_BUSY"); }
    finally { handle.close(); }
    expect(hash(f.database)).toBe(before);
    expect(f.run("reset", "--confirm", "RESET")).toBe(f.database);
    expect(inspectDevelopmentDatabase(f.database).schema_checksum_valid).toBe(true);
  });
  test("corrupt schema is invalid and ensure preserves its bytes", () => {
    const f = fixture(); mkdirSync(f.data); writeFileSync(f.database, "synthetic invalid sqlite"); const before = hash(f.database);
    expect(JSON.parse(f.run("status")).compatibility).toBe("INVALID_SCHEMA_STATE");
    expect(() => f.run("ensure")).toThrow("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE"); expect(hash(f.database)).toBe(before);
  });
  test("symlinked data, files, metadata, and candidate roots fail closed", () => {
    const f = fixture(); mkdirSync(f.data); const other = join(f.root, "other"); mkdirSync(other);
    symlinkSync(other, f.database);
    expect(() => f.run("ensure")).toThrow("PERSISTENT_DEVELOPMENT_DATABASE_INCOMPATIBLE"); expect(readdirSync(other)).toEqual([]);
    rmSync(f.database); symlinkSync(other, join(f.data, "database.json"));
    expect(() => f.run("ensure")).toThrow("DEVELOPMENT_DATABASE_METADATA_INVALID");
    rmSync(f.data, { recursive: true }); symlinkSync(other, f.data);
    expect(() => f.run("path")).toThrow("DEVELOPMENT_DATA_SYMLINK_REJECTED");
  });
  test("protected-looking data path is rejected before database access", () => {
    const f = fixture();
    expect(() => devDatabaseCommand(["ensure", "--repo", f.repo, "--data-dir", join(f.repo, "backend/attendance.db"), "--expected-schema", CURRENT_SCHEMA_VERSION], f.env)).toThrow("DATA_DIR_PATH_REJECTED");
    expect(readdirSync(f.repo)).toEqual([".git"]);
  });
});
