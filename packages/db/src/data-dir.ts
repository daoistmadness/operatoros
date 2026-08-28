import { createHash } from "node:crypto";
import { existsSync, chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const OPERATOROS_DATA_DIR_ENV = "OPERATOROS_DATA_DIR";
export const LEGACY_DATA_DIR_ENV = "OPERATOROS_DEV_DATA_DIR";
export const OPERATOROS_DATABASE_FILENAME = "operatoros.sqlite";
export const LEGACY_DATABASE_FILENAME = "operatoros-development.db";

export interface OperatorOSPaths {
  dataDir: string;
  databasePath: string;
  backupDir: string;
  logDir: string;
  legacyDatabasePath: string;
  source: "explicit" | "legacy" | "default";
  repositoryId?: string;
}

export interface ResolveDataDirOptions {
  env?: Record<string, string | undefined>;
  repositoryRoot?: string;
  commonDirectory?: string;
  homeDirectory?: string;
}

export class DataDirectoryError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DataDirectoryError";
  }
}

function fail(code: string, detail?: string): never {
  throw new DataDirectoryError(code, detail);
}

function absolute(value: string, name: string): string {
  if (!isAbsolute(value)) fail("DATA_DIR_PATH_NOT_ABSOLUTE", name);
  return resolve(value);
}

function contained(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function repositoryCommonDirectory(repositoryRoot: string): string {
  const result = Bun.spawnSync(["git", "-C", repositoryRoot, "rev-parse", "--git-common-dir"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) fail("DATA_DIR_REPOSITORY_ID_UNAVAILABLE", repositoryRoot);
  const output = result.stdout.toString().trim();
  if (!output) fail("DATA_DIR_REPOSITORY_ID_UNAVAILABLE", repositoryRoot);
  return resolve(repositoryRoot, output);
}

function repositoryRoot(options: ResolveDataDirOptions): string {
  return resolve(options.repositoryRoot ?? join(import.meta.dir, "../../.."));
}

function defaultDataRoot(env: Record<string, string | undefined>, home: string): string {
  if (env.XDG_DATA_HOME) return absolute(env.XDG_DATA_HOME, "XDG_DATA_HOME");
  if (process.platform === "darwin") return join(home, "Library", "Application Support");
  if (process.platform === "win32") return absolute(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "LOCALAPPDATA");
  return join(home, ".local", "share");
}

export function resolveOperatorOSPaths(options: ResolveDataDirOptions = {}): OperatorOSPaths {
  const env = options.env ?? process.env;
  const explicit = env[OPERATOROS_DATA_DIR_ENV]?.trim();
  const legacy = env[LEGACY_DATA_DIR_ENV]?.trim();
  const selected = explicit || legacy;
  const source = explicit ? "explicit" : legacy ? "legacy" : "default";
  const repo = repositoryRoot(options);
  const common = options.commonDirectory ? resolve(options.commonDirectory) : selected ? undefined : repositoryCommonDirectory(repo);
  const repositoryId = common ? createHash("sha256").update(common).digest("hex").slice(0, 16) : undefined;
  const dataDir = selected
    ? absolute(selected, explicit ? OPERATOROS_DATA_DIR_ENV : LEGACY_DATA_DIR_ENV)
    : resolve(defaultDataRoot(env, options.homeDirectory ? absolute(options.homeDirectory, "homeDirectory") : homedir()), "operatoros", "development", repositoryId!);

  const normalizedRepo = resolve(repo);
  const runtimeSessions = resolve(normalizedRepo, ".runtime", "operatoros-dev", "sessions");
  const protectedBackend = resolve(normalizedRepo, "backend");
  if (contained(dataDir, normalizedRepo) || contained(dataDir, runtimeSessions) || contained(dataDir, protectedBackend) || basename(dataDir) === "attendance.db") {
    fail("DATA_DIR_PATH_REJECTED", dataDir);
  }

  return {
    dataDir,
    databasePath: join(dataDir, OPERATOROS_DATABASE_FILENAME),
    backupDir: join(dataDir, "backups"),
    logDir: join(dataDir, "logs"),
    legacyDatabasePath: join(dataDir, LEGACY_DATABASE_FILENAME),
    source,
    ...(repositoryId ? { repositoryId } : {}),
  };
}

export function resolveDataDir(options: ResolveDataDirOptions = {}): string {
  return resolveOperatorOSPaths(options).dataDir;
}

export function ensureOperatorOSDirectories(paths: OperatorOSPaths): void {
  for (const directory of [paths.dataDir, paths.backupDir, paths.logDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
}

export function assertDatabaseMigrationSafe(paths: OperatorOSPaths, exists: (path: string) => boolean = existsSync): void {
  const oldExists = exists(paths.legacyDatabasePath);
  const newExists = exists(paths.databasePath);
  if (oldExists && !newExists) fail("DATA_DIR_LEGACY_DATABASE_REQUIRES_MANUAL_MIGRATION", `${paths.legacyDatabasePath} -> ${paths.databasePath}`);
  if (oldExists && newExists) fail("DATA_DIR_MULTIPLE_DATABASES", `${paths.legacyDatabasePath} and ${paths.databasePath}`);
}
