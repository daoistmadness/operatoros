import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const PYTHON_VENV_ENV = "OPERATOROS_PYTHON_VENV";
const FINGERPRINT_FILE = ".operatoros-python-tooling.json";
const RESOLVER_VERSION = 1;

export type ToolingFingerprint = {
  resolverVersion: number;
  pythonVersion: string;
  requirementsSha256: string;
};

export function findRepositoryRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(join(current, "mise.toml")) &&
      existsSync(join(current, "backend", "requirements.txt")) &&
      existsSync(join(current, "apps", "api", "package.json")) &&
      existsSync(join(current, "apps", "web", "package.json"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("OperatorOS repository root was not found");
    current = parent;
  }
}

function configuredCacheRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.XDG_CACHE_HOME;
  if (configured !== undefined && !isAbsolute(configured)) {
    throw new Error("XDG_CACHE_HOME must be an absolute path");
  }
  return configured ?? join(homedir(), ".cache");
}

export function resolveVenvPath(repositoryRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[PYTHON_VENV_ENV];
  if (configured !== undefined && !isAbsolute(configured)) {
    throw new Error(`${PYTHON_VENV_ENV} must be an absolute path`);
  }
  const path = resolve(configured ?? join(configuredCacheRoot(env), "operatoros", "python", "venv"));
  const repository = resolve(repositoryRoot);
  const repositoryRelative = relative(repository, path);
  if (repositoryRelative === "" || (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative))) {
    throw new Error(`${PYTHON_VENV_ENV} must point outside the repository worktree`);
  }
  return path;
}

export function resolvePythonExecutable(venvPath: string): string {
  return process.platform === "win32" ? join(venvPath, "Scripts", "python.exe") : join(venvPath, "bin", "python");
}

export function fingerprintPath(venvPath: string): string {
  return join(venvPath, FINGERPRINT_FILE);
}

function requiredPythonVersion(repositoryRoot: string): string {
  const mise = readFileSync(join(repositoryRoot, "mise.toml"), "utf8");
  const match = mise.match(/^\s*python\s*=\s*["']([^"']+)["']\s*$/m);
  if (!match?.[1]) throw new Error("mise.toml does not declare a Python tool version");
  return match[1];
}

export function expectedFingerprint(repositoryRoot: string): ToolingFingerprint {
  const requirements = readFileSync(join(repositoryRoot, "backend", "requirements.txt"));
  return {
    resolverVersion: RESOLVER_VERSION,
    pythonVersion: requiredPythonVersion(repositoryRoot),
    requirementsSha256: createHash("sha256").update(requirements).digest("hex"),
  };
}

function readFingerprint(path: string): ToolingFingerprint | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ToolingFingerprint>;
    if (
      typeof value.resolverVersion !== "number" ||
      typeof value.pythonVersion !== "string" ||
      typeof value.requirementsSha256 !== "string"
    ) return null;
    return {
      resolverVersion: value.resolverVersion,
      pythonVersion: value.pythonVersion,
      requirementsSha256: value.requirementsSha256,
    };
  } catch {
    return null;
  }
}

function pythonVersion(executable: string): string {
  const result = Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
  if (result.exitCode !== 0) throw new Error(`Python tooling executable failed: ${output || `exit ${result.exitCode}`}`);
  return output.replace(/^Python\s+/, "");
}

function assertExternalVenvPath(venvPath: string): void {
  try {
    if (!existsSync(venvPath)) return;
    if (!lstatSync(venvPath).isDirectory()) throw new Error(`${PYTHON_VENV_ENV} is not a directory: ${venvPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${PYTHON_VENV_ENV} is not a directory`)) throw error;
    throw new Error(`Cannot inspect Python tooling environment: ${venvPath}`);
  }
}

export function assertReady(repositoryRoot: string, venvPath = resolveVenvPath(repositoryRoot)): string {
  assertExternalVenvPath(venvPath);
  const executable = resolvePythonExecutable(venvPath);
  if (!existsSync(executable)) throw new Error(`Python tooling environment is missing: ${venvPath}`);
  const expected = expectedFingerprint(repositoryRoot);
  const actualVersion = pythonVersion(executable);
  if (actualVersion !== expected.pythonVersion) {
    throw new Error(`Python tooling version mismatch: expected ${expected.pythonVersion}, found ${actualVersion}`);
  }
  const actualFingerprint = readFingerprint(fingerprintPath(venvPath));
  if (!actualFingerprint || JSON.stringify(actualFingerprint) !== JSON.stringify(expected)) {
    throw new Error(`Python tooling environment is stale: ${venvPath}`);
  }
  return executable;
}

function bootstrapPython(): string {
  const executable = Bun.which("python");
  if (!executable) throw new Error("Mise-managed Python is unavailable; run mise install");
  return executable;
}

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} exited with status ${result.exitCode}`);
}

export function bootstrap(repositoryRoot: string, venvPath = resolveVenvPath(repositoryRoot)): string {
  assertExternalVenvPath(venvPath);
  mkdirSync(venvPath, { recursive: true, mode: 0o700 });
  const executable = resolvePythonExecutable(venvPath);
  if (!existsSync(executable)) run([bootstrapPython(), "-m", "venv", venvPath]);
  const expected = expectedFingerprint(repositoryRoot);
  const actualVersion = pythonVersion(executable);
  if (actualVersion !== expected.pythonVersion) {
    throw new Error(`Python tooling version mismatch after bootstrap: expected ${expected.pythonVersion}, found ${actualVersion}`);
  }
  run([executable, "-m", "pip", "install", "--requirement", join(repositoryRoot, "backend", "requirements.txt")]);
  const temporary = `${fingerprintPath(venvPath)}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(expected, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, fingerprintPath(venvPath));
  return executable;
}

function usage(): never {
  throw new Error("usage: python-tooling-env.ts [--repo PATH] check|bootstrap|print-executable");
}

function main(): void {
  const args = [...Bun.argv.slice(2)];
  let repositoryRoot: string | undefined;
  const repoIndex = args.indexOf("--repo");
  if (repoIndex >= 0) {
    repositoryRoot = args[repoIndex + 1];
    args.splice(repoIndex, 2);
  }
  const command = args[0];
  if (args.length !== 1 || !command || !["check", "bootstrap", "print-executable"].includes(command)) usage();
  const root = findRepositoryRoot(repositoryRoot);
  const venvPath = resolveVenvPath(root);
  if (command === "bootstrap") {
    const executable = bootstrap(root, venvPath);
    console.log(`PASS: Python tooling environment=${venvPath}`);
    console.log(`PASS: Python=${pythonVersion(executable)}`);
    return;
  }
  const executable = assertReady(root, venvPath);
  if (command === "print-executable") console.log(executable);
  else {
    console.log(`PASS: Python tooling environment=${venvPath}`);
    console.log(`PASS: Python=${pythonVersion(executable)}`);
    console.log(`PASS: tooling fingerprint=${fingerprintPath(venvPath)}`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Next: mise run python:bootstrap");
    process.exit(1);
  }
}
