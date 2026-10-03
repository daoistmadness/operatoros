import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFreshDatabase } from "../src/bootstrap";
import { assertProtectedAbsent, canonicalSnapshotPath, protectedSnapshot, selectProtectedDatabase, sidecarsFor, snapshotJson } from "../src/protected-snapshot-cli";

const roots: string[] = [], children: Bun.Subprocess[] = [], env = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete env[key];
delete env.PROTECTED_DB_PATH; delete env.DATABASE_URL;
afterEach(async () => { for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(); await child.exited; } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(repo: string, ...args: string[]) {
  const value = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (value.exitCode) throw new Error(value.stderr.toString());
}
function fixture(seed = true) {
  const root = mkdtempSync(join(tmpdir(), "operatoros-snapshot-fixture-")); roots.push(root);
  const repo = join(root, "primary"), secondary = join(root, "secondary"); mkdirSync(repo); git(repo, "init", "-qb", "main");
  git(repo, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
  git(repo, "worktree", "add", "-b", "secondary", secondary);
  const path = join(repo, "backend/attendance.db"), lock = join(root, "migration.lock");
  if (seed) {
    const source = join(root, "canonical.sqlite"); createFreshDatabase(source);
    const client = new Database(source); try { client.run("UPDATE operatoros_schema_migrations SET version='20260725_s43'"); } finally { client.close(); }
    mkdirSync(join(repo, "backend")); copyFileSync(source, path);
  }
  return { root, repo, secondary, path, lock };
}
test("absent selection and CLI never create a database or sidecars", () => {
  const f = fixture(false), path = join(f.secondary, "backend/attendance.db");
  expect(selectProtectedDatabase(f.secondary, "")).toEqual({ mode: "absent", path }); assertProtectedAbsent(path);
  const helper = resolve(import.meta.dir, "../src/protected-snapshot-cli.ts");
  const result = Bun.spawnSync([process.execPath, helper, "select", f.secondary], { env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0); expect(result.stdout.toString()).toBe(`absent\t${path}\n`);
  expect([path, ...sidecarsFor(path)].some(existsSync)).toBe(false);
});
test("approved separate-worktree inspection is immutable and retains exact fingerprint fields", () => {
  const f = fixture(), selected = selectProtectedDatabase(f.secondary, f.path); expect(selected).toEqual({ mode: "snapshot", path: f.path });
  const bytes = readFileSync(f.path), before = protectedSnapshot(f.path, f.lock), after = protectedSnapshot(f.path, f.lock);
  expect(after).toEqual(before); expect(readFileSync(f.path)).toEqual(bytes); expect(before.head).toBe("20260725_s43"); expect(before.ledger).toBe(1);
  expect(before.sidecars).toEqual([]); expect(before.integrity).toBe("ok"); expect(before.foreign_key_violations).toBe(0);
  const stat = statSync(f.path, { bigint: true }), serialized = snapshotJson(before);
  expect(serialized).toContain(`"mtime_ns":${stat.mtimeNs}`); expect(serialized).toContain(`"ctime_ns":${stat.ctimeNs}`);
  expect(before.mode).toBe(stat.mode & 0o7777n); expect(sidecarsFor(f.path).some(existsSync)).toBe(false); expect(existsSync(f.lock)).toBe(false);
});
test("relative, symlinked, missing, wrong-name and unapproved paths fail closed", () => {
  const f = fixture();
  for (const path of ["backend/attendance.db", "../attendance.db"]) expect(() => selectProtectedDatabase(f.secondary, path)).toThrow("PROTECTED_DATABASE_PATH_NOT_ABSOLUTE");
  expect(() => canonicalSnapshotPath(join(f.root, "missing"))).toThrow("PROTECTED_DATABASE_PATH_MISSING");
  const alias = join(f.root, "alias.db"); symlinkSync(f.path, alias);
  expect(() => selectProtectedDatabase(f.secondary, alias)).toThrow("PROTECTED_DATABASE_SYMLINK_REJECTED");
  const wrong = join(f.root, "wrong.db"); copyFileSync(f.path, wrong);
  expect(() => selectProtectedDatabase(f.secondary, wrong)).toThrow("PROTECTED_DATABASE_PATH_MISMATCH");
  const unapproved = join(f.root, "unapproved/backend"); mkdirSync(unapproved, { recursive: true }); copyFileSync(f.path, join(unapproved, "attendance.db"));
  expect(() => selectProtectedDatabase(f.secondary, join(unapproved, "attendance.db"))).toThrow("PROTECTED_DATABASE_UNAPPROVED_WORKTREE");
  expect(() => selectProtectedDatabase(f.repo, f.path)).toThrow("PROTECTED_DATABASE_PATH_INSIDE_WORKTREE");
});
test("sidecars and unexpected presence are rejected without touching database bytes", () => {
  const f = fixture(), bytes = readFileSync(f.path);
  for (const path of sidecarsFor(f.path)) {
    writeFileSync(path, "synthetic"); expect(() => protectedSnapshot(f.path, f.lock)).toThrow(`PROTECTED_DATABASE_SIDECAR_PRESENT: ${path}`);
    expect(() => assertProtectedAbsent(f.path)).toThrow("PROTECTED_DATABASE_UNEXPECTEDLY_PRESENT"); rmSync(path);
  }
  expect(readFileSync(f.path)).toEqual(bytes);
});
test("open handles are detected through lsof before SQLite inspection", () => {
  const f = fixture(), descriptor = openSync(f.path, "r");
  try { expect(() => protectedSnapshot(f.path, f.lock)).toThrow("PROTECTED_DATABASE_OPEN_HANDLE:"); }
  finally { closeSync(descriptor); }
});
test("migration lock detection probes only the existing read-only lock file", async () => {
  const f = fixture(); writeFileSync(f.lock, "sentinel");
  const child = Bun.spawn(["flock", "--exclusive", f.lock, "sh", "-c", "echo ready; read line"], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env }); children.push(child);
  const reader = child.stdout.getReader(); await reader.read(); reader.releaseLock();
  expect(() => protectedSnapshot(f.path, f.lock)).toThrow("PROTECTED_DATABASE_MIGRATION_LOCK_PRESENT");
  child.stdin.end(); await child.exited;
  expect(protectedSnapshot(f.path, f.lock).head).toBe("20260725_s43"); expect(readFileSync(f.lock, "utf8")).toBe("sentinel");
});
test("invalid schema state remains unchanged after inspection refusal", () => {
  const f = fixture(), client = new Database(f.path);
  try { client.run("UPDATE operatoros_schema_migrations SET version='unknown'"); } finally { client.close(); }
  const bytes = readFileSync(f.path);
  expect(() => protectedSnapshot(f.path, f.lock)).toThrow("PROTECTED_DATABASE_S43_STATE_INVALID"); expect(readFileSync(f.path)).toEqual(bytes);
});
