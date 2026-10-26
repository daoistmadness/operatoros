import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { matchingService, parseTailnetOrigin, type ProcessInfo } from "../operatoros-dev-runtime";

const helper = resolve(import.meta.dir, "../operatoros-dev-runtime.ts"), roots: string[] = [], children: Bun.Subprocess[] = [];
const repository = resolve(import.meta.dir, "../..");
const env = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete env[key];
delete env.DATABASE_URL; delete env.PROTECTED_DB_PATH;
for (const key of ["HOST", "PORT", "FRONTEND_HOST", "BACKEND_HOST", "ALLOWED_ORIGINS", "COOKIE_SECURE", "TRUSTED_PROXY_ADDRESSES", "VITE_TAILNET_HOST", "VITE_HMR_HOST", "VITE_HMR_PROTOCOL", "VITE_HMR_CLIENT_PORT", "VITE_API_BASE_URL", "DEV_API_PROXY_TARGET", "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "OPERATOROS_DISABLE_ENV_FILES", "AUTH_COOKIE_SECRET"]) delete env[key];
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
test("non-Git runtime actions do not invoke Git", () => {
  const f = fixture(), bin = join(f.root, "bin"), marker = join(f.root, "git-called");
  mkdirSync(bin);
  const fakeGit = join(bin, "git");
  write(fakeGit, '#!/bin/sh\nprintf called >> "$GIT_CALL_LOG"\n');
  chmodSync(fakeGit, 0o755);
  const result = cli(f, "random-secret", [], { PATH: `${bin}:${env.PATH}`, GIT_CALL_LOG: marker });
  expect(result.code).toBe(0);
  expect(existsSync(marker)).toBe(false);
});
test("tailnet origins accept only exact HTTPS ts.net origins and default to port 8443", () => {
  expect(parseTailnetOrigin("https://node.tailnet.ts.net")).toEqual({ origin: "https://node.tailnet.ts.net:8443", hostname: "node.tailnet.ts.net", port: 8443 });
  expect(parseTailnetOrigin("https://Node.tailnet.ts.net:8444")).toEqual({ origin: "https://node.tailnet.ts.net:8444", hostname: "node.tailnet.ts.net", port: 8444 });
  expect(parseTailnetOrigin("https://node.tailnet.ts.net:443").origin).toBe("https://node.tailnet.ts.net");
  for (const origin of ["http://node.tailnet.ts.net", "https://attacker.example", "https://node.tailnet.ts.net/", "https://node.tailnet.ts.net/path", "https://node.tailnet.ts.net?x=1", "https://node.tailnet.ts.net#fragment", "https://user@node.tailnet.ts.net", "https://*.tailnet.ts.net", "https://127.0.0.1", "https://node.tailnet.ts.net:0", "https://node.tailnet.ts.net:65536"]) {
    expect(() => parseTailnetOrigin(origin)).toThrow("TAILNET_ORIGIN_INVALID");
  }
});
test("Tailnet Serve and Funnel status validates one complete private HTTPS endpoint", () => {
  const f = fixture(), bin = join(f.root, "bin"), tailscale = join(bin, "tailscale");
  mkdirSync(bin);
  write(tailscale, `#!/bin/sh
if [ "$1" = status ] && [ "$2" = --json ]; then printf '%s' '{"Self":{"DNSName":"node.tailnet.ts.net.","Online":true}}'; exit 0; fi
if [ "$1" = serve ] && [ "$2" = status ] && [ "$3" = --json ]; then printf '%s' "$SERVE_STATUS"; exit 0; fi
if [ "$1" = funnel ] && [ "$2" = status ] && [ "$3" = --json ]; then printf '%s' "$FUNNEL_STATUS"; exit 0; fi
exit 1
`);
  chmodSync(tailscale, 0o755);
  const args = ["--host", "node.tailnet.ts.net", "--https-port", "8444", "--frontend-port", "5173"];
  const endpoint = "node.tailnet.ts.net:8444";
  const privateStatus = {
    TCP: { "8444": { HTTPS: true } },
    Web: { [endpoint]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } } },
  };
  const run = (serveStatus: unknown = privateStatus, funnelStatus: unknown = privateStatus) => cli(f, "verify-tailnet-serve", args, {
    PATH: `${bin}:${env.PATH}`,
    SERVE_STATUS: JSON.stringify(serveStatus),
    FUNNEL_STATUS: JSON.stringify(funnelStatus),
  });

  expect(run().code).toBe(0);
  expect(run(privateStatus, { ...privateStatus, AllowFunnel: { [endpoint]: false } }).code).toBe(0);
  expect(run(privateStatus, { ...privateStatus, AllowFunnel: { "node.tailnet.ts.net:8443": true } }).code).toBe(0);

  const enabled = run(privateStatus, { ...privateStatus, AllowFunnel: { [endpoint]: true } });
  expect(enabled.code).toBe(2);
  expect(enabled.stderr).toContain("TAILNET_FUNNEL_NOT_ALLOWED");
  expect(run({ ...privateStatus, AllowFunnel: { [endpoint]: true } }).stderr).toContain("TAILNET_FUNNEL_NOT_ALLOWED");

  const foreground = run(privateStatus, {
    ...privateStatus,
    Foreground: { session: { AllowFunnel: { [endpoint]: true } } },
  });
  expect(foreground.code).toBe(2);
  expect(foreground.stderr).toContain("TAILNET_FUNNEL_NOT_ALLOWED");

  const incomplete = run(privateStatus, { Web: privateStatus.Web });
  expect(incomplete.code).toBe(2);
  expect(incomplete.stderr).toContain("TAILSCALE_FUNNEL_STATUS_INCOMPLETE");

  const ambiguous = run(privateStatus, { ...privateStatus, AllowFunnel: true });
  expect(ambiguous.code).toBe(2);
  expect(ambiguous.stderr).toContain("TAILSCALE_FUNNEL_STATUS_INCOMPLETE");

  const mismatch = run({
    ...privateStatus,
    Web: { [endpoint]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5174" } } } },
  });
  expect(mismatch.code).toBe(2);
  expect(mismatch.stderr).toContain("TAILSCALE_SERVE_TARGET_MISMATCH");
  expect(mismatch.stderr).toContain("http://127.0.0.1:5173");
  expect(mismatch.stderr).not.toContain("http://127.0.0.1:5174");
});
test("Bun validation and launcher preparation use mise's selected executable", () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-bun-resolution-test-")); roots.push(root);
  const repo = join(root, "repo"), staleBin = join(root, "stale"), selectedBin = join(root, "selected"), tools = join(root, "tools");
  mkdirSync(repo); mkdirSync(staleBin); mkdirSync(selectedBin); mkdirSync(tools); write(join(repo, "bun.lock"), "synthetic");
  writeFileSync(join(staleBin, "bun"), "#!/bin/sh\nprintf '%s\\n' '1.4.3'\n"); chmodSync(join(staleBin, "bun"), 0o755);
  symlinkSync(realpathSync(process.execPath), join(selectedBin, "bun"));
  const mise = join(tools, "mise");
  writeFileSync(mise, '#!/bin/sh\nprintf "%s\\n" "$SYNTHETIC_MISE_BUN"\n'); chmodSync(mise, 0o755);
  const command = [
    'source "$1"',
    'operatoros_wsl_prepare_bun "$2"',
    'printf "reported=%s\\n" "$OPERATOROS_BUN_VERSION"',
    'printf "selected=%s\\n" "$(command -v bun)"',
    'printf "version=%s\\n" "$(bun --version)"',
  ].join("\n");
  const result = Bun.spawnSync(["bash", "-c", command, "validation-test", join(repository, "scripts/validate-wsl-bun.sh"), repo], {
    cwd: repo,
    env: { ...env, PATH: `${staleBin}:${tools}:${env.PATH}`, SYNTHETIC_MISE_BUN: join(selectedBin, "bun") },
    stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("reported=1.4.4");
  expect(result.stdout.toString()).toContain(`selected=${realpathSync(join(selectedBin, "bun"))}`);
  expect(result.stdout.toString()).toContain("version=1.4.4");
});
test("native Bun validation rejects a version other than the mise pin", () => {
  const root = mkdtempSync(join(tmpdir(), "operatoros-bun-version-test-")); roots.push(root);
  const repo = join(root, "repo"), bin = join(root, "bin"), bun = join(bin, "bun"), mise = join(bin, "mise");
  mkdirSync(repo); mkdirSync(bin); write(join(repo, "bun.lock"), "synthetic");
  write(bun, "#!/bin/sh\nprintf '%s\\n' '1.4.3'\n"); chmodSync(bun, 0o755);
  write(mise, `#!/bin/sh\nprintf '%s\\n' '${bun}'\n`); chmodSync(mise, 0o755);
  write(join(bin, "file"), "#!/bin/sh\nprintf '%s\\n' 'ELF 64-bit LSB pie executable, x86-64'\n"); chmodSync(join(bin, "file"), 0o755);
  const result = Bun.spawnSync(["bash", "-c", 'source "$1"; operatoros_wsl_validate_bun "$2"; printf "%s|%s\\n" "$OPERATOROS_WSL_TOOLCHAIN_STATE" "$OPERATOROS_WSL_TOOLCHAIN_REASON"', "validation-test", join(repository, "scripts/validate-wsl-bun.sh"), repo], {
    cwd: repo, env: { ...env, PATH: `${bin}:${env.PATH}` }, stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("SAFE_WRONG_VERSION|Bun version must be exactly 1.4.4; detected 1.4.3");
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
  for (const path of ["start-dev.sh", "scripts/operatoros-dev-runtime.ts", "scripts/validate-wsl-bun.sh"]) write(join(f.repo, path), readFileSync(join(repository, path), "utf8"));
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
test("managed launcher starts effective loopback and Tailnet configs despite hostile shell and env files", async () => {
  const f = preparedLauncherFixture(); roots.push(f.root);
  rmSync(join(f.repo, "apps/web/vite.js"), { force: true });
  const frontendPort = Number(cli(f, "allocate", ["--host", "127.0.0.1", "--preferred", "5173", "--maximum", "5199", "--auto"]).stdout);
  const backendPort = Number(cli(f, "allocate", ["--host", "127.0.0.1", "--preferred", "8000", "--maximum", "8099", "--auto"]).stdout);
  const apiConfigPath = join(f.root, "effective-api.json"), viteConfigPath = join(f.root, "effective-vite.json");
  const apiConfigKeys = ["HOST", "PORT", "FRONTEND_HOST", "BACKEND_HOST", "COOKIE_SECURE", "ALLOWED_ORIGINS", "TRUSTED_PROXY_ADDRESSES", "DATABASE_URL", "DEV_API_PROXY_TARGET", "VITE_API_BASE_URL", "VITE_TAILNET_HOST", "VITE_HMR_HOST", "VITE_HMR_PROTOCOL", "VITE_HMR_CLIENT_PORT", "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "OPERATOROS_DISABLE_ENV_FILES", "NODE_ENV"];
  const frontendConfig = readFileSync(join(repository, "apps/web/vite.config.js"), "utf8");
  const pluginMarker = "plugins: [tailwindcss(), react()],";
  expect(frontendConfig).toContain(pluginMarker);
  const capturePlugin = `plugins: [tailwindcss(), react(), { name: 'capture-effective-test-config', configResolved(config) { writeFileSync(process.env.TEST_VITE_CONFIG, JSON.stringify({ host: config.server.host, port: config.server.port, ws: { host: config.server.ws.host, port: config.server.ws.port, protocol: config.server.ws.protocol, clientPort: config.server.ws.clientPort }, allowedHosts: config.server.allowedHosts, proxy: Object.fromEntries(['/api', '/health', '/ready', '/openapi'].map((route) => [route, config.server.proxy[route].target])), envDir: config.envDir, apiBaseUrl: config.env.VITE_API_BASE_URL ?? null })); } }],`;
  const viteFixtureConfig = frontendConfig.replace(pluginMarker, capturePlugin).replace(
    "envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,",
    "envDir: process.env.OPERATOROS_DISABLE_ENV_FILES === 'true' ? false : undefined,\n  cacheDir: process.env.TEST_VITE_CACHE_DIR,",
  );
  write(join(f.repo, "apps/web/vite.config.js"), `import { writeFileSync } from 'node:fs';\n${viteFixtureConfig}`);
  write(join(f.repo, "apps/web/index.html"), "<html><body><div id=\"app\"></div><script type=\"module\" src=\"/src/main.js\"></script></body></html>");
  write(join(f.repo, "apps/web/src/main.js"), "document.querySelector('#app').textContent = 'synthetic dev config';");
  write(join(f.repo, "apps/web/.env"), [
    "FRONTEND_HOST=0.0.0.0", "VITE_TAILNET_HOST=attacker.example.ts.net", "VITE_HMR_HOST=attacker.example",
    "VITE_HMR_PROTOCOL=wss", "VITE_HMR_CLIENT_PORT=8443", "VITE_API_BASE_URL=https://attacker.example/api",
    "DEV_API_PROXY_TARGET=http://127.0.0.1:1", "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=*", "ALLOWED_ORIGINS=*", "COOKIE_SECURE=true",
  ].join("\n"));
  write(join(f.repo, "apps/api/.env"), [
    "HOST=0.0.0.0", "PORT=1", "ALLOWED_ORIGINS=*", "COOKIE_SECURE=true", "TRUSTED_PROXY_ADDRESSES=127.0.0.1",
    "DATABASE_URL=sqlite:///untrusted/operatoros.sqlite",
  ].join("\n"));
  write(join(f.repo, "apps/api/src/server.ts"), `
const names = ${JSON.stringify(apiConfigKeys)};
const hostname = process.env.HOST;
const port = Number(process.env.PORT);
const server = Bun.serve({ hostname, port, fetch: (request) => new Response(JSON.stringify({ hostname, port, path: new URL(request.url).pathname }), { headers: { 'content-type': 'application/json' } }) });
const values = Object.fromEntries(names.map((name) => [name, process.env[name] ?? '']));
await Bun.write(process.env.TEST_API_CONFIG, JSON.stringify({ ...values, listener: { hostname: server.hostname, port: server.port } }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.stop(true); process.exit(0); });
`);

  const tailnetHost = "node.tailnet.ts.net", tailnetPort = 8444;
  const fakeBin = join(f.root, "fake-bin"), tailscale = join(fakeBin, "tailscale"); mkdirSync(fakeBin);
  const status = JSON.stringify({ TCP: { [tailnetPort]: { HTTPS: true } }, Web: { [`${tailnetHost}:${tailnetPort}`]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${frontendPort}` } } } } });
  write(tailscale, `#!/bin/sh\nif [ "$1" = status ] && [ "$2" = --json ]; then printf '%s' '{"Self":{"DNSName":"${tailnetHost}.","Online":true}}'; exit 0; fi\nif [ "$2" = status ] && [ "$3" = --json ]; then printf '%s' '${status}'; exit 0; fi\nexit 1\n`);
  chmodSync(tailscale, 0o755);

  const stackChildren: Bun.Subprocess[] = [], outputByChild = new Map<Bun.Subprocess, Promise<[string, string]>>();
  async function start(args: string[], extra: Record<string, string>) {
    rmSync(apiConfigPath, { force: true }); rmSync(viteConfigPath, { force: true });
    const child = Bun.spawn(["bash", join(f.repo, "start-dev.sh"), ...args], {
      cwd: f.repo,
      env: {
        ...env,
        OPERATOROS_PRIMARY_CHECKOUT_PATH: join(f.root, "primary"),
        OPERATOROS_RUNTIME_DIR: f.runtime,
        OPERATOROS_DATA_DIR: dirname(f.data),
        FRONTEND_PORT: String(frontendPort), BACKEND_PORT: String(backendPort),
        ASTRYX_READINESS_TIMEOUT_SECONDS: "15",
        TEST_API_CONFIG: apiConfigPath, TEST_VITE_CONFIG: viteConfigPath, TEST_VITE_CACHE_DIR: join(f.root, "vite-cache"),
        HOST: "127.0.0.1", PORT: "4999", FRONTEND_HOST: "127.0.0.1", BACKEND_HOST: "127.0.0.1",
        ...extra,
      }, stdout: "pipe", stderr: "pipe",
    });
    stackChildren.push(child); children.push(child);
    const output = Promise.all([child.stdout!.text(), child.stderr!.text()]); outputByChild.set(child, output);
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) {
        const [stdout, stderr] = await output;
        throw new Error(`launcher exited ${child.exitCode}: ${stdout}\n${stderr}`);
      }
      if (existsSync(apiConfigPath) && existsSync(viteConfigPath)) {
        try {
          const response = await fetch(`http://127.0.0.1:${frontendPort}/health`);
          if (response.ok) return { child, api: json(apiConfigPath), vite: json(viteConfigPath) };
        } catch { /* Wait for Vite's listener and same-origin proxy readiness. */ }
      }
      await Bun.sleep(100);
    }
    const backendLog = existsSync(join(f.runtime, "backend.log")) ? readFileSync(join(f.runtime, "backend.log"), "utf8") : "";
    const frontendLog = existsSync(join(f.runtime, "frontend.log")) ? readFileSync(join(f.runtime, "frontend.log"), "utf8") : "";
    await stop(child);
    const [stdout, stderr] = await output;
    throw new Error(`managed development stack did not publish effective config and proxy readiness\n${stdout}\n${stderr}\nAPI log:\n${backendLog}\nVite log:\n${frontendLog}`);
  }
  async function stop(child: Bun.Subprocess) {
    if (child.exitCode === null) child.kill("SIGINT");
    await child.exited;
    await outputByChild.get(child);
  }

  try {
    const local = await start([], {
      OPERATOROS_DISABLE_ENV_FILES: "false",
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "*",
      VITE_TAILNET_HOST: "attacker.example.ts.net", VITE_HMR_HOST: "attacker.example",
      VITE_HMR_PROTOCOL: "wss", VITE_HMR_CLIENT_PORT: "8443", VITE_API_BASE_URL: "",
      DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
      TRUSTED_PROXY_ADDRESSES: "127.0.0.1",
    });
    expect(local.api.listener).toEqual({ hostname: "127.0.0.1", port: backendPort });
    expect(local.api.HOST).toBe("127.0.0.1"); expect(local.api.PORT).toBe(String(backendPort));
    expect(local.api.FRONTEND_HOST).toBe("127.0.0.1"); expect(local.api.BACKEND_HOST).toBe("127.0.0.1");
    expect(local.api.COOKIE_SECURE).toBe("false");
    expect(local.api.ALLOWED_ORIGINS).toBe(`http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`);
    expect(local.api.TRUSTED_PROXY_ADDRESSES).toBe("");
    expect(local.api.DATABASE_URL).toBe(`sqlite:///${f.data}`);
    expect(local.api.VITE_API_BASE_URL).toBe(""); expect(local.api.VITE_TAILNET_HOST).toBe("");
    expect(local.api.VITE_HMR_HOST).toBe("127.0.0.1"); expect(local.api.VITE_HMR_PROTOCOL).toBe("ws");
    expect(local.api.VITE_HMR_CLIENT_PORT).toBe(String(frontendPort));
    expect(local.api.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe("");
    expect(local.api.OPERATOROS_DISABLE_ENV_FILES).toBe("true"); expect(local.api.NODE_ENV).toBe("development");
    expect(local.vite).toMatchObject({ host: "127.0.0.1", port: frontendPort, ws: { host: "127.0.0.1", port: frontendPort, protocol: "ws", clientPort: frontendPort }, envDir: false });
    expect(local.vite.allowedHosts).not.toBe(true); expect(local.vite.allowedHosts).not.toContain("attacker.example.ts.net");
    expect(Object.values(local.vite.proxy)).toEqual(Array(4).fill(`http://127.0.0.1:${backendPort}`));
    expect(local.vite.apiBaseUrl).toBe("");
    expect((await fetch(`http://127.0.0.1:${frontendPort}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${frontendPort}/`, { headers: { host: "attacker.example" } })).status).toBe(403);
    await stop(local.child);

    const tailnetOrigin = `https://${tailnetHost}:${tailnetPort}`;
    const tailnet = await start(["--tailnet-origin", tailnetOrigin], {
      PATH: `${fakeBin}:${env.PATH}`, OPERATOROS_DISABLE_ENV_FILES: "true",
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "*", VITE_TAILNET_HOST: tailnetHost,
      VITE_HMR_HOST: tailnetHost, VITE_HMR_PROTOCOL: "wss", VITE_HMR_CLIENT_PORT: String(tailnetPort),
      VITE_API_BASE_URL: "", DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
      COOKIE_SECURE: "true", ALLOWED_ORIGINS: tailnetOrigin,
      TRUSTED_PROXY_ADDRESSES: "0.0.0.0",
    });
    expect(tailnet.api.listener).toEqual({ hostname: "127.0.0.1", port: backendPort });
    expect(tailnet.api.COOKIE_SECURE).toBe("true"); expect(tailnet.api.ALLOWED_ORIGINS).toBe(tailnetOrigin);
    expect(tailnet.api.TRUSTED_PROXY_ADDRESSES).toBe("");
    expect(tailnet.vite).toMatchObject({ host: "127.0.0.1", port: frontendPort, ws: { host: tailnetHost, port: frontendPort, protocol: "wss", clientPort: tailnetPort }, envDir: false });
    expect(tailnet.vite.allowedHosts).toContain(tailnetHost);
    expect([...new Set(tailnet.vite.allowedHosts)].sort()).toEqual(["127.0.0.1", tailnetHost].sort());
    expect(Object.values(tailnet.vite.proxy)).toEqual(Array(4).fill(`http://127.0.0.1:${backendPort}`));
    expect((await fetch(`http://127.0.0.1:${frontendPort}/health`, { headers: { host: tailnetHost } })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${frontendPort}/`, { headers: { host: "attacker.example" } })).status).toBe(403);
    await stop(tailnet.child);

    const localAgain = await start([], {
      OPERATOROS_DISABLE_ENV_FILES: "false", VITE_TAILNET_HOST: tailnetHost,
      VITE_HMR_HOST: tailnetHost, VITE_HMR_PROTOCOL: "wss", VITE_HMR_CLIENT_PORT: String(tailnetPort),
      VITE_API_BASE_URL: "", DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
    });
    expect(localAgain.api.COOKIE_SECURE).toBe("false");
    expect(localAgain.api.ALLOWED_ORIGINS).toBe(`http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`);
    expect(localAgain.vite).toMatchObject({ host: "127.0.0.1", ws: { host: "127.0.0.1", protocol: "ws", clientPort: frontendPort }, envDir: false });
    expect(localAgain.vite.allowedHosts).not.toContain(tailnetHost);
    await stop(localAgain.child);
  } finally {
    for (const child of stackChildren.reverse()) await stop(child);
  }
}, 120_000);
test("primary freshness proceeds when current and refuses a clean behind checkout without moving HEAD", () => {
  const f = launcherFixture(), current = launcher(f); expect(current.code).toBe(2);
  expect(current.output).toContain("Checking environment..."); expect(current.output).toContain("Worktree role PRIMARY");
  const before = git(f.repo, "rev-parse", "HEAD"); remoteUpdate(f);
  const behind = launcher(f); expect(behind.code).toBe(2); expect(behind.output).toContain("PRIMARY_CHECKOUT_BEHIND_ORIGIN");
  expect(behind.output).toContain("git pull --ff-only");
  expect(git(f.repo, "rev-parse", "HEAD")).toBe(before); expect(git(f.repo, "rev-parse", "HEAD")).not.toBe(git(f.repo, "rev-parse", "origin/main"));
});
test("primary freshness updates only origin/main and preserves protected remote-tracking refs", () => {
  const f = launcherFixture();
  const protectedBranch = "wip/followups-api-preservation-20260728-013523";
  const localTrackingRef = `refs/remotes/origin/${protectedBranch}`;
  const remoteBranchRef = `refs/heads/${protectedBranch}`;
  const protectedBefore = git(f.repo, "rev-parse", "HEAD");
  git(f.origin, "update-ref", remoteBranchRef, protectedBefore);
  git(f.repo, "update-ref", localTrackingRef, protectedBefore);

  remoteUpdate(f);
  const remoteMain = git(f.origin, "rev-parse", "refs/heads/main");
  git(f.origin, "update-ref", remoteBranchRef, remoteMain);

  const behind = launcher(f);
  expect(behind.code).toBe(2);
  expect(behind.output).toContain("PRIMARY_CHECKOUT_BEHIND_ORIGIN");
  expect(git(f.repo, "rev-parse", "origin/main")).toBe(remoteMain);
  expect(git(f.repo, "rev-parse", localTrackingRef)).toBe(protectedBefore);
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
test("invalid Tailnet origins fail before checkout, session, or database work", () => {
  const f = preparedLauncherFixture();
  const result = launcher(f, join(f.root, "primary"), ["--tailnet-origin", "http://attacker.example"]);
  expect(result.code).toBe(2);
  expect(result.output).toContain("TAILNET_ORIGIN_INVALID");
  expect(result.output).not.toContain("Worktree role");
  expect(existsSync(f.data)).toBe(false);
  expect(existsSync(join(f.repo, ".git/operatoros-dev-sessions"))).toBe(false);
});
test.each(["FRONTEND_HOST", "BACKEND_HOST", "HOST"])("managed startup rejects inherited non-loopback %s", (name) => {
  const f = preparedLauncherFixture();
  const result = launcher(f, join(f.root, "primary"), [], { [name]: "0.0.0.0" });
  expect(result.code).toBe(2);
  expect(result.output).toContain("UNSAFE_DEVELOPMENT_BIND_HOST");
  expect(result.output).toContain(`${name} must be 127.0.0.1`);
  expect(existsSync(f.data)).toBe(false);
});
test.each(["BUN_OPTIONS", "ASTRYX_VITE_EXECUTABLE", "OPERATOROS_FRONTEND_DIR"])("managed startup rejects runtime or config-loader override %s", (name) => {
  const f = preparedLauncherFixture();
  const foreignFrontend = join(f.root, "foreign-frontend");
  mkdirSync(foreignFrontend);
  const values: Record<string, string> = name === "BUN_OPTIONS" ? { BUN_OPTIONS: "--env-file=/dev/null" }
    : name === "ASTRYX_VITE_EXECUTABLE" ? { ASTRYX_VITE_EXECUTABLE: "/dev/null" }
    : { OPERATOROS_FRONTEND_DIR: foreignFrontend };
  const diagnostic = name === "BUN_OPTIONS" ? "UNSAFE_BUN_OPTIONS"
    : name === "ASTRYX_VITE_EXECUTABLE" ? "UNSAFE_VITE_EXECUTABLE_OVERRIDE"
    : "UNSAFE_FRONTEND_DIRECTORY_OVERRIDE";
  const result = launcher(f, join(f.root, "primary"), [], values);
  expect(result.code).toBe(2);
  expect(result.output).toContain(diagnostic);
  expect(existsSync(f.data)).toBe(false);
});
test.each([
  ["wildcard ALLOWED_ORIGINS", { ALLOWED_ORIGINS: "*" }],
  ["foreign ALLOWED_ORIGINS", { ALLOWED_ORIGINS: "https://attacker.example" }],
  ["insecure local COOKIE_SECURE", { COOKIE_SECURE: "true" }],
  ["direct API base URL", { VITE_API_BASE_URL: "https://attacker.example/api" }],
  ["foreign API proxy target", { DEV_API_PROXY_TARGET: "http://attacker.example:9000" }],
])("managed startup rejects %s even when env-file loading is disabled", (label, values) => {
  const f = preparedLauncherFixture();
  const result = launcher(f, join(f.root, "primary"), ["--auto-port"], { OPERATOROS_DISABLE_ENV_FILES: "true", ...values });
  expect(result.code).toBe(2);
  const diagnostic = label.includes("COOKIE") ? "DEVELOPMENT_COOKIE_CONFIGURATION_MISMATCH"
    : label.includes("ORIGINS") ? "DEVELOPMENT_ORIGIN_CONFIGURATION_MISMATCH"
    : label.includes("API base") ? "DEVELOPMENT_API_BASE_URL_NOT_ALLOWED"
    : "DEVELOPMENT_API_PROXY_TARGET_MISMATCH";
  expect(result.output).toContain(diagnostic);
  expect(existsSync(f.data)).toBe(false);
});
test.each([
  ["foreign Tailnet Origin", { ALLOWED_ORIGINS: "https://attacker.example" }, "DEVELOPMENT_ORIGIN_CONFIGURATION_MISMATCH"],
  ["insecure Tailnet cookie", { COOKIE_SECURE: "false" }, "DEVELOPMENT_COOKIE_CONFIGURATION_MISMATCH"],
  ["foreign Tailnet host", { VITE_TAILNET_HOST: "attacker.tailnet.ts.net" }, "TAILNET_HOST_CONFIGURATION_MISMATCH"],
  ["foreign Tailnet HMR host", { VITE_HMR_HOST: "attacker.tailnet.ts.net" }, "TAILNET_HMR_CONFIGURATION_MISMATCH"],
  ["insecure Tailnet HMR protocol", { VITE_HMR_PROTOCOL: "ws" }, "TAILNET_HMR_CONFIGURATION_MISMATCH"],
  ["inconsistent Tailnet HMR port", { VITE_HMR_CLIENT_PORT: "8443" }, "TAILNET_HMR_CONFIGURATION_MISMATCH"],
])("managed Tailnet startup rejects %s", (label, values, diagnostic) => {
  const f = preparedLauncherFixture(), bin = join(f.root, "bin"), tailscale = join(bin, "tailscale");
  mkdirSync(bin);
  write(tailscale, "#!/bin/sh\nexit 1\n"); chmodSync(tailscale, 0o755);
  const result = launcher(f, join(f.root, "primary"), ["--auto-port", "--tailnet-origin", "https://node.tailnet.ts.net:8444"], {
    PATH: `${bin}:${env.PATH}`,
    ...values,
  });
  expect(result.code).toBe(2);
  expect(result.output).toContain(diagnostic);
  expect(existsSync(f.data)).toBe(false);
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
