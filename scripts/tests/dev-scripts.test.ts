import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");
const roots: string[] = [];
const children: Bun.Subprocess[] = [];

// Hermetic environment: strip every Git local variable so fixtures cannot be
// influenced by the checkout that runs the tests.
const cleanEnv: Record<string, string> = { ...process.env } as Record<string, string>;
const localVars = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "pipe" });
if (localVars.exitCode !== 0) throw new Error("Git local environment discovery failed");
for (const name of localVars.stdout.toString().trim().split("\n")) delete cleanEnv[name];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
    }
    await child.exited;
  }
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

function writeText(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path: string, value: unknown) {
  writeText(path, JSON.stringify(value));
}

// A disposable checkout containing the real stop wrapper, stop-dev.sh, and
// runtime helper, plus synthetic API/frontend entrypoints that the runtime
// recognizes as OperatorOS services.
function ownedFixture() {
  const root = temporaryDirectory("operatoros-stop-e2e-");
  const repo = join(root, "repo");
  const runtime = join(root, "runtime");
  mkdirSync(repo);
  git(repo, "init", "-qb", "main");
  git(repo, "config", "user.name", "Synthetic Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  for (const app of ["api", "web"]) writeJson(join(repo, `apps/${app}/package.json`), { name: `@operatoros/${app}` });
  const server =
    'const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("synthetic") });' +
    ' for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.stop(true); process.exit(0); });' +
    " console.log(server.port);";
  writeText(join(repo, "apps/api/src/server.ts"), server);
  writeText(join(repo, "apps/web/vite.js"), server);
  for (const path of ["stop-dev.sh", "scripts/stop", "scripts/operatoros-dev-runtime.ts", "scripts/validate-wsl-bun.sh"]) {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(repository, path), target);
  }
  chmodSync(join(repo, "scripts/stop"), 0o755);
  writeText(join(repo, "package.json"), "{}");
  writeText(join(repo, "bun.lock"), "fixture");
  writeText(join(repo, "mise.toml"), `[tools]\nbun = "${Bun.version}"\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "fixture");
  return { root, repo, runtime };
}

function runtimeCli(repo: string, runtime: string, action: string, args: string[]) {
  const result = Bun.spawnSync(
    [process.execPath, join(repo, "scripts/operatoros-dev-runtime.ts"), action, "--repo", repo, "--runtime", runtime, ...args],
    {
      cwd: repo,
      env: { ...cleanEnv, OPERATOROS_PRIMARY_CHECKOUT_PATH: repo },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    },
  );
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

async function ownedService(repo: string, role: "backend" | "frontend") {
  const cwd = join(repo, role === "backend" ? "apps/api" : "apps/web");
  const path = join(cwd, role === "backend" ? "src/server.ts" : "vite.js");
  const child = Bun.spawn(["setsid", process.execPath, path], {
    cwd,
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  const reader = child.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const value = await reader.read();
    if (value.done) throw new Error("synthetic listener exited before readiness");
    text += new TextDecoder().decode(value.value);
  }
  reader.releaseLock();
  return { child, port: Number(text.trim()) };
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

  test("allows legitimate staged changes", () => {
    const repo = fixture();
    writeFileSync(join(repo, "README.md"), "# fixture\n\nstaged edit\n");
    writeFileSync(join(repo, "staged-note.txt"), "staged\n");
    git(repo, "add", "README.md", "staged-note.txt");
    const result = doctor(repo);
    expect(result.code).toBe(0);
    expect(result.output).toContain("uncommitted work allowed");
    expect(result.output).toMatch(/tracked changes=2/);
    expect(result.output).toMatch(/untracked files=0/);
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

  test("terminates a correctly registered session and leaves unrelated processes alone", async () => {
    const fixtureRepo = ownedFixture();
    const backend = await ownedService(fixtureRepo.repo, "backend");
    const launcher = Bun.spawn(["sleep", "120"], { cwd: fixtureRepo.repo, env: cleanEnv, stdout: "ignore", stderr: "ignore" });
    children.push(launcher);
    const init = runtimeCli(fixtureRepo.repo, fixtureRepo.runtime, "init-session", [
      "--session", "fixture", "--mode", "browser", "--token", "synthetic-token",
      "--javascript-runtime", "bun", "--javascript-runtime-version", Bun.version,
      "--launcher-pid", String(launcher.pid),
      "--frontend-host", "127.0.0.1", "--backend-host", "127.0.0.1",
      "--frontend-port", "45123", "--backend-port", "45124",
      "--database-path", join(fixtureRepo.root, "data/operatoros.sqlite"),
    ]);
    expect(init.code).toBe(0);
    const register = runtimeCli(fixtureRepo.repo, fixtureRepo.runtime, "register", [
      "--session", "fixture", "--role", "backend", "--token", "synthetic-token",
      "--pid", String(backend.child.pid), "--port", String(backend.port),
    ]);
    expect(register.code).toBe(0);

    const unrelated = Bun.spawn(["setsid", "sleep", "120"], { cwd: fixtureRepo.repo, env: cleanEnv, stdout: "ignore", stderr: "ignore" });
    children.push(unrelated);

    const result = Bun.spawnSync([join(fixtureRepo.repo, "scripts/stop")], {
      cwd: fixtureRepo.repo,
      env: { ...cleanEnv, OPERATOROS_RUNTIME_DIR: fixtureRepo.runtime },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    expect(result.exitCode).toBe(0);
    await backend.child.exited;
    expect(alive(backend.child.pid)).toBe(false);
    expect(alive(unrelated.pid)).toBe(true);
    const session = JSON.parse(readFileSync(join(fixtureRepo.runtime, "sessions", "fixture", "session.json"), "utf8"));
    expect(session.status).toBe("stopped");
    expect(existsSync(join(fixtureRepo.runtime, "sessions", "fixture", "backend.pid"))).toBe(false);
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
