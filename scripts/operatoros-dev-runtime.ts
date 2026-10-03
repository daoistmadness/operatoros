import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

type Json = Record<string, any>;
export type ProcessInfo = { pid: number; ppid: number; pgid: number; start_ticks: string; cwd: string; argv: string[]; uid: number; state: string };
type Decision = { pid?: number; pgid?: number; start_ticks?: string; port: number; ownership_decision: string; session_id?: string | null; role?: string | null; candidate_repository?: string; [key: string]: unknown };
const argv = process.argv.slice(2);
const action = argv.shift() ?? "";
const option = (name: string) => { const at = argv.indexOf(`--${name}`); return at < 0 ? undefined : argv[at + 1]; };
const flag = (name: string) => argv.includes(`--${name}`);
const required = (name: string) => { const value = option(name); if (!value || value.startsWith("--")) throw new Error(`MISSING_ARGUMENT:${name}`); return value; };
const number = (name: string) => { const value = Number(required(name)); if (!Number.isInteger(value) || value < 1) throw new Error(`INVALID_ARGUMENT:${name}`); return value; };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const contained = (path: string, root: string) => { const value = relative(root, path); return value === "" || (value !== ".." && !value.startsWith("../") && !isAbsolute(value)); };
const now = () => new Date().toISOString();
const canonical = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path);
const gitEnv = { ...process.env };
for (const key of Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe" }).stdout.toString().trim().split("\n")) delete gitEnv[key];

function command(parts: string[], env = process.env): string | undefined {
  try {
    const result = Bun.spawnSync(parts, { env, stdout: "pipe", stderr: "pipe" });
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
  } catch { return undefined; }
}
function git(repo: string, ...args: string[]): string | undefined { return command(["git", "-C", repo, ...args], gitEnv); }
function commonDir(repo: string): string {
  const value = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!value) throw new Error("SESSION_REGISTRY_UNAVAILABLE");
  return resolve(value);
}
function checkoutIdentity(repo: string): Json | undefined {
  const root = git(repo, "rev-parse", "--show-toplevel");
  if (!root) return undefined;
  const commit = git(root, "rev-parse", "HEAD") || "unknown";
  const upstream = git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") ?? null;
  const counts = upstream ? git(root, "rev-list", "--left-right", "--count", "HEAD...@{u}")?.split(/\s+/).map(Number) : undefined;
  const changes = git(root, "status", "--porcelain", "--untracked-files=normal");
  return { repository: root, common_dir: commonDir(root), branch: git(root, "branch", "--show-current") || "detached",
    commit: commit.slice(0, 12), commit_full: commit, upstream,
    status: changes === undefined ? "unknown" : changes ? "dirty" : "clean", ahead: counts?.[0] ?? null, behind: counts?.[1] ?? null };
}
export function primaryPath(): string {
  const configured = process.env.OPERATOROS_PRIMARY_CHECKOUT_PATH;
  const value = configured?.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured || join(homedir(), "code/repos/operatoros");
  if (!isAbsolute(value)) throw new Error("PRIMARY_CHECKOUT_CONFIGURATION_INVALID");
  return existsSync(value) ? realpathSync(value) : resolve(value);
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
  if ([join(runtime, "sessions"), path].some(value => existsSync(value) && lstatSync(value).isSymbolicLink())) throw new Error("SESSION_PATH_ESCAPE_REJECTED");
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
export function matchingService(info: ProcessInfo, repo: string, role: string): boolean {
  const app = join(repo, role === "frontend" ? "apps/web" : "apps/api");
  if (!contained(info.cwd, app)) return false;
  return role === "frontend" ? info.argv.some((word) => ["vite", "vite.js"].includes(basename(word)))
    : info.argv.some((word) => resolve(info.cwd, word) === join(app, "src/server.ts"));
}
function records(runtime: string, repo: string): { dir: string; session: Json }[] {
  const found: { dir: string; session: Json }[] = [];
  const seen = new Set<string>();
  const shared = registry(repo);
  for (const root of [shared, join(runtime, "sessions")]) {
    if (!existsSync(root)) continue;
    if (lstatSync(root).isSymbolicLink()) throw new Error("SESSION_PATH_ESCAPE_REJECTED");
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) continue;
      const session = json(join(dir, "session.json"));
      if (root === shared && session?.worktreePath && !existsSync(session.worktreePath)) {
        const owner = json(join(dir, "ownership.json"));
        if (owner?.application === "OperatorOS" && owner.session_id === session.session_id && session.session_id === name) rmSync(dir, { recursive: true });
        continue;
      }
      if (!session || seen.has(String(session.session_id))) continue;
      session.session_id ||= name;
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
  for (const args of [["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], ["fuser", `${port}/tcp`]]) {
    try {
      const output = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
      const pids = [...new Set(`${output.stdout} ${output.stderr}`.split(/\s+/).filter(word => /^\d+$/.test(word)).map(Number))].sort((a, b) => a - b);
      if (pids.length) return pids;
    } catch { /* Try the existing fallback if the executable is unavailable. */ }
  }
  return [];
}
async function classify(runtime: string, repo: string, port: number): Promise<Decision[]> {
  const pids = listeners(port);
  const result: Decision[] = [];
  for (const pid of pids) {
    const info = processInfo(pid);
    let decision = "UNKNOWN_OWNER", session_id: string | undefined, role: string | undefined, candidate_repository: string | undefined;
    let extra: Json = {};
    for (const { dir, session } of records(runtime, repo)) {
      for (const candidate of ["frontend", "backend"]) {
        const record = json(join(dir, `${candidate}.pid`));
        if (Number(record?.pid) !== pid || Number(record?.port) !== port) continue;
        const worktree = sessionRepo(session, repo);
        session_id = String(session.session_id); role = candidate;
        if (!info) { if (worktree === repo) decision = "SAME_WORKTREE_STALE_SESSION"; break; }
        if (info.start_ticks !== String(record?.start_ticks) || info.state === "Z") break;
        if (!session.worktreePath && valid(record, repo, candidate)) {
          decision = worktree === repo ? "OPERATOROS_ACTIVE" : "OTHER_WORKTREE_ACTIVE_SESSION";
        } else if (!matchingService(info, worktree, candidate) || info.uid !== process.getuid?.()) break;
        else if (worktree === repo) decision = valid(json(join(dir, "launcher.pid")), repo, "launcher") ? "OPERATOROS_ACTIVE" : "OPERATOROS_STALE";
        if (worktree !== repo) {
          decision = commonDir(worktree) === commonDir(repo) ? "OTHER_WORKTREE_ACTIVE_SESSION" : "OPERATOROS_OTHER_CHECKOUT";
          candidate_repository = worktree;
          const identity = checkoutIdentity(worktree);
          extra = { candidate_common: session.repoCommonDir || session.repo_common_dir || commonDir(repo), service: candidate,
            candidate_branch: identity?.branch || session.branch || "detached", candidate_commit: identity?.commit || session.commit || "unknown" };
        }
        break;
      }
      if (decision !== "UNKNOWN_OWNER") break;
    }
    if (decision === "UNKNOWN_OWNER" && info && info.uid === process.getuid?.()) {
      const candidate = git(info.cwd, "rev-parse", "--show-toplevel");
      const service = candidate && ["frontend", "backend"].find(kind => matchingService(info, candidate, kind));
      if (candidate && service && ["api", "web"].every(app => json(join(candidate, `apps/${app}/package.json`))?.name === `@operatoros/${app}`)) {
        decision = candidate === repo ? "OPERATOROS_CURRENT_CHECKOUT" :
          commonDir(candidate) === commonDir(repo) ? "OPERATOROS_OTHER_WORKTREE" : "OPERATOROS_OTHER_CHECKOUT";
        candidate_repository = candidate;
        const identity = checkoutIdentity(candidate);
        extra = { candidate_common: commonDir(candidate), current_common: commonDir(repo), candidate_branch: identity?.branch, candidate_commit: identity?.commit, service };
        role ||= service;
      } else decision = "FOREIGN_PROCESS";
    }
    result.push({ pid, ...(info ? { parent_pid: info.ppid, pgid: info.pgid, start_ticks: info.start_ticks, cwd: info.cwd, uid: info.uid, state: info.state } : {}),
      port, listening_address: `127.0.0.1:${port}`, ownership_decision: decision, session_id: session_id ?? null, role: role ?? null,
      ...(candidate_repository ? { candidate_repository } : {}), ...extra });
  }
  if (!pids.length && !await portFree("127.0.0.1", port)) result.push({ port, ownership_decision: "UNKNOWN_OWNER", reason: "listener PID unavailable" });
  return result;
}
function groupAlive(pgid: number): boolean {
  return readdirSync("/proc").some((name) => /^\d+$/.test(name) && ((info) => info?.pgid === pgid && info.state !== "Z")(processInfo(Number(name))));
}
async function stopGroups(owned: { role: string; pid: number }[], timeout: number): Promise<number> {
  const identities = new Map(owned.map(item => [item.pid, processInfo(item.pid)?.start_ticks]));
  const deadline = Date.now() + Math.max(0.1, timeout) * 1000;
  let remaining = owned;
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    for (const item of remaining) {
      if (!groupAlive(item.pid)) continue;
      const leader = processInfo(item.pid);
      if (leader && (leader.pgid !== item.pid || leader.uid !== process.getuid?.() || leader.start_ticks !== identities.get(item.pid))) throw new Error(`PROCESS_GROUP_OWNERSHIP_UNVERIFIED:${item.role}:${item.pid}`);
      try { process.kill(-item.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") continue; throw error; }
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
    if (info && info.pgid === info.pid && info.uid === process.getuid?.() && info.argv.some(word => word.includes(repo)) && matchingService(info, repo, item.role)) owned.push(item);
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
  for (const role of ["frontend", "backend"]) if (valid(json(join(dir, `${role}.pid`)), repo, role)) throw new Error(`ACTIVE_OWNED_SESSION:${role}`);
  const value = json(join(dir, "session.json"));
  if (!value) return;
  if (value.database_path && contained(canonical(value.database_path), canonical(dir))) throw new Error("SESSION_DATABASE_OWNERSHIP_FORBIDDEN");
  rmSync(dir, { recursive: true });
  if (verifiedShared) rmSync(shared, { recursive: true });
  const active = join(runtime, "active-session");
  if (existsSync(active) && readFileSync(active, "utf8").trim() === session) rmSync(active);
  const ports = join(runtime, "ports.json");
  if (json(ports)?.session_id === session) rmSync(ports);
}

async function main(): Promise<void> {
  if (action === "primary-path") return void console.log(primaryPath());
  if (action === "worktree-role") { const repo = required("repo"); return void console.log((existsSync(repo) ? realpathSync(repo) : resolve(repo)) === primaryPath() ? "PRIMARY" : "SECONDARY"); }
  if (action === "random-secret") return void console.log(randomBytes(48).toString("base64url"));
  if (action === "dotenv-database-url") {
    const path = required("env-file"), source = existsSync(path) ? readFileSync(path, "utf8") : "";
    return void console.log(source.split("\n").some((line) => /^(?:export\s+)?DATABASE_URL\s*=/.test(line.trim())) ? "true" : "false");
  }
  if (action === "port-free") { if (!await portFree(required("host"), number("port"))) process.exitCode = 1; return; }
  if (action === "allocate") {
    const host = option("host") ?? "127.0.0.1", start = number("preferred"), maximum = number("maximum"), end = flag("auto") ? maximum : start;
    for (let port = start; port <= end; port++) if (await portFree(host, port)) return void console.log(port);
    console.error(`no free port in ${start}-${maximum}`); process.exitCode = 4; return;
  }
  if (action === "mark") {
    const runtime = canonical(required("runtime")), session = required("session"), dir = sessionDir(runtime, session);
    if (!json(join(dir, "session.json"))) return;
    const shared = option("repo") ? entry(canonical(required("repo")), session) : undefined;
    for (const path of [join(dir, "session.json"), ...(shared ? [join(shared, "session.json"), join(shared, "ports.json")] : []), join(runtime, "ports.json")]) {
      const value = json(path); if (value?.session_id !== session) continue;
      value.status = required("status"); value[`${value.status}_at`] = now(); atomicJson(path, value);
    }
    return;
  }
  const repo = canonical(required("repo"));
  if (action === "checkout-identity") {
    const identity = checkoutIdentity(repo);
    console.log(JSON.stringify(identity ?? { error: "CHECKOUT_IDENTITY_UNAVAILABLE", repository: repo }));
    if (!identity) process.exitCode = 2;
    return;
  }
  if (action === "registry-path") return void console.log(registry(repo));
  const runtime = canonical(required("runtime"));
  if (action === "classify-port") {
    const decisions = await classify(runtime, repo, number("port"));
    return void console.log(flag("decision") ? (decisions[0]?.ownership_decision ?? "NO_LISTENER") : JSON.stringify(decisions));
  }
  if (action === "cleanup-port") {
    const host = option("host") ?? "127.0.0.1", port = number("port");
    const decisions = await classify(runtime, repo, port);
    if (!decisions.length && await portFree(host, port)) return;
    for (const item of decisions.filter(item => item.ownership_decision === "SAME_WORKTREE_STALE_SESSION")) {
      if (!item.session_id || !item.role) continue;
      for (const path of [sessionDir(runtime, item.session_id), entry(repo, item.session_id)]) rmSync(join(path, `${item.role}.pid`), { force: true });
    }
    const live = decisions.filter(item => item.ownership_decision !== "SAME_WORKTREE_STALE_SESSION");
    if (live.some(item => flag("no-clean") || item.ownership_decision !== "OPERATOROS_STALE")) {
      for (const item of live.filter(item => flag("no-clean") || item.ownership_decision !== "OPERATOROS_STALE")) if (!flag("human")) console.log(JSON.stringify(item)); else console.log((item.ownership_decision === "FOREIGN_PROCESS"
        ? `Port ${port} is in use by a non-OperatorOS process. No process was terminated.`
        : `Port ${port} has a protected listener (${item.ownership_decision}). No process was terminated.${item.candidate_repository ? ` Running checkout: ${item.candidate_repository}. Use ./start-dev.sh --auto-port or ./stop-dev.sh there.` : ""}`)
        + (item.pid ? `\nPID: ${item.pid}` : "")
        + (flag("verbose") ? `\n${JSON.stringify(item)}` : ""));
      process.exitCode = 3; return;
    }
    const owned: { role: string; pid: number }[] = [];
    for (const item of live) {
      const fresh = (await classify(runtime, repo, port)).find((other) => other.pid === item.pid && other.start_ticks === item.start_ticks && other.pgid === item.pid && other.ownership_decision === "OPERATOROS_STALE");
      if (!fresh?.pid) { console.log("[blocked] Process ownership changed; no signal sent"); process.exitCode = 3; return; }
      owned.push({ role: item.role ?? "service", pid: fresh.pid });
    }
    if (await stopGroups(owned, Number(option("timeout") ?? 2)) || !await portFree(host, port)) { console.log(`[blocked] Port ${port} did not release`); process.exitCode = 3; return; }
    console.log(`[cleanup] Port ${port} released`);
    return;
  }
  if (action === "status") {
    const activeFile = join(runtime, "active-session");
    const activeId = existsSync(activeFile) ? readFileSync(activeFile, "utf8").trim() : "";
    const all = records(runtime, repo);
    const report = (state: string, session?: Json) => {
      if (!flag("human")) console.log(JSON.stringify({ state }));
      else if (state === "ACTIVE_VERIFIED" && session) console.log(`OperatorOS is already running from this checkout.\nFrontend  ${session.frontend_url}\nBackend   ${session.backend_url}\nSession   ${session.session_id}\nDatabase  ${session.database_path}\nRun ./stop-dev.sh from this checkout to stop it.`);
      else console.log(state);
    };
    if (activeId && !all.some(({ session }) => session.session_id === activeId)) return report("STALE_SESSION_UNVERIFIED");
    const current = all.find(({ session }) => sessionRepo(session, repo) === repo);
    if (!current) return report("NO_ACTIVE_SESSION");
    for (const role of ["backend", "frontend"]) {
      const record = json(join(current.dir, `${role}.pid`));
      const info = valid(record, repo, role);
      if (info && (!current.session.worktreePath || matchingService(info, repo, role))) return report("ACTIVE_VERIFIED", current.session);
    }
    return report("STALE_VERIFIED");
  }
  if (action === "require-no-active-session") {
    const activeFile = join(runtime, "active-session");
    const activeId = existsSync(activeFile) ? readFileSync(activeFile, "utf8").trim() : "";
    const all = records(runtime, repo);
    if (activeId && !all.some(({ session }) => session.session_id === activeId)) {
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
          console.log(sessionId); process.exitCode = 3;
          return;
        }
        if (info) throw new Error("STALE_SESSION_UNVERIFIED");
      }
      finalize(runtime, repo, sessionId);
    }
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
      session_id: session, backend_runtime: option("backend-runtime") ?? "elysia", frontend_port: frontendPort, backend_port: backendPort,
      frontend_url: `http://${required("frontend-host")}:${frontendPort}`, backend_url: `http://${required("backend-host")}:${backendPort}`,
      started_at: started, startedAt: started, pid: launcher, pids: { launcher }, repoCommonDir: commonDir(repo), repo_common_dir: commonDir(repo),
      worktreePath: repo, worktree_path: repo, worktreeRole: repo === primaryPath() ? "PRIMARY" : "SECONDARY", worktree_role: repo === primaryPath() ? "PRIMARY" : "SECONDARY",
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
  if (action === "stop-owned-session" || action === "stop") {
    const sessions = action === "stop" && flag("all") ? records(runtime, repo).filter(({ session }) => sessionRepo(session, repo) === repo).map(({ session }) => String(session.session_id)) : [session];
    for (const id of sessions) {
      const fallbacks = ["frontend", "backend"].flatMap((role) => option(`${role}-pid`) ? [{ role, pid: Number(option(`${role}-pid`)) }] : []);
      const owned = ownedChildren(runtime, repo, id, fallbacks);
      if (action === "stop") for (const role of ["frontend", "backend"]) {
        const record = json(join(sessionDir(runtime, id), `${role}.pid`));
        if (record && !owned.some(item => item.role === role && item.pid === Number(record.pid))) console.log(`[blocked] Refusing to stop unverified ${role} PID record`);
      }
      const remaining = await stopGroups(owned, Number(option("timeout") ?? (action === "stop-owned-session" ? 10 : 2)));
      if (action === "stop-owned-session") console.log(flag("human") ? `[cleanup] Owned groups: ${owned.length}; remaining: ${remaining}` : JSON.stringify({ session: id, owned_groups: owned.length, remaining_groups: remaining, deadline_seconds: Number(option("timeout") ?? 10) }));
      else if (!remaining) {
        for (const root of [sessionDir(runtime, id), entry(repo, id)]) {
          const value = json(join(root, "session.json"));
          if (value) { value.status = "stopped"; value.stopped_at = now(); atomicJson(join(root, "session.json"), value); }
          for (const item of owned) rmSync(join(root, `${item.role}.pid`), { force: true });
        }
      }
      if (remaining) process.exitCode = 3;
    }
    return;
  }
  if (action === "finalize-session") return void finalize(runtime, repo, session);
  throw new Error("UNKNOWN_COMMAND");
}

if (import.meta.main) {
  try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "RUNTIME_ERROR"); process.exitCode = 2; }
}
