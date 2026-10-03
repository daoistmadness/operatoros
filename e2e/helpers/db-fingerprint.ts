#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { CURRENT_SCHEMA_VERSION, openDatabase, schemaFingerprint } from "@operatoros/db";
import { validateExistingDatabasePath } from "./create-test-workspace";

/** Raw logical contents: callers must explicitly justify any volatile-field normalization. */
export function logicalDatabaseContents(database: string, runtimeRoot: string) {
  const handle = openDatabase(validateExistingDatabasePath(database, runtimeRoot), { readonly: true });
  try {
    const names = (handle.client.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const tables = Object.fromEntries(names.map(name => {
      const identifier = `"${name.replaceAll('"', '""')}"`;
      const contents = handle.client.query(`SELECT * FROM ${identifier}`).all().map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? { base64: Buffer.from(value).toString("base64") } : value])));
      contents.sort((left, right) => { const a = JSON.stringify(left), b = JSON.stringify(right); return a < b ? -1 : a > b ? 1 : 0; });
      return [name, contents];
    }));
    return { schemaVersion: CURRENT_SCHEMA_VERSION, schemaFingerprint: schemaFingerprint(handle.client), tables, foreignKeyViolations: handle.client.query("PRAGMA foreign_key_check").all() };
  } finally { handle.close(); }
}
export const logicalFingerprint = (contents: ReturnType<typeof logicalDatabaseContents>): string => createHash("sha256").update(JSON.stringify(contents)).digest("hex");
if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { database: { type: "string" }, "runtime-root": { type: "string" } } });
    if (!values.database || !values["runtime-root"]) throw new TypeError("--database and --runtime-root are required");
    const contents = logicalDatabaseContents(values.database, values["runtime-root"]);
    console.log(JSON.stringify({ ...contents, fingerprint: logicalFingerprint(contents) }));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = error instanceof TypeError ? 2 : 1; }
}
