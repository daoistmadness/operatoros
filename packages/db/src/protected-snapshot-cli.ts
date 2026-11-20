import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqliteConnection } from "./sqlite-client";

const S43_HEAD = "20260725_s43";
const EXPECTED_TABLES = ["attendance_follow_ups", "attendance_follow_up_notes", "attendance_follow_up_audit"];
const MIGRATION_LOCK = "/tmp/operatoros-s43-operational-migration.lock";
const fail = (code: string): never => { throw new Error(code); };
export const sidecarsFor = (path: string) => ["-wal", "-shm", "-journal"].map(suffix => `${path}${suffix}`);
const within = (path: string, parent: string) => { const value = relative(parent, path); return !value || (value !== ".." && !value.startsWith("../") && !isAbsolute(value)); };
export function canonicalSnapshotPath(path: string): string {
  if (!isAbsolute(path)) fail("PROTECTED_DATABASE_PATH_NOT_ABSOLUTE");
  for (let current = path; ; current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) fail("PROTECTED_DATABASE_SYMLINK_REJECTED"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current === dirname(current)) break;
  }
  if (!existsSync(path)) fail("PROTECTED_DATABASE_PATH_MISSING");
  const resolved = realpathSync(path);
  if (resolved !== path) fail("PROTECTED_DATABASE_PATH_NOT_CANONICAL");
  return resolved;
}
export function selectProtectedDatabase(repo: string, explicit = process.env.PROTECTED_DB_PATH): { mode: "snapshot" | "absent"; path: string } {
  const root = realpathSync(repo), local = join(root, "backend/attendance.db");
  if (!explicit && !existsSync(local)) return { mode: "absent", path: local };
  const path = canonicalSnapshotPath(explicit || local);
  if (basename(path) !== "attendance.db" || basename(dirname(path)) !== "backend") fail("PROTECTED_DATABASE_PATH_MISMATCH");
  if (within(path, root)) { if (explicit) fail("PROTECTED_DATABASE_PATH_INSIDE_WORKTREE"); }
  else if (explicit) {
    const env = { ...process.env };
    const local = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
    if (local.error || local.status !== 0) fail("PROTECTED_DATABASE_WORKTREE_DISCOVERY_FAILED");
    for (const key of local.stdout.trim().split("\n")) delete env[key];
    const listing = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { env, encoding: "utf8" });
    if (listing.error || listing.status !== 0) fail("PROTECTED_DATABASE_WORKTREE_DISCOVERY_FAILED");
    const worktrees = listing.stdout.split("\n").filter(line => line.startsWith("worktree ")).map(line => realpathSync(line.slice(9)));
    if (!worktrees.includes(dirname(dirname(path)))) fail("PROTECTED_DATABASE_UNAPPROVED_WORKTREE");
  }
  return { mode: "snapshot", path };
}
export function assertProtectedAbsent(path: string): void {
  if ([path, ...sidecarsFor(path)].some(existsSync)) fail("PROTECTED_DATABASE_UNEXPECTEDLY_PRESENT");
}
export function protectedSnapshot(path: string, migrationLock = MIGRATION_LOCK) {
  path = canonicalSnapshotPath(path);
  if (basename(path) !== "attendance.db" || basename(dirname(path)) !== "backend") fail("PROTECTED_DATABASE_PATH_MISMATCH");
  const sidecars = sidecarsFor(path).filter(existsSync);
  if (sidecars.length) fail(`PROTECTED_DATABASE_SIDECAR_PRESENT: ${sidecars.join(",")}`);
  if (existsSync(migrationLock)) {
    // Probe an existing read-only descriptor. flock must never create a lock file.
    const descriptor = openSync(migrationLock, "r");
    try {
      const probe = spawnSync("flock", ["--nonblock", "--exclusive", "0"], { stdio: [descriptor, "pipe", "pipe"] });
      if (probe.status === 1) fail("PROTECTED_DATABASE_MIGRATION_LOCK_PRESENT");
      if (probe.error || probe.status !== 0) fail("PROTECTED_DATABASE_LOCK_CHECK_FAILED");
    } finally { closeSync(descriptor); }
  }
  const handles = spawnSync("lsof", ["--", path], { encoding: "utf8" });
  if ((handles.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") fail("PROTECTED_DATABASE_LSOF_REQUIRED");
  if (handles.error || handles.status === null) fail("PROTECTED_DATABASE_OPEN_HANDLE_CHECK_FAILED");
  if (handles.status === 0 && handles.stdout.trim()) fail(`PROTECTED_DATABASE_OPEN_HANDLE: ${handles.stdout.trim()}`);
  if (handles.status !== 0 && handles.status !== 1) fail("PROTECTED_DATABASE_OPEN_HANDLE_CHECK_FAILED");
  const stat = statSync(path, { bigint: true });
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) fail("PROTECTED_DATABASE_PATH_CHANGED_DURING_INSPECTION");
    bytes = readFileSync(descriptor);
    const read = fstatSync(descriptor, { bigint: true }), current = statSync(path, { bigint: true });
    if (read.size !== stat.size || read.mtimeNs !== stat.mtimeNs || read.ctimeNs !== stat.ctimeNs ||
      current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size ||
      current.mtimeNs !== stat.mtimeNs || current.ctimeNs !== stat.ctimeNs || BigInt(bytes.length) !== stat.size) {
      fail("PROTECTED_DATABASE_CHANGED_DURING_INSPECTION");
    }
  } finally { closeSync(descriptor); }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const snapshotDir = mkdtempSync(join(tmpdir(), "operatoros-s43-snapshot-"));
  const snapshotPath = join(snapshotDir, "attendance.db");
  try {
    writeFileSync(snapshotPath, bytes, { flag: "wx", mode: 0o400 });
    const client = openSqliteConnection(snapshotPath, { readonly: true, fileMustExist: true }).client;
    try {
      const head = (client.query("SELECT version FROM operatoros_schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1").get() as { version: string } | null)?.version ?? null;
      const ledger = (client.query("SELECT COUNT(*) AS count FROM operatoros_schema_migrations WHERE version=?").get(S43_HEAD) as { count: number }).count;
      const tables = new Set((client.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
      const integrity = (client.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      const quick = (client.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
      const violations = client.query("PRAGMA foreign_key_check").all().length;
      if (head !== S43_HEAD || ledger !== 1 || !EXPECTED_TABLES.every(table => tables.has(table))) fail("PROTECTED_DATABASE_S43_STATE_INVALID");
      if (integrity !== "ok" || quick !== "ok" || violations) fail("PROTECTED_DATABASE_INTEGRITY_INVALID");
      return { path, sha256, size: stat.size, inode: stat.ino, mode: stat.mode & 0o7777n, mtime_ns: stat.mtimeNs, ctime_ns: stat.ctimeNs,
        head, ledger, integrity, quick, foreign_key_violations: violations, sidecars };
    } finally { client.close(); }
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}
// The CLI must retain full nanosecond/inode integers rather than rounding through Number.
export const snapshotJson = (value: ReturnType<typeof protectedSnapshot>): string => `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${typeof item === "bigint" ? item.toString() : JSON.stringify(item)}`).join(",")}}`;
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 2 && args[0] === "select") { const result = selectProtectedDatabase(args[1]!); console.log(`${result.mode}\t${result.path}`); }
    else if (args.length === 2 && args[0] === "assert-absent") assertProtectedAbsent(args[1]!);
    else if (args.length === 1) console.log(snapshotJson(protectedSnapshot(args[0]!)));
    else fail("usage: protected-snapshot-cli.ts [select REPOSITORY|assert-absent PATH|PATH]");
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
