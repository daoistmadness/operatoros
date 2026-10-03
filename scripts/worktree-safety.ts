import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const env = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete env[key];
const git = (repo: string, ...args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
const refuse = (message: string) => { console.log(message); return 2; };
function result(command: ReturnType<typeof git>, success: string, fallback: string): number {
  console.log(command.exitCode ? command.stderr.toString().trim() || fallback : success);
  return command.exitCode;
}

export function worktreeSafety(args: string[]): number {
  const [command, ...options] = args;
  const { values } = parseArgs({ args: options, options: { repo: { type: "string" }, branch: { type: "string" }, path: { type: "string" }, main: { type: "string", default: "main" } } });
  if (!values.repo) return refuse("--repo is required");
  const repo = canonical(values.repo), main = values.main!;
  if (command === "delete-branch") {
    if (!values.branch) return refuse("--branch is required");
    if (values.branch === "main" || values.branch === main) return refuse("BRANCH_DELETE_PRIMARY_REFUSED");
    if (git(repo, "merge-base", "--is-ancestor", values.branch, main).exitCode !== 0) return refuse(`BRANCH_DELETE_WITHOUT_MERGE_BASE_CHECK: ${values.branch} is not merged into ${main}\nThe branch was not deleted. Merge it deliberately, then retry.`);
    return result(git(repo, "branch", "-d", "--", values.branch), `Deleted merged branch ${values.branch}`, `Could not delete branch ${values.branch}`);
  }
  if (command === "remove-worktree") {
    if (!values.path) return refuse("--path is required");
    const target = canonical(values.path), listing = git(repo, "worktree", "list", "--porcelain");
    if (listing.exitCode) return refuse(listing.stderr.toString().trim() || "git worktree list failed");
    const paths = listing.stdout.toString().split("\n").filter(line => line.startsWith("worktree ")).map(line => canonical(line.slice(9)));
    if (target === repo || target === paths[0]) return refuse("WORKTREE_REMOVE_PRIMARY_REFUSED");
    if (!paths.includes(target)) return refuse(`WORKTREE_REMOVE_UNKNOWN_PATH: ${target}`);
    const status = git(target, "status", "--porcelain=v1", "--untracked-files=all");
    if (status.exitCode) return result(status, "", `Could not inspect worktree ${target}`);
    if (status.stdout.length) return refuse(`WORKTREE_REMOVE_DIRTY: ${target}\n${status.stdout.toString()}The worktree was not removed. No --force removal is available.`);
    if (git(repo, "merge-base", "--is-ancestor", git(target, "rev-parse", "HEAD").stdout.toString().trim(), main).exitCode !== 0) return refuse(`WORKTREE_REMOVE_UNMERGED: ${target} is not merged into ${main}`);
    return result(git(repo, "worktree", "remove", "--", target), `Removed clean worktree ${target}`, `Could not remove worktree ${target}`);
  }
  return refuse(`Unknown command: ${command ?? ""}`);
}

if (import.meta.main) {
  try { process.exitCode = worktreeSafety(process.argv.slice(2)); }
  catch (error) { process.exitCode = refuse(error instanceof Error ? error.message : String(error)); }
}
