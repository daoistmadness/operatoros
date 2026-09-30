import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { assertDatabasePath, schemaFingerprint, validateDatabase } from "./connection";
import { CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION } from "./manifest";

const schemaSql = readFileSync(new URL("./s47-schema.sql", import.meta.url), "utf8");
const triggerStart = schemaSql.indexOf("CREATE TRIGGER ");
if (triggerStart < 0) throw new Error("BOOTSTRAP_TRIGGERS_MISSING");

export function installS47Schema(client: Database, triggers = true): void {
  client.exec(triggers ? schemaSql : schemaSql.slice(0, triggerStart));
}

export function installS47Triggers(client: Database): void {
  client.exec(schemaSql.slice(triggerStart));
}

export function createFreshDatabase(path: string): void {
  assertDatabasePath(path);
  if (existsSync(path)) throw new Error("DATABASE_ALREADY_EXISTS");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let client: Database | undefined;
  let reserved = false;
  try {
    closeSync(openSync(path, "wx", 0o600));
    reserved = true;
    client = new Database(path, { readwrite: true, create: false });
    client.exec("PRAGMA foreign_keys = ON");
    client.transaction(() => {
      installS47Schema(client!);
      if (schemaFingerprint(client!) !== CURRENT_SCHEMA_FINGERPRINT) throw new Error("BOOTSTRAP_SCHEMA_MISMATCH");
      client!.run(
        "INSERT INTO operatoros_schema_migrations " +
        "(version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) " +
        "VALUES (?, NULL, ?, '{}', 'TS_FRESH_BOOTSTRAP', ?)",
        [CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_FINGERPRINT, new Date().toISOString()],
      );
      validateDatabase(client!);
    }).immediate();
  } catch (error) {
    client?.close();
    if (reserved) rmSync(path, { force: true });
    throw error;
  }
  client.close();
}
