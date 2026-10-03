#!/usr/bin/env bun
/** Validate disposable E2E paths lexically, before any database file is accessed. */
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const repositoryRoot = resolve(import.meta.dir, "../..");
export function validateDatabasePath(database: string, runtimeRoot = join(repositoryRoot, ".runtime/operatoros-e2e"), repo = repositoryRoot): string {
  if (!isAbsolute(database)) throw new Error("E2E database must be an absolute path");
  const selected = resolve(database), runtime = resolve(runtimeRoot), distance = relative(runtime, selected);
  if (distance === ".." || distance.startsWith("../") || isAbsolute(distance)) throw new Error("E2E database must be inside the disposable E2E runtime root");
  if (selected === resolve(repo, "backend/attendance.db")) throw new Error("E2E database must not equal the protected operational database");
  return selected;
}
if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { database: { type: "string" }, "runtime-root": { type: "string" }, "repository-root": { type: "string", default: repositoryRoot } } });
    if (!values.database || !values["runtime-root"]) throw new Error("--database and --runtime-root are required");
    console.log(validateDatabasePath(values.database, values["runtime-root"], values["repository-root"]));
  } catch (error) { console.error(`create-test-workspace.ts: error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
