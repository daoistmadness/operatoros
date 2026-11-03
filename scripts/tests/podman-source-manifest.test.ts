import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { assertCleanWorktree, createSourceManifest } from "../podman-source-manifest.mjs";

const gitLocalEnvironment = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
if (gitLocalEnvironment.exitCode !== 0) throw new Error("Git local environment discovery failed");
const gitLocalEnvironmentNames = gitLocalEnvironment.stdout.toString().trim().split("\n");

function git(root: string, args: string[], inheritedEnvironment = process.env): string {
  const environment = { ...inheritedEnvironment };
  for (const name of gitLocalEnvironmentNames) delete environment[name];
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: environment }).trim();
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "operatoros-source-manifest-test-"));
  git(root, ["init", "--quiet", "-b", "main"]);
  git(root, ["config", "user.name", "Synthetic Test"]);
  git(root, ["config", "user.email", "synthetic@example.test"]);
  return root;
}

describe("Podman source manifest", () => {
  it("keeps synthetic Git commands in their target repo under inherited hook state", () => {
    const target = createRepo();
    const outer = createRepo();
    try {
      writeFileSync(join(target, "source.txt"), "synthetic source\n");
      const hookEnvironment = {
        ...process.env,
        GIT_DIR: join(outer, ".git"),
        GIT_WORK_TREE: outer,
        GIT_COMMON_DIR: join(outer, ".git"),
        GIT_INDEX_FILE: join(outer, ".git", "index"),
        GIT_PREFIX: "",
      };

      git(target, ["add", "source.txt"], hookEnvironment);
      git(target, ["commit", "--quiet", "-m", "synthetic source"], hookEnvironment);

      expect(git(target, ["rev-parse", "--show-toplevel"], hookEnvironment)).toBe(target);
      expect(git(outer, ["status", "--porcelain"], hookEnvironment)).toBe("");
    } finally {
      rmSync(target, { recursive: true, force: true });
      rmSync(outer, { recursive: true, force: true });
    }
  });

  it("uses committed file content and Git modes rather than host checkout permissions", () => {
    const root = createRepo();
    try {
      mkdirSync(join(root, "build"));
      writeFileSync(join(root, ".gitignore"), "build/\n");
      writeFileSync(join(root, "plain.txt"), "committed content\n", { mode: 0o644 });
      writeFileSync(join(root, "run.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      symlinkSync("plain.txt", join(root, "alias.txt"));
      writeFileSync(join(root, "build", "stale.txt"), "ignored output\n");
      git(root, ["add", "."]);
      git(root, ["commit", "--quiet", "-m", "synthetic source"]);
      const commit = git(root, ["rev-parse", "HEAD"]);
      const tree = git(root, ["rev-parse", "HEAD^{tree}"]);

      git(root, ["config", "core.filemode", "false"]);
      chmodSync(join(root, "plain.txt"), 0o664);
      chmodSync(join(root, "run.sh"), 0o775);

      const manifest = createSourceManifest(root);
      expect(manifest.commit).toBe(commit);
      expect(manifest.tree).toBe(tree);
      expect(manifest.files).toEqual([
        expect.objectContaining({ path: ".gitignore", kind: "file", mode: 0o644 }),
        expect.objectContaining({ path: "alias.txt", kind: "symlink", mode: 0o777 }),
        expect.objectContaining({ path: "plain.txt", kind: "file", mode: 0o644 }),
        expect.objectContaining({ path: "run.sh", kind: "file", mode: 0o755 }),
      ]);
      expect(manifest.files.some((entry) => entry.path === "build/stale.txt")).toBe(false);
      expect(readFileSync(join(root, "plain.txt"), "utf8")).toBe("committed content\n");
      chmodSync(join(root, "run.sh"), 0o644);
      expect(() => createSourceManifest(root)).toThrow("executable bit differs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects tracked edits and untracked files before a source manifest is accepted", () => {
    const root = createRepo();
    try {
      writeFileSync(join(root, "source.txt"), "committed\n");
      git(root, ["add", "source.txt"]);
      git(root, ["commit", "--quiet", "-m", "synthetic source"]);
      expect(() => assertCleanWorktree(root)).not.toThrow();

      writeFileSync(join(root, "source.txt"), "modified\n");
      expect(() => assertCleanWorktree(root)).toThrow("must be clean");
      writeFileSync(join(root, "source.txt"), "committed\n");
      writeFileSync(join(root, "untracked.ts"), "untracked source\n");
      expect(() => createSourceManifest(root)).toThrow("must be clean");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
