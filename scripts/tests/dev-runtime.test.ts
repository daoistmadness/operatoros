import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { matchingService, type ProcessInfo } from "../operatoros-dev-runtime";

const helper = resolve(import.meta.dir, "../operatoros-dev-runtime.ts"), roots: string[] = [], children: Bun.Subprocess[] = [];
const repository = resolve(import.meta.dir, "../..");
const env = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete env[key];
delete env.DATABASE_URL; delete env.PROTECTED_DB_PATH;
function write(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); }
function git(repo: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
function ticks(pid: number) { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!; }
function alive(pid: number) { try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]![0] !== "Z"; } catch { return false; } }
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && alive(child.pid)) {
      const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1]!.split(" ");
      if (Number(stat[2]) === child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      else child.kill();
    }
    await child.exited;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-runtime-test-")); roots.push(root);
  const repo = join(root, "repo"), runtime = join(root, "runtime"); mkdirSync(repo);
  git(repo, "init", "-qb", "main"); git(repo, "config", "user.name", "Synthetic"); git(repo, "config", "user.email", "synthetic@example.invalid");
  for (const app of ["api", "web"]) write(join(repo, `apps/${app}/package.json`), { name: `@operatoros/${app}` });
  const server = 'const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("synthetic") }); for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.stop(true); process.exit(0); }); console.log(server.port);';
  write(join(repo, "apps/api/src/server.ts"), server); write(join(repo, "apps/web/vite.js"), server);
  git(repo, "add", "apps"); git(repo, "commit", "-qm", "fixture");
  return { root, repo, runtime, shared: join(repo, ".git/operatoros-dev-sessions"), data: join(root, "data/operatoros.sqlite") };
}
type Fixture = ReturnType<typeof fixture>;
function cli(f: Fixture, action: string, args: string[] = [], extraEnv = {}) {
  const result = Bun.spawnSync([process.execPath, helper, action, "--repo", f.repo, "--runtime", f.runtime, ...args], { cwd: f.repo, env: { ...env, OPERATOROS_PRIMARY_CHECKOUT_PATH: f.repo, ...extraEnv }, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
  let stdout = result.stdout.toString().trim();
  try { stdout = JSON.stringify(JSON.parse(stdout)); } catch { /* Human diagnostics retain their text. */ }
  return { code: result.exitCode, stdout, stderr: result.stderr.toString().trim() };
}
async function service(f: Fixture, role = "backend", script?: string) {
  const cwd = join(f.repo, role === "backend" ? "apps/api" : "apps/web");
  const path = script || join(cwd, role === "backend" ? "src/server.ts" : "vite.js");
  const child = Bun.spawn(["setsid", process.execPath, path], { cwd, env, stdout: "pipe", stderr: "pipe" }); children.push(child);
  const reader = child.stdout.getReader(); let text = "";
  while (!text.includes("\n")) { const value = await reader.read(); if (value.done) throw new Error("Synthetic listener exited before readiness"); text += new TextDecoder().decode(value.value); }
  reader.releaseLock();
  return { child, port: Number(text.trim()), role };
}
function init(f: Fixture, session = "fixture", ports = { backend: 45124, frontend: 45123 }) {
  const launcher = Bun.spawn(["sleep", "120"], { cwd: f.repo, env, stdout: "ignore", stderr: "ignore" }); children.push(launcher);
  const result = cli(f, "init-session", ["--session", session, "--mode", "browser", "--token", "synthetic-token", "--javascript-runtime", "bun", "--javascript-runtime-version", Bun.version,
    "--launcher-pid", String(launcher.pid), "--frontend-host", "127.0.0.1", "--backend-host", "127.0.0.1", "--frontend-port", String(ports.frontend), "--backend-port", String(ports.backend), "--database-path", f.data]);
  expect(result.code).toBe(0); return launcher;
}
function register(f: Fixture, listener: Awaited<ReturnType<typeof service>>, session = "fixture") {
  expect(cli(f, "register", ["--session", session, "--role", listener.role, "--token", "synthetic-token", "--pid", String(listener.child.pid), "--port", String(listener.port)]).code).toBe(0);
}
test("configuration, symlink roles, and dotenv decisions use TS authority", () => {
  const f = fixture();
  expect(cli(f, "primary-path").stdout).toBe(f.repo);
  expect(cli(f, "primary-path", [], { OPERATOROS_PRIMARY_CHECKOUT_PATH: "relative" }).code).toBe(2);
  const alias = join(f.root, "alias"); symlinkSync(f.repo, alias);
  expect(cli({ ...f, repo: alias }, "worktree-role", [], { OPERATOROS_PRIMARY_CHECKOUT_PATH: f.repo }).stdout).toBe("PRIMARY");
  expect(cli(f, "dotenv-database-url", ["--env-file", join(f.root, "missing.env")]).stdout).toBe("false");
  write(join(f.root, "test.env"), "# DATABASE_URL=hidden\n export DATABASE_URL = secret-not-for-output\n");
  expect(cli(f, "dotenv-database-url", ["--env-file", join(f.root, "test.env")]).stdout).toBe("true");
});
test("only exact backend entrypoint or Vite identity matches a service", () => {
  const f = fixture(), info: ProcessInfo = { pid: 1, ppid: 0, pgid: 1, start_ticks: "1", cwd: join(f.repo, "apps/api"), argv: ["bun", "src/server.ts"], uid: process.getuid!(), state: "S" };
  expect(matchingService(info, f.repo, "backend")).toBe(true);
  for (const word of ["src/server.ts.evil", "--server.ts", "other/server.ts", join(f.root, "server.ts")]) expect(matchingService({ ...info, argv: ["bun", word] }, f.repo, "backend")).toBe(false);
  expect(matchingService({ ...info, cwd: join(f.root, "outside") }, f.repo, "backend")).toBe(false);
});
test("active session lifecycle preserves registry identity and never cleans an active listener", async () => {
  const f = fixture(), listener = await service(f); init(f, "fixture", { backend: listener.port, frontend: 45123 }); register(f, listener);
  const session = json(join(f.shared, "fixture/session.json"));
  expect(session.worktreePath).toBe(f.repo); expect(session.repoCommonDir).toBe(join(f.repo, ".git")); expect(session.worktreeRole).toBe("PRIMARY");
  expect(session.commit).toBe(git(f.repo, "rev-parse", "HEAD")); expect(session.pids.backend).toBe(listener.child.pid);
  expect(cli(f, "status")).toEqual({ code: 0, stdout: '{"state":"ACTIVE_VERIFIED"}', stderr: "" });
  expect(cli(f, "require-no-active-session")).toEqual({ code: 3, stdout: "fixture", stderr: "" });
  const classified = JSON.parse(cli(f, "classify-port", ["--port", String(listener.port)]).stdout)[0];
  expect(classified.ownership_decision).toBe("OPERATOROS_ACTIVE"); expect(classified.start_ticks).toBe(ticks(listener.child.pid));
  expect(classified).not.toHaveProperty("argv"); expect(classified).not.toHaveProperty("command");
  expect(cli(f, "cleanup-port", ["--port", String(listener.port)]).code).toBe(3); expect(alive(listener.child.pid)).toBe(true);
  expect(cli(f, "finalize-session", ["--session", "fixture"]).stderr).toBe("ACTIVE_OWNED_SESSION:backend");
  expect(cli(f, "mark", ["--session", "fixture", "--status", "ready"]).code).toBe(0);
  expect(json(join(f.shared, "fixture/ports.json")).status).toBe("ready");
  expect(cli(f, "stop", ["--session", "fixture", "--timeout", "1"]).code).toBe(0); await listener.child.exited;
  expect(json(join(f.shared, "fixture/session.json")).status).toBe("stopped"); expect(existsSync(join(f.shared, "fixture/backend.pid"))).toBe(false);
  write(f.data, "synthetic database sentinel");
  expect(cli(f, "finalize-session", ["--session", "fixture"]).code).toBe(0); expect(existsSync(join(f.shared, "fixture"))).toBe(false);
  expect(readFileSync(f.data, "utf8")).toBe("synthetic database sentinel");
});
test("unregistered discovery and PID reuse cannot authorize signals", async () => {
  const f = fixture(), listener = await service(f);
  expect(cli(f, "classify-port", ["--port", String(listener.port), "--decision"]).stdout).toBe("OPERATOROS_CURRENT_CHECKOUT");
  expect(cli(f, "cleanup-port", ["--port", String(listener.port)]).code).toBe(3);
  init(f); register(f, listener);
  for (const root of [join(f.runtime, "sessions"), f.shared]) {
    const path = join(root, "fixture/backend.pid"), record = json(path); record.start_ticks = "reused"; write(path, record);
  }
  expect(cli(f, "require-no-active-session").stderr).toBe("STALE_SESSION_UNVERIFIED");
  const stopped = cli(f, "stop-owned-session", ["--session", "fixture", "--timeout", "1"]);
  expect(JSON.parse(stopped.stdout).owned_groups).toBe(0); expect(alive(listener.child.pid)).toBe(true);
});
test("stale owned listener is cleaned only after launcher identity expires", async () => {
  const f = fixture(), listener = await service(f, "frontend"), launcher = init(f); register(f, listener);
  launcher.kill(); await launcher.exited;
  expect(cli(f, "classify-port", ["--port", String(listener.port), "--decision"]).stdout).toBe("OPERATOROS_STALE");
  expect(cli(f, "cleanup-port", ["--port", String(listener.port), "--timeout", "1"]).code).toBe(0);
  await listener.child.exited; expect(alive(listener.child.pid)).toBe(false);
});
test("sibling active registry is protected and reports stable checkout fields", async () => {
  const f = fixture(), other = join(f.root, "other"); git(f.repo, "worktree", "add", "-b", "task", other);
  const sibling = { ...f, repo: other, runtime: join(f.root, "other-runtime") }, listener = await service(sibling); init(sibling, "sibling"); register(sibling, listener, "sibling");
  const decision = JSON.parse(cli(f, "classify-port", ["--port", String(listener.port)]).stdout)[0];
  expect(decision.ownership_decision).toBe("OTHER_WORKTREE_ACTIVE_SESSION"); expect(decision.candidate_repository).toBe(other);
  expect(decision.candidate_common).toBe(join(f.repo, ".git")); expect(decision.candidate_branch).toBe("task");
  expect(decision.candidate_commit).toBe(git(other, "rev-parse", "--short=12", "HEAD")); expect(decision.service).toBe("backend");
  expect(cli(f, "cleanup-port", ["--port", String(listener.port)]).code).toBe(3);
  expect(cli(f, "finalize-session", ["--session", "sibling"]).code).toBe(0); expect(existsSync(join(f.shared, "sibling"))).toBe(true);
  expect(cli(f, "stop", ["--all"]).code).toBe(0); expect(alive(listener.child.pid)).toBe(true);
});
test("partial state, optional-repo mark, ownership and database-path safeguards", () => {
  const f = fixture();
  const absent = Bun.spawnSync([process.execPath, helper, "mark", "--runtime", f.runtime, "--session", "absent", "--status", "stopped"]);
  expect(absent.exitCode).toBe(0);
  const dir = join(f.runtime, "sessions/partial"); write(join(dir, "ownership.json"), { application: "OperatorOS", session_id: "partial" });
  expect(cli(f, "finalize-session", ["--session", "partial"]).code).toBe(0); expect(existsSync(dir)).toBe(true);
  write(join(dir, "session.json"), { session_id: "partial", database_path: join(dir, "db.sqlite") }); write(join(dir, "db.sqlite"), "sentinel");
  expect(cli(f, "finalize-session", ["--session", "partial"]).stderr).toBe("SESSION_DATABASE_OWNERSHIP_FORBIDDEN");
  expect(readFileSync(join(dir, "db.sqlite"), "utf8")).toBe("sentinel");
  expect(cli(f, "finalize-session", ["--session", "../escape"]).code).toBe(2);
  const target = join(f.root, "external"); mkdirSync(target); symlinkSync(target, join(f.runtime, "sessions/alias"));
  expect(cli(f, "finalize-session", ["--session", "alias"]).stderr).toBe("SESSION_PATH_ESCAPE_REJECTED"); expect(existsSync(target)).toBe(true);
});
test("removed checkout registry metadata is pruned without signaling a live PID", async () => {
  const f = fixture(), listener = await service(f);
  const dir = join(f.shared, "removed"); write(join(dir, "ownership.json"), { application: "OperatorOS", session_id: "removed" });
  write(join(dir, "session.json"), { session_id: "removed", worktreePath: join(f.root, "removed-checkout") });
  write(join(dir, "backend.pid"), { pid: listener.child.pid, role: "backend", start_ticks: ticks(listener.child.pid) });
  expect(cli(f, "status").code).toBe(0); expect(existsSync(dir)).toBe(false); expect(alive(listener.child.pid)).toBe(true);
});
test("owned shutdown uses one deadline for two groups and terminates descendants", async () => {
  const f = fixture(), descendant = join(f.root, "descendant.pid");
  const script = `process.on("SIGINT", () => {}); process.on("SIGTERM", () => {});
const child = Bun.spawn([process.execPath, "-e", 'process.on("SIGINT",()=>{});process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdout: "ignore", stderr: "ignore" });
await Bun.write(${JSON.stringify(descendant)}, String(child.pid));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("synthetic") }); console.log(server.port);`;
  write(join(f.repo, "apps/api/src/server.ts"), script);
  const backend = await service(f), frontend = await service(f, "frontend"); init(f); register(f, backend); register(f, frontend);
  const started = performance.now(), result = cli(f, "stop-owned-session", ["--session", "fixture", "--timeout", "1.5"]);
  expect(result.code).toBe(0); expect(performance.now() - started).toBeLessThan(3500);
  expect(JSON.parse(result.stdout.split("\n").at(-1)!)).toEqual({ session: "fixture", owned_groups: 2, remaining_groups: 0, deadline_seconds: 1.5 });
  await backend.child.exited; await frontend.child.exited;
  expect(alive(Number(readFileSync(descendant, "utf8")))).toBe(false);
});
test("fallback cleanup accepts owned entrypoints and refuses foreign process identities", async () => {
  const f = fixture(), listener = await service(f); init(f);
  const foreign = Bun.spawn(["setsid", "sleep", "120"], { cwd: f.root, env, stdout: "ignore", stderr: "ignore" }); children.push(foreign);
  const result = cli(f, "stop-owned-session", ["--session", "fixture", "--backend-pid", String(foreign.pid), "--timeout", "1"]);
  expect(JSON.parse(result.stdout).owned_groups).toBe(0); expect(alive(foreign.pid)).toBe(true);
  const owned = cli(f, "stop-owned-session", ["--session", "fixture", "--backend-pid", String(listener.child.pid), "--timeout", "1"]);
  expect(JSON.parse(owned.stdout.split("\n").at(-1)!).owned_groups).toBe(1); await listener.child.exited;
});
test.each(["backend", "frontend"])("%s discovery distinguishes current, linked, and independent checkouts", async role => {
  const f = fixture(), other = fixture(), linked = join(f.root, "linked checkout"); git(f.repo, "worktree", "add", "-b", "linked", linked);
  for (const [repo, expected] of [[f.repo, "OPERATOROS_CURRENT_CHECKOUT"], [linked, "OPERATOROS_OTHER_WORKTREE"], [other.repo, "OPERATOROS_OTHER_CHECKOUT"]]) {
    const listener = await service({ ...f, repo: repo! }, role);
    const decision = JSON.parse(cli(f, "classify-port", ["--port", String(listener.port)]).stdout)[0];
    expect(decision.ownership_decision).toBe(expected); expect(decision.role).toBe(role); expect(decision.candidate_repository).toBe(repo);
    expect(cli(f, "cleanup-port", ["--port", String(listener.port)]).code).toBe(3); expect(alive(listener.child.pid)).toBe(true);
  }
});
function launcherFixture() {
  const f = fixture();
  for (const path of ["start-dev.sh", "scripts/operatoros-dev-runtime.ts"]) write(join(f.repo, path), readFileSync(join(repository, path), "utf8"));
  for (const [path, source] of [["package.json", "{}"], ["bun.lock", "fixture"], ["mise.toml", "[tools]\n"]]) write(join(f.repo, path!), source!);
  git(f.repo, "add", "start-dev.sh", "scripts", "package.json", "bun.lock", "mise.toml"); git(f.repo, "commit", "-qm", "launcher");
  const origin = join(f.root, "origin.git"); git(f.root, "init", "--bare", origin); git(f.repo, "remote", "add", "origin", origin); git(f.repo, "push", "-u", "origin", "main");
  return { ...f, origin };
}
function remoteUpdate(f: ReturnType<typeof launcherFixture>) {
  const peer = join(f.root, "peer"); git(f.root, "clone", "--branch", "main", f.origin, peer);
  git(peer, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "--allow-empty", "-qm", "remote update"); git(peer, "push", "origin", "main");
}
function launcher(f: Fixture, primary = f.repo, args: string[] = [], extraEnv = {}) {
  const result = Bun.spawnSync(["bash", join(f.repo, "start-dev.sh"), "--check", ...args], { cwd: f.repo, env: { ...env, OPERATOROS_PRIMARY_CHECKOUT_PATH: primary, OPERATOROS_RUNTIME_DIR: f.runtime, OPERATOROS_DATA_DIR: dirname(f.data), ...extraEnv }, stdout: "pipe", stderr: "pipe", timeout: 45_000 });
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}
function preparedLauncherFixture() {
  const f = fixture();
  for (const path of ["start-dev.sh", "scripts/operatoros-dev-runtime.ts", "scripts/validate-wsl-bun.sh"]) write(join(f.repo, path), readFileSync(join(repository, path), "utf8"));
  write(join(f.repo, "package.json"), "{}"); write(join(f.repo, "bun.lock"), "fixture"); write(join(f.repo, "mise.toml"), `[tools]\nbun = "${Bun.version}"\n`);
  symlinkSync(join(repository, "packages"), join(f.repo, "packages"));
  for (const app of ["api", "web"]) symlinkSync(join(repository, `apps/${app}/node_modules`), join(f.repo, `apps/${app}/node_modules`));
  return f;
}
test("primary freshness proceeds when current and fast-forwards only a clean behind checkout", () => {
  const f = launcherFixture(), current = launcher(f); expect(current.code).toBe(2);
  expect(current.output).toContain("Checking environment..."); expect(current.output).toContain("Worktree role PRIMARY");
  const before = git(f.repo, "rev-parse", "HEAD"); remoteUpdate(f);
  const behind = launcher(f); expect(behind.code).toBe(2); expect(behind.output).toContain("Freshness   FAST_FORWARDED");
  expect(git(f.repo, "rev-parse", "HEAD")).not.toBe(before); expect(git(f.repo, "rev-parse", "HEAD")).toBe(git(f.repo, "rev-parse", "origin/main"));
});
test("dirty behind and diverged primary checkouts preserve local work", () => {
  const f = launcherFixture(); remoteUpdate(f); write(join(f.repo, "local.txt"), "keep"); const before = git(f.repo, "rev-parse", "HEAD");
  const dirty = launcher(f); expect(dirty.code).toBe(2); expect(dirty.output).toContain("PRIMARY_CHECKOUT_BEHIND_AND_DIRTY"); expect(dirty.output).toContain("local.txt");
  expect(git(f.repo, "rev-parse", "HEAD")).toBe(before);
  git(f.repo, "add", "local.txt"); git(f.repo, "commit", "-qm", "local only"); const local = git(f.repo, "rev-parse", "HEAD");
  const diverged = launcher(f); expect(diverged.code).toBe(2); expect(diverged.output).toContain("PRIMARY_CHECKOUT_DIVERGED"); expect(diverged.output).toContain("local only");
  expect(diverged.output).not.toContain("git reset"); expect(diverged.output).not.toContain("force-push"); expect(git(f.repo, "rev-parse", "HEAD")).toBe(local);
});
test("secondary is exempt from freshness; detached primary refuses without switching branches", () => {
  const f = launcherFixture(), other = join(f.root, "secondary"); git(f.repo, "worktree", "add", "-b", "task", other);
  const secondary = launcher({ ...f, repo: other }, f.repo); expect(secondary.code).toBe(2); expect(secondary.output).toContain("Worktree role SECONDARY"); expect(secondary.output).toContain("Freshness   N/A (secondary)");
  git(f.repo, "checkout", "--detach", "HEAD"); const detached = launcher(f); expect(detached.code).toBe(2);
  expect(detached.output).toContain("PRIMARY_CHECKOUT_UNEXPECTED_BRANCH"); expect(detached.output).toContain("No branch switch was attempted");
});
test("banner is sanitized and never opens a protected-looking synthetic file", () => {
  const f = launcherFixture(); write(join(f.repo, "backend/attendance.db"), "synthetic sentinel");
  const path = join(f.repo, "backend/attendance.db"), before = Bun.spawnSync(["stat", "-c", "%X:%Y:%s", path]).stdout.toString();
  const result = launcher(f); expect(result.output).toContain("Status      dirty");
  expect(result.output.indexOf("Repository")).toBeLessThan(result.output.indexOf("Checking environment"));
  expect(Bun.spawnSync(["stat", "-c", "%X:%Y:%s", path]).stdout.toString()).toBe(before);
});
test("prepared launcher reports foreign listeners without exposing secrets or signaling", async () => {
  const f = preparedLauncherFixture(), server = createServer();
  const port = await new Promise<number>((done) => server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port)));
  try {
    for (const args of [[], ["--verbose"], ["--no-clean-stale"]]) {
      const result = launcher(f, join(f.root, "primary"), args, { FRONTEND_PORT: String(port), BACKEND_PORT: String(port), DATABASE_URL: "postgres://user:never-print-this@invalid/db" });
      expect(result.code).toBe(2); expect(result.output).toContain("non-OperatorOS process"); expect(result.output).toContain(`PID: ${process.pid}`);
      expect(result.output).not.toContain("never-print-this"); expect(result.output.includes('"ownership_decision"')).toBe(args.includes("--verbose"));
    }
  } finally { server.close(); }
});
test("prepared launcher refuses legacy preflight without attempting session finalization", () => {
  const f = preparedLauncherFixture(); write(join(dirname(f.data), "operatoros-development.db"), "synthetic invalid database");
  const result = launcher(f, join(f.root, "primary"), ["--auto-port"], { ASTRYX_DEV_PREPARE_ONLY: "1" });
  expect(result.code).toBe(2); expect(result.output).toContain("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION");
  expect(result.output.split("No OperatorOS services were started.").length - 1).toBe(1);
  expect(result.output).not.toContain("Traceback"); expect(result.output).not.toContain("FileNotFoundError");
});
test("auto-port check creates only disposable data and reports selected ports", async () => {
  const f = preparedLauncherFixture(), servers = [createServer(), createServer()];
  const frontend = Number(cli(f, "allocate", ["--preferred", "5173", "--maximum", "5198", "--auto"]).stdout);
  const backend = Number(cli(f, "allocate", ["--preferred", "8000", "--maximum", "8098", "--auto"]).stdout);
  try {
    for (const [index, port] of [frontend, backend].entries()) await new Promise<void>((done, reject) => { servers[index]!.once("error", reject); servers[index]!.listen(port, "127.0.0.1", done); });
    const result = launcher(f, join(f.root, "primary"), ["--auto-port"], { FRONTEND_PORT: String(frontend), BACKEND_PORT: String(backend) });
    expect(result.code).toBe(0); expect(result.output).toContain("Requested ports are occupied."); expect(result.output).toContain("Selected:");
    expect(result.output).toContain(`Data root   ${dirname(f.data)}`); expect(existsSync(f.data)).toBe(true);
    expect(result.output).not.toContain('"ownership_decision"');
  } finally { for (const server of servers) server.close(); }
});
