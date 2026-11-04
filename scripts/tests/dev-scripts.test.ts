import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");
const roots: string[] = [];

// Hermetic environment: strip every Git local variable so fixtures cannot be
// influenced by the checkout that runs the tests.
const cleanEnv: Record<string, string> = { ...process.env } as Record<string, string>;
const localVars = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
if (localVars.exitCode !== 0) throw new Error("Git local environment discovery failed");
for (const name of localVars.stdout.toString().trim().split("\n")) delete cleanEnv[name];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env: cleanEnv, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

function fixture() {
  const repo = temporaryDirectory("operatoros-dev-scripts-");
  git(repo, "init", "-qb", "main");
  git(repo, "config", "user.name", "Synthetic Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repo, "README.md"), "# fixture\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-qm", "fixture");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(resolve(repository, "scripts/doctor"), join(repo, "scripts/doctor"));
  chmodSync(join(repo, "scripts/doctor"), 0o755);
  git(repo, "add", "scripts/doctor");
  git(repo, "commit", "-qm", "fixture: add doctor");
  return repo;
}

function doctor(repo: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync([join(repo, "scripts/doctor"), "--git-only"], {
    cwd: repo,
    env: { ...cleanEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

function stopScript(runtime: string) {
  const result = Bun.spawnSync([resolve(repository, "scripts/stop")], {
    cwd: repository,
    env: { ...cleanEnv, OPERATOROS_RUNTIME_DIR: runtime },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("scripts/doctor Git integrity", () => {
  test("passes on a clean checkout", () => {
    const repo = fixture();
    const result = doctor(repo);
    expect(result.code).toBe(0);
    expect(result.output).toContain("PASS: git integrity");
    expect(result.output).toContain(repo);
    expect(result.output).toContain("PASS: git-only diagnostics");
  });

  test("rejects a misdirected core.worktree", () => {
    const repo = fixture();
    const other = temporaryDirectory("operatoros-other-worktree-");
    git(repo, "config", "core.worktree", other);
    const result = doctor(repo);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("GIT_CORE_WORKTREE_SET");
    expect(result.output).toContain("git config --local --unset core.worktree");
    expect(result.output).not.toContain("PASS: git-only diagnostics");
  });

  test("allows normal tracked and untracked development changes", () => {
    const repo = fixture();
    writeFileSync(join(repo, "README.md"), "# fixture\n\nlocal edit\n");
    writeFileSync(join(repo, "scratch-note.txt"), "untracked\n");
    const result = doctor(repo);
    expect(result.code).toBe(0);
    expect(result.output).toContain("uncommitted work allowed");
    expect(result.output).toMatch(/tracked changes=1/);
    expect(result.output).toMatch(/untracked files=1/);
  });

  test("rejects Git environment overrides", () => {
    const repo = fixture();
    const result = doctor(repo, { GIT_DIR: join(repo, ".git") });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("GIT_ENVIRONMENT_OVERRIDE");
    expect(result.output).toContain("GIT_DIR");
  });
});

describe("scripts/stop ownership safety", () => {
  test("reports an absent session without touching processes", () => {
    const runtime = temporaryDirectory("operatoros-stop-empty-");
    const result = stopScript(runtime);
    expect(result.code).toBe(0);
    expect(result.output).toContain("No active OperatorOS development session");
  });

  test("refuses a stale or PID-reused process record", async () => {
    const runtime = temporaryDirectory("operatoros-stop-stale-");
    const session = "fixture-session";
    const directory = join(runtime, "sessions", session);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "ownership.json"), JSON.stringify({ application: "OperatorOS", session_id: session, format_version: 1 }));
    writeFileSync(join(directory, "session.json"), JSON.stringify({ session_id: session, status: "running" }));
    writeFileSync(join(runtime, "active-session"), `${session}\n`);

    const sleeper = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    try {
      // Deliberately wrong start_ticks models a PID that was reused by an
      // unrelated process after the record was written.
      writeFileSync(join(directory, "backend.pid"), JSON.stringify({
        pid: sleeper.pid,
        role: "backend",
        start_ticks: "0",
        recorded_at: new Date().toISOString(),
        token: "stale-token",
        session_id: session,
        port: 8000,
      }));

      const result = stopScript(runtime);
      expect(result.output).toContain("Refusing");
      expect(result.output).toContain("backend");
      expect(alive(sleeper.pid)).toBe(true);
    } finally {
      sleeper.kill();
      await sleeper.exited;
    }
  });
});

describe("thin wrapper delegation", () => {
  test("scripts/dev forwards --help to the managed launcher", () => {
    const result = Bun.spawnSync([resolve(repository, "scripts/dev"), "--help"], {
      cwd: repository,
      env: cleanEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: ./start-dev.sh");
  });

  test("scripts/check exposes help without running the gate", () => {
    const result = Bun.spawnSync([resolve(repository, "scripts/check"), "--help"], {
      cwd: repository,
      env: cleanEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: ./scripts/check");
  });
});
