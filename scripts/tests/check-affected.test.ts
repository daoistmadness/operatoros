import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const repository = resolve(import.meta.dir, "../..");
const cleanEnv = { ...process.env };
const localVars = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
if (localVars.exitCode !== 0) throw new Error("Git local environment discovery failed");
for (const name of localVars.stdout.toString().trim().split("\n")) delete cleanEnv[name];

function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-check-affected-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  git(root, "init", "-q");
  writeFileSync(join(root, "source.ts"), "export const source = true;\n");
  git(root, "add", "source.ts");
  git(root, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/main", base);
  writeFileSync(join(root, "scripts/check-affected.sh"), readFileSync(join(repository, "scripts/check-affected.sh")));
  chmodSync(join(root, "scripts/check-affected.sh"), 0o755);
  writeFileSync(join(root, "bin/bun"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    '[[ "$1" == "run" && "$2" == "turbo:check" ]] || exit 64',
    'if [[ -n "${MOVE_REMOTE_TO:-}" ]]; then git -C "$FIXTURE_REPO" update-ref refs/remotes/origin/main "$MOVE_REMOTE_TO"; fi',
    'printf "base=%s\\nhead=%s\\n" "${TURBO_SCM_BASE:-}" "${TURBO_SCM_HEAD:-}" > "$CAPTURE"',
    'printf "arg=%s\\n" "$@" >> "$CAPTURE"',
  ].join("\n"));
  chmodSync(join(root, "bin/bun"), 0o755);
  git(root, "add", "scripts/check-affected.sh", "bin/bun");
  git(root, "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "head");
  const head = git(root, "rev-parse", "HEAD");
  return { root, base, head, capture: join(root, "capture.txt") };
}

function run(repo: ReturnType<typeof fixture>, moveRemote = false) {
  return Bun.spawnSync(["bash", join(repo.root, "scripts/check-affected.sh")], {
    cwd: repo.root,
    env: {
      ...cleanEnv,
      PATH: `${join(repo.root, "bin")}:${cleanEnv.PATH ?? ""}`,
      FIXTURE_REPO: repo.root,
      CAPTURE: repo.capture,
      ...(moveRemote ? { MOVE_REMOTE_TO: repo.head } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("affected validation selection", () => {
  test("passes the resolved immutable base and head SHAs even if the ref advances", () => {
    const repo = fixture();
    const result = run(repo, true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("affected_mode=commit-range");
    expect(git(repo.root, "rev-parse", "refs/remotes/origin/main")).toBe(repo.head);
    const capture = readFileSync(repo.capture, "utf8");
    expect(capture).toContain(`base=${repo.base}\nhead=${repo.head}\n`);
    expect(capture).toContain("arg=--affected");
  });

  test.each([
    ["staged shared package", (repo: ReturnType<typeof fixture>) => {
      mkdirSync(join(repo.root, "packages/contracts/src"), { recursive: true });
      writeFileSync(join(repo.root, "packages/contracts/src/index.ts"), "export const changed = true;\n");
      git(repo.root, "add", "packages/contracts/src/index.ts");
    }],
    ["unstaged source", (repo: ReturnType<typeof fixture>) => writeFileSync(join(repo.root, "source.ts"), "export const source = false;\n")],
    ["untracked source", (repo: ReturnType<typeof fixture>) => writeFileSync(join(repo.root, "untracked.ts"), "export const changed = true;\n")],
    ["deleted source", (repo: ReturnType<typeof fixture>) => rmSync(join(repo.root, "source.ts"))],
    ["renamed source", (repo: ReturnType<typeof fixture>) => git(repo.root, "mv", "source.ts", "renamed.ts")],
    ["configuration change", (repo: ReturnType<typeof fixture>) => writeFileSync(join(repo.root, "turbo.json"), "{}\n")],
  ])("runs full validation for %s in the working tree", (_label, change) => {
    const repo = fixture();
    change(repo);
    const result = run(repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("affected_mode=full");
    expect(readFileSync(repo.capture, "utf8")).not.toContain("arg=--affected");
  });

  test("pre-push captures one base before running every affected check", () => {
    const source = readFileSync(join(repository, "scripts/check-pre-push.sh"), "utf8");
    const hk = readFileSync(join(repository, "hk.pkl"), "utf8");
    expect(source.indexOf('base_sha="$(git merge-base HEAD origin/main)"')).toBeLessThan(source.indexOf("check-markdown-links.ts"));
    for (const command of ["lint pre-push", "architecture pre-push", "affected-tests pre-push"]) {
      expect(source).toContain(`TURBO_SCM_BASE=\"$base_sha\" TURBO_SCM_HEAD=\"$head_sha\" bash scripts/local-feedback-loop.sh ${command}`);
    }
    expect(source).toContain('intent maintainer check --base "$base_sha"');
    expect(hk.match(/\["pre-push"\][\s\S]*?\["fast-ci-checks"\]/)?.[0]).toBeDefined();
    expect(hk).not.toContain("affected-lint");
    expect(hk).not.toContain("affected-tests");
  });
});
