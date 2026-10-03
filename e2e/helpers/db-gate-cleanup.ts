#!/usr/bin/env bun
/** Remove startup-only gate identities so the conflict UI uses explicit links. */
import { parseArgs } from "node:util";
import { openDatabase } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

export function cleanupGateIdentities(database: string, runtimeRoot: string): number {
  const selected = validateExistingDatabasePath(database, runtimeRoot);
  const handle = openDatabase(selected);
  try {
    const result = handle.client.run("DELETE FROM student_device_identities WHERE device_source = 'E2E_GATE_ONLY'");
    return Number(result.changes ?? 0);
  } finally {
    handle.close();
  }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { database: { type: "string" }, "runtime-root": { type: "string" } } });
    const db = positionals[0] ?? values.database;
    if (!db || !values["runtime-root"]) throw new TypeError("--database and --runtime-root are required");
    cleanupGateIdentities(db as string, values["runtime-root"] as string);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TypeError ? 2 : 1;
  }
}
