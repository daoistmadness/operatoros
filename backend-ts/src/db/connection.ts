import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import {
  CURRENT_SCHEMA_FINGERPRINT,
  CURRENT_SCHEMA_VERSION,
  PROTECTED_DATABASE_BASENAME,
  REQUIRED_TABLES,
  REQUIRED_TRIGGERS,
} from "./manifest";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly client: Database;
  readonly db: AppDatabase;
  readonly path: string;
  reopen(): void;
  close(): void;
}

type SchemaObject = { name: string; type: string; tbl_name: string; sql: string | null };
type LedgerRow = { version: string; schema_fingerprint: string };

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

export function assertDatabasePath(path: string): void {
  if (path === ":memory:") return;
  if (!path.startsWith("/")) fail("DATABASE_PATH_INVALID", "an absolute SQLite path is required");
  if (path.split("/").at(-1) === PROTECTED_DATABASE_BASENAME) {
    fail("PROTECTED_DATABASE_FORBIDDEN", "the operational database is never opened by backend-ts");
  }
}

function validateSchema(client: Database): void {
  const integrity = client.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
  if (integrity?.integrity_check !== "ok") fail("DATABASE_INTEGRITY_FAILED", "PRAGMA integrity_check failed");

  const foreignKeys = client.query("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) fail("DATABASE_INTEGRITY_FAILED", "foreign-key violations exist");

  const objects = client
    .query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all() as SchemaObject[];
  const tables = new Set(objects.filter((object) => object.type === "table").map((object) => object.name));
  const triggers = new Set(objects.filter((object) => object.type === "trigger").map((object) => object.name));
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missingTables.length > 0) fail("DATABASE_SCHEMA_INVALID", `missing tables: ${missingTables.join(", ")}`);
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggers.has(trigger));
  if (missingTriggers.length > 0) fail("DATABASE_SCHEMA_INVALID", `missing triggers: ${missingTriggers.join(", ")}`);

  const ledger = client
    .query(
      "SELECT version, schema_fingerprint FROM operatoros_schema_migrations " +
        "ORDER BY applied_at DESC, version DESC LIMIT 1",
    )
    .get() as LedgerRow | null;
  if (!ledger || ledger.version !== CURRENT_SCHEMA_VERSION) {
    fail("DATABASE_MIGRATION_REQUIRED", `expected ${CURRENT_SCHEMA_VERSION}`);
  }
  if (ledger.schema_fingerprint !== CURRENT_SCHEMA_FINGERPRINT) {
    fail("DATABASE_CHECKSUM_MISMATCH", "schema fingerprint differs from the accepted S4.3 baseline");
  }
}

export function openDatabase(path: string, options: { readonly?: boolean; validate?: boolean } = {}): DatabaseHandle {
  assertDatabasePath(path);
  let client = openClient(path, options);
  let closed = false;
  const close = () => { if (!closed) { client.close(); closed = true; } };
  const reopen = () => {
    close();
    client = openClient(path, options);
    closed = false;
  };
  return {
    get client() { return client; },
    get db() { return drizzle({ client, schema }); },
    path,
    reopen,
    close,
  };
}

function openClient(path: string, options: { readonly?: boolean; validate?: boolean }): Database {
  const client = new Database(path, options.readonly ? { readonly: true } : { readwrite: true, create: false });
  try {
    client.run("PRAGMA foreign_keys = ON");
    if (options.validate !== false) validateSchema(client);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function validateDatabase(client: Database): void {
  validateSchema(client);
}

export function inTransaction<T>(client: Database, callback: () => T): T {
  return client.transaction(callback).immediate();
}
