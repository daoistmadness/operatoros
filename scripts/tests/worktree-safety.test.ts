import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [], env = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete env[key];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(repo: string, ...args: string[]) {
  const value = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (value.exitCode) throw new Error(value.stderr.toString());
  return value.stdout.toString().trim();
}
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "operatoros-worktree-safety-")); roots.push(repo);
  git(repo, "init", "-qb", "main"); git(repo, "config", "user.name", "Synthetic"); git(repo, "config", "user.email", "synthetic@example.invalid");
  git(repo, "commit", "--allow-empty", "-qm", "fixture");
  const other = join(repo, "other"); git(repo, "worktree", "add", "-b", "task", other);
  return { repo, other };
}
function safety(repo: string, ...args: string[]) {
  const value = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../worktree-safety.ts"), ...args, "--repo", repo], { env, stdout: "pipe", stderr: "pipe" });
  return { code: value.exitCode, stdout: value.stdout.toString(), stderr: value.stderr.toString() };
}
test("primary and unknown worktrees cannot be removed", () => {
  const f = fixture();
  expect(safety(f.repo, "remove-worktree", "--path", f.repo)).toEqual({ code: 2, stdout: "WORKTREE_REMOVE_PRIMARY_REFUSED\n", stderr: "" });
  expect(safety(f.other, "remove-worktree", "--path", f.repo).stdout).toBe("WORKTREE_REMOVE_PRIMARY_REFUSED\n");
  const unknown = join(f.repo, "missing");
  expect(safety(f.repo, "remove-worktree", "--path", unknown)).toEqual({ code: 2, stdout: `WORKTREE_REMOVE_UNKNOWN_PATH: ${unknown}\n`, stderr: "" });
});
test("dirty worktree diagnostic is preserved; no artifact is removed", () => {
  const f = fixture(); writeFileSync(join(f.other, "dirty.txt"), "synthetic");
  expect(safety(f.repo, "remove-worktree", "--path", f.other)).toEqual({ code: 2, stdout: `WORKTREE_REMOVE_DIRTY: ${f.other}\n?? dirty.txt\nThe worktree was not removed. No --force removal is available.\n`, stderr: "" });
  expect(existsSync(join(f.other, "dirty.txt"))).toBe(true);
});
test("clean unmerged worktree is preserved", () => {
  const f = fixture(); writeFileSync(join(f.other, "work.txt"), "synthetic"); git(f.other, "add", "work.txt"); git(f.other, "commit", "-qm", "unmerged");
  const before = git(f.other, "rev-parse", "HEAD");
  expect(safety(f.repo, "remove-worktree", "--path", f.other)).toEqual({ code: 2, stdout: `WORKTREE_REMOVE_UNMERGED: ${f.other} is not merged into main\n`, stderr: "" });
  expect(git(f.other, "rev-parse", "HEAD")).toBe(before);
});
test("merged clean worktree and branch can be removed", () => {
  const f = fixture();
  expect(safety(f.repo, "remove-worktree", "--path", f.other)).toEqual({ code: 0, stdout: `Removed clean worktree ${f.other}\n`, stderr: "" });
  expect(existsSync(f.other)).toBe(false);
  expect(safety(f.repo, "delete-branch", "--branch", "task")).toEqual({ code: 0, stdout: "Deleted merged branch task\n", stderr: "" });
  expect(git(f.repo, "branch", "--list", "task")).toBe("");
});
test("primary, unmerged, and checked-out branches are preserved", () => {
  const f = fixture();
  expect(safety(f.repo, "delete-branch", "--branch", "main")).toEqual({ code: 2, stdout: "BRANCH_DELETE_PRIMARY_REFUSED\n", stderr: "" });
  expect(safety(f.repo, "delete-branch", "--branch", "main", "--main", "task").stdout).toBe("BRANCH_DELETE_PRIMARY_REFUSED\n");
  expect(safety(f.repo, "delete-branch", "--branch", "task").code).toBe(1);
  git(f.other, "commit", "--allow-empty", "-qm", "unmerged");
  expect(safety(f.repo, "delete-branch", "--branch", "task")).toEqual({ code: 2, stdout: "BRANCH_DELETE_WITHOUT_MERGE_BASE_CHECK: task is not merged into main\nThe branch was not deleted. Merge it deliberately, then retry.\n", stderr: "" });
  expect(git(f.repo, "branch", "--list", "task")).toContain("task");
});
