import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

type Json = Record<string, any>;
type ProcessInfo = { pid: number; ppid: number; pgid: number; start_ticks: string; cwd: string; argv: string[]; uid: number; state: string };
type Decision = { pid?: number; pgid?: number; start_ticks?: string; port: number; ownership_decision: string; session_id?: string; role?: string; candidate_repository?: string };
const argv = process.argv.slice(2);
const action = argv.shift() ?? "";
const option = (name: string) => { const at = argv.indexOf(`--${name}`); return at < 0 ? undefined : argv[at + 1]; };
const flag = (name: string) => argv.includes(`--${name}`);
const required = (name: string) => { const value = option(name); if (!value || value.startsWith("--")) throw new Error(`MISSING_ARGUMENT:${name}`); return value; };
const number = (name: string) => { const value = Number(required(name)); if (!Number.isInteger(value) || value < 1) throw new Error(`INVALID_ARGUMENT:${name}`); return value; };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const contained = (path: string, root: string) => { const value = relative(root, path); return value === "" || (value !== ".." && !value.startsWith("../") && !isAbsolute(value)); };
const now = () => new Date().toISOString();

function command(parts: string[]): string | undefined {
  const result = Bun.spawnSync(parts, { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}
function git(repo: string, ...args: string[]): string | undefined { return command(["git", "-C", repo, ...args]); }
function commonDir(repo: string): string {
  const value = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!value) throw new Error("SESSION_REGISTRY_UNAVAILABLE");
  return resolve(value);
}
function primaryPath(): string {
  const configured = process.env.OPERATOROS_PRIMARY_CHECKOUT_PATH;
  const value = configured || join(homedir(), "code/repos/operatoros");
  if (!isAbsolute(value)) throw new Error("PRIMARY_CHECKOUT_CONFIGURATION_INVALID");
  return resolve(value);
}
function registry(repo: string): string { return join(commonDir(repo), "operatoros-dev-sessions"); }
function entry(repo: string, session: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) throw new Error("SESSION_PATH_ESCAPE_REJECTED");
  const root = registry(repo);
  const path = join(root, session);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("SESSION_REGISTRY_PATH_ESCAPE_REJECTED");
  return path;
}
function sessionDir(runtime: string, session: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) throw new Error("SESSION_PATH_ESCAPE_REJECTED");
  const path = join(runtime, "sessions", session);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("SESSION_PATH_ESCAPE_REJECTED");
  return path;
}
function json(path: string): Json | undefined { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } }
function atomicJson(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}`;
  try { writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
function processInfo(pid: number): ProcessInfo | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return {
      pid, state: fields[0]!, ppid: Number(fields[1]), pgid: Number(fields[2]), start_ticks: fields[19]!,
      cwd: realpathSync("/proc/" + pid + "/cwd"), argv: readFileSync("/proc/" + pid + "/cmdline").toString().replace(/\0$/, "").split("\0"),
      uid: statSync("/proc/" + pid).uid,
    };
  } catch { return undefined; }
}
function valid(record: Json | undefined, repo: string, role: string): ProcessInfo | undefined {
  if (!record || record.role !== role || !Number.isInteger(Number(record.pid))) return undefined;
  const info = processInfo(Number(record.pid));
  if (!info || info.state === "Z" || info.start_ticks !== String(record.start_ticks) || info.uid !== process.getuid?.()) return undefined;
  if (!contained(info.cwd, repo) && !info.argv.some((word) => word.includes(repo))) return undefined;
  return info;
}
function matchingService(info: ProcessInfo, repo: string, role: string): boolean {
  const app = join(repo, role === "frontend" ? "apps/web" : "apps/api");
  if (!contained(info.cwd, app)) return false;
  return role === "frontend" ? info.argv.some((word) => ["vite", "vite.js"].includes(basename(word)))
    : info.argv.some((word) => word.includes("server.ts"));
}
function records(runtime: string, repo: string): { dir: string; session: Json }[] {
  const found: { dir: string; session: Json }[] = [];
  const seen = new Set<string>();
  for (const root of [registry(repo), join(runtime, "sessions")]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) continue;
      const session = json(join(dir, "session.json"));
      if (!session || seen.has(String(session.session_id))) continue;
      seen.add(String(session.session_id)); found.push({ dir, session });
    }
  }
  return found;
}
function sessionRepo(session: Json, repo: string) { return resolve(String(session.worktreePath || session.worktree_path || repo)); }
async function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => done(true)));
  });
}
function listeners(port: number): number[] {
  const output = command(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
    ?? command(["fuser", `${port}/tcp`]) ?? "";
  return [...new Set(output.split(/\s+/).filter((word) => /^\d+$/.test(word)).map(Number))];
}
async function classify(runtime: string, repo: string, port: number): Promise<Decision[]> {
  const pids = listeners(port);
  const result: Decision[] = [];
  for (const pid of pids) {
    const info = processInfo(pid);
    let decision = "UNKNOWN_OWNER", session_id: string | undefined, role: string | undefined, candidate_repository: string | undefined;
    for (const { dir, session } of records(runtime, repo)) {
      for (const candidate of ["frontend", "backend"]) {
        const record = json(join(dir, `${candidate}.pid`));
        if (Number(record?.pid) !== pid || Number(record?.port) !== port) continue;
        const worktree = sessionRepo(session, repo);
        session_id = String(session.session_id); role = candidate;
        if (!info || info.start_ticks !== String(record?.start_ticks)) break;
        if (!matchingService(info, worktree, candidate) || info.uid !== process.getuid?.()) break;
        if (worktree !== repo) {
          decision = commonDir(worktree) === commonDir(repo) ? "OTHER_WORKTREE_ACTIVE_SESSION" : "OPERATOROS_OTHER_CHECKOUT";
          candidate_repository = worktree;
        } else {
          decision = valid(json(join(dir, "launcher.pid")), repo, "launcher") ? "OPERATOROS_ACTIVE" : "OPERATOROS_STALE";
        }
        break;
      }
      if (decision !== "UNKNOWN_OWNER") break;
    }
    if (decision === "UNKNOWN_OWNER" && info && info.uid === process.getuid?.()) {
      const candidate = git(info.cwd, "rev-parse", "--show-toplevel");
      if (candidate && ["frontend", "backend"].some((kind) => matchingService(info, candidate, kind))) {
        decision = candidate === repo ? "OPERATOROS_CURRENT_CHECKOUT" :
          commonDir(candidate) === commonDir(repo) ? "OPERATOROS_OTHER_WORKTREE" : "OPERATOROS_OTHER_CHECKOUT";
        candidate_repository = candidate;
      } else decision = "FOREIGN_PROCESS";
    }
    result.push({ pid, pgid: info?.pgid, start_ticks: info?.start_ticks, port, ownership_decision: decision, session_id, role, candidate_repository });
  }
  if (!pids.length && !await portFree("127.0.0.1", port)) result.push({ port, ownership_decision: "UNKNOWN_OWNER" });
  return result;
}
function groupAlive(pgid: number): boolean {
  return readdirSync("/proc").some((name) => /^\d+$/.test(name) && ((info) => info?.pgid === pgid && info.state !== "Z")(processInfo(Number(name))));
}
async function stopGroups(owned: { role: string; pid: number }[], timeout: number): Promise<number> {
  const deadline = Date.now() + timeout * 1000;
  let remaining = owned;
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    for (const item of remaining) {
      if (!groupAlive(item.pid)) continue;
      process.kill(-item.pid, signal);
      console.log(`[cleanup] Sent ${signal} to verified ${item.role} group ${item.pid}`);
    }
    const phaseEnd = signal === "SIGKILL" ? deadline : Math.min(deadline, Date.now() + timeout * 1000 / 3);
    while (Date.now() < phaseEnd && remaining.some((item) => groupAlive(item.pid))) await sleep(100);
    remaining = remaining.filter((item) => groupAlive(item.pid));
    if (!remaining.length) break;
  }
  return remaining.length;
}
function ownedChildren(runtime: string, repo: string, session: string, fallbacks: { role: string; pid: number }[] = []) {
  const dir = sessionDir(runtime, session), ownership = json(join(dir, "ownership.json"));
  if (ownership?.application !== "OperatorOS" || ownership?.session_id !== session) throw new Error("SESSION_OWNERSHIP_UNVERIFIED");
  const owned: { role: string; pid: number }[] = [];
  for (const role of ["frontend", "backend"]) {
    const record = json(join(dir, `${role}.pid`));
    const info = valid(record, repo, role);
    if (info && info.pgid === info.pid && matchingService(info, repo, role)) owned.push({ role, pid: info.pid });
  }
  for (const item of fallbacks) {
    if (owned.some((value) => value.pid === item.pid)) continue;
    const info = processInfo(item.pid);
    if (info && info.pgid === info.pid && info.uid === process.getuid?.() && matchingService(info, repo, item.role)) owned.push(item);
  }
  return owned;
}
function finalize(runtime: string, repo: string, session: string): void {
  const dir = sessionDir(runtime, session), shared = entry(repo, session);
  const sharedOwner = json(join(shared, "ownership.json")), sharedSession = json(join(shared, "session.json"));
  const verifiedShared = sharedOwner?.application === "OperatorOS" && sharedOwner.session_id === session &&
    sharedSession?.session_id === session && sessionRepo(sharedSession, repo) === repo;
  if (!existsSync(dir)) {
    if (verifiedShared) {
      for (const role of ["frontend", "backend"]) {
        const info = valid(json(join(shared, `${role}.pid`)), repo, role);
        if (info && matchingService(info, repo, role)) throw new Error(`ACTIVE_OWNED_SESSION:${role}`);
      }
      rmSync(shared, { recursive: true });
    }
    return;
  }
  const ownership = json(join(dir, "ownership.json"));
  if (ownership?.application !== "OperatorOS" || ownership.session_id !== session) throw new Error("CORRUPT_OWNERSHIP_MARKER");
  if (ownedChildren(runtime, repo, session).length) throw new Error("ACTIVE_OWNED_SESSION");
  const value = json(join(dir, "session.json"));
  if (value?.database_path && contained(resolve(value.database_path), dir)) throw new Error("SESSION_DATABASE_OWNERSHIP_FORBIDDEN");
  rmSync(dir, { recursive: true });
  if (verifiedShared) rmSync(shared, { recursive: true });
  const active = join(runtime, "active-session");
  if (existsSync(active) && readFileSync(active, "utf8").trim() === session) rmSync(active);
  const ports = join(runtime, "ports.json");
  if (json(ports)?.session_id === session) rmSync(ports);
}

async function main(): Promise<void> {
  if (action === "primary-path") return void console.log(primaryPath());
  if (action === "worktree-role") return void console.log(resolve(required("repo")) === primaryPath() ? "PRIMARY" : "SECONDARY");
  if (action === "random-secret") return void console.log(randomBytes(48).toString("base64url"));
  if (action === "dotenv-database-url") {
    const source = readFileSync(required("env-file"), "utf8");
    return void console.log(source.split("\n").some((line) => /^(?:export\s+)?DATABASE_URL\s*=/.test(line.trim())) ? "true" : "false");
  }
  if (action === "port-free") { if (!await portFree(required("host"), number("port"))) process.exitCode = 1; return; }
  if (action === "allocate") {
    const host = required("host"), start = number("preferred"), end = flag("auto") ? number("maximum") : start;
    for (let port = start; port <= end; port++) if (await portFree(host, port)) return void console.log(port);
    throw new Error("NO_FREE_PORT");
  }
  const repo = resolve(required("repo"));
  if (action === "registry-path") return void console.log(registry(repo));
  const runtime = resolve(required("runtime"));
  if (action === "classify-port") {
    const decisions = await classify(runtime, repo, number("port"));
    return void console.log(flag("decision") ? (decisions[0]?.ownership_decision ?? "NO_LISTENER") : JSON.stringify(decisions));
  }
  if (action === "cleanup-port") {
    const host = required("host"), port = number("port");
    const decisions = await classify(runtime, repo, port);
    if (!decisions.length && await portFree(host, port)) return;
    if (flag("no-clean") || decisions.some((item) => item.ownership_decision !== "OPERATOROS_STALE")) {
      for (const item of decisions) console.log((item.ownership_decision === "FOREIGN_PROCESS"
        ? `Port ${port} is in use by a non-OperatorOS process. No process was terminated.`
        : `Port ${port} has a protected listener (${item.ownership_decision}). No process was terminated.${item.candidate_repository ? ` Running checkout: ${item.candidate_repository}. Use ./start-dev.sh --auto-port or ./stop-dev.sh there.` : ""}`)
        + (item.pid ? `\nPID: ${item.pid}` : "")
        + (flag("verbose") ? `\n${JSON.stringify(item)}` : ""));
      process.exitCode = 3; return;
    }
    const owned: { role: string; pid: number }[] = [];
    for (const item of decisions) {
      const fresh = (await classify(runtime, repo, port)).find((other) => other.pid === item.pid && other.start_ticks === item.start_ticks && other.pgid === item.pid && other.ownership_decision === "OPERATOROS_STALE");
      if (!fresh?.pid) throw new Error("PORT_OWNERSHIP_CHANGED");
      owned.push({ role: item.role ?? "service", pid: fresh.pid });
    }
    if (await stopGroups(owned, Number(option("timeout") ?? 5)) || !await portFree(host, port)) throw new Error("PORT_DID_NOT_RELEASE");
    return;
  }
  if (action === "require-no-active-session" || action === "status") {
    const activeFile = join(runtime, "active-session");
    const activeId = existsSync(activeFile) ? readFileSync(activeFile, "utf8").trim() : "";
    const all = records(runtime, repo);
    if (activeId && !all.some(({ session }) => session.session_id === activeId)) {
      if (action === "status") { console.log("STALE_SESSION_UNVERIFIED"); return; }
      throw new Error("STALE_SESSION_UNVERIFIED");
    }
    for (const { session } of all) {
      if (sessionRepo(session, repo) !== repo) continue;
      const sessionId = String(session.session_id);
      for (const role of ["backend", "frontend"]) {
        const record = json(join(sessionDir(runtime, sessionId), role + ".pid")) ?? json(join(entry(repo, sessionId), role + ".pid"));
        const info = record ? processInfo(Number(record.pid)) : undefined;
        if (info && info.start_ticks !== String(record?.start_ticks)) throw new Error("STALE_SESSION_UNVERIFIED");
        if (info && ((!session.worktreePath && valid(record, repo, role)) || matchingService(info, repo, role))) {
          if (action === "status") console.log(`OperatorOS is already running from this checkout.\nFrontend  ${session.frontend_url}\nBackend   ${session.backend_url}\nSession   ${sessionId}\nRun ./stop-dev.sh from this checkout to stop it.`);
          else { console.log(sessionId); process.exitCode = 3; }
          return;
        }
        if (info) throw new Error("STALE_SESSION_UNVERIFIED");
      }
      if (action === "require-no-active-session") finalize(runtime, repo, sessionId);
      else console.log("STALE_VERIFIED");
    }
    if (action === "status" && !all.length) console.log("NO_ACTIVE_SESSION");
    return;
  }
  const selected = option("session") || (action === "stop" && existsSync(join(runtime, "active-session"))
    ? readFileSync(join(runtime, "active-session"), "utf8").trim() : "");
  if (!selected && !(action === "stop" && flag("all"))) {
    if (action === "stop") { console.log("No active OperatorOS development session"); return; }
    throw new Error("MISSING_ARGUMENT:session");
  }
  const session = selected || "all", dir = sessionDir(runtime, session), shared = entry(repo, session);
  if (action === "init-session") {
    mkdirSync(dirname(dir), { recursive: true, mode: 0o700 }); mkdirSync(registry(repo), { recursive: true, mode: 0o700 });
    mkdirSync(dir, { mode: 0o700 });
    try { mkdirSync(shared, { mode: 0o700 }); }
    catch (error) { rmSync(dir, { recursive: true }); throw error; }
    const launcher = number("launcher-pid"), identity = processInfo(launcher);
    if (!identity || identity.uid !== process.getuid?.() || !contained(identity.cwd, repo)) throw new Error("LAUNCHER_OWNERSHIP_UNVERIFIED");
    const started = now(), frontendPort = number("frontend-port"), backendPort = number("backend-port");
    const common = {
      session_id: session, backend_runtime: required("backend-runtime"), frontend_port: frontendPort, backend_port: backendPort,
      frontend_url: `http://${required("frontend-host")}:${frontendPort}`, backend_url: `http://${required("backend-host")}:${backendPort}`,
      started_at: started, startedAt: started, pid: launcher, pids: { launcher }, repoCommonDir: commonDir(repo), repo_common_dir: commonDir(repo),
      worktreePath: repo, worktree_path: repo, worktreeRole: repo === primaryPath() ? "PRIMARY" : "SECONDARY",
      branch: git(repo, "branch", "--show-current") ?? "detached", commit: git(repo, "rev-parse", "HEAD") ?? "unknown",
      ports: { frontend: frontendPort, backend: backendPort }, launcher: "linux", mode: required("mode"),
      javascript_runtime: required("javascript-runtime"), javascript_runtime_version: required("javascript-runtime-version"),
      database_path: resolve(required("database-path")), status: "starting",
    };
    const owner = { application: "OperatorOS", session_id: session, format_version: 1 };
    for (const path of [dir, shared]) {
      atomicJson(join(path, "session.json"), common); atomicJson(join(path, "ownership.json"), owner); atomicJson(join(path, "ports.json"), common);
      atomicJson(join(path, "launcher.pid"), { pid: launcher, role: "launcher", start_ticks: identity.start_ticks, recorded_at: started, token: required("token"), session_id: session });
    }
    atomicJson(join(runtime, "ports.json"), common);
    writeFileSync(join(runtime, "active-session"), `${session}\n`, { mode: 0o600 });
    return void console.log(dir);
  }
  if (action === "register") {
    const role = required("role"); if (!["backend", "frontend"].includes(role)) throw new Error("INVALID_ROLE");
    const pid = number("pid"), info = processInfo(pid);
    if (!info || !matchingService(info, repo, role) || info.uid !== process.getuid?.()) return;
    const record = { pid, role, start_ticks: info.start_ticks, recorded_at: now(), token: required("token"), session_id: session, port: number("port") };
    for (const path of [dir, shared]) {
      atomicJson(join(path, `${role}.pid`), record);
      const value = json(join(path, "session.json"));
      if (value) { value.pids[role] = pid; value[`${role}_pid`] = pid; atomicJson(join(path, "session.json"), value); }
    }
    return;
  }
  if (action === "mark") {
    for (const path of [join(dir, "session.json"), join(shared, "session.json"), join(runtime, "ports.json")]) {
      const value = json(path); if (value?.session_id !== session) continue;
      value.status = required("status"); value[`${value.status}_at`] = now(); atomicJson(path, value);
    }
    return;
  }
  if (action === "stop-owned-session" || action === "stop") {
    const sessions = action === "stop" && flag("all") ? records(runtime, repo).filter(({ session }) => sessionRepo(session, repo) === repo).map(({ session }) => String(session.session_id)) : [session];
    for (const id of sessions) {
      const fallbacks = ["frontend", "backend"].flatMap((role) => option(`${role}-pid`) ? [{ role, pid: Number(option(`${role}-pid`)) }] : []);
      const owned = ownedChildren(runtime, repo, id, fallbacks);
      const remaining = await stopGroups(owned, Number(option("timeout") ?? 5));
      console.log(`[cleanup] Owned groups: ${owned.length}; remaining: ${remaining}`);
      if (remaining) process.exitCode = 3;
    }
    return;
  }
  if (action === "finalize-session") return void finalize(runtime, repo, session);
  throw new Error("UNKNOWN_COMMAND");
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "RUNTIME_ERROR"); process.exitCode = 2; }
