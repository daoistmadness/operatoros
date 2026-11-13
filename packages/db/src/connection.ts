import { createHash } from "node:crypto";
import { getTableName, is, Table } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { openSqliteConnection, type SqliteClient } from "./sqlite-client";
import {
  CURRENT_SCHEMA_FINGERPRINT,
  CURRENT_SCHEMA_VERSION,
  compareSchemaVersions,
  PROTECTED_DATABASE_BASENAME,
  REQUIRED_TRIGGERS,
} from "./manifest";

// The canonical required-table authority: every table declared by the accepted
// schema snapshot. Deriving the set from the schema exports keeps validation in
// lockstep with schema.ts; a manually maintained list would silently drift.
export const REQUIRED_TABLES: readonly string[] = Object.values(schema)
  .filter((value) => is(value, Table))
  .map(getTableName)
  .sort();

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** Reject views and virtual/shadow tables before validating or reading a database snapshot. */
export function assertOrdinarySchemaObjects(client: SqliteClient): void {
  const objects = client.query("PRAGMA main.table_list").all() as { schema: string; type: string }[];
  if (objects.some((object) => object.schema === "main" && object.type !== "table")) {
    fail("DATABASE_SCHEMA_INVALID", "unsupported SQLite schema objects are present");
  }
}

export interface DatabaseHandle {
  readonly client: SqliteClient;
  readonly db: AppDatabase;
  readonly path: string;
  reopen(): void;
  close(): void;
}

type SchemaObject = { name: string; type: string; tbl_name: string; sql: string | null };
type LedgerRow = { version: string; schema_fingerprint: string };
type LedgerColumn = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number };
const MIGRATION_LEDGER_LAYOUT = [
  { name: "version", affinity: "TEXT", notnull: 0, pk: 1 },
  { name: "predecessor", affinity: "TEXT", notnull: 0, pk: 0 },
  { name: "schema_fingerprint", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "protected_fingerprints", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "approved_by", affinity: "TEXT", notnull: 1, pk: 0 },
  { name: "applied_at", affinity: "TEXT", notnull: 1, pk: 0 },
] as const;

export function schemaFingerprint(client: SqliteClient): string {
  const objects = client.query(
    "SELECT type, name, tbl_name, COALESCE(sql, '') AS sql FROM sqlite_master " +
    "WHERE name NOT GLOB 'sqlite_*' AND NOT (type = 'table' AND name = 'operatoros_schema_migrations') ORDER BY type, name",
  ).all();
  return createHash("sha256").update(JSON.stringify(objects)).digest("hex");
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

function sqliteAffinity(type: string): string {
  const value = type.toUpperCase();
  if (value.includes("INT")) return "INTEGER";
  if (/CHAR|CLOB|TEXT/.test(value)) return "TEXT";
  if (value.includes("BLOB") || !value.trim()) return "BLOB";
  if (/REAL|FLOA|DOUB/.test(value)) return "REAL";
  return "NUMERIC";
}

export function assertMigrationLedgerShape(client: SqliteClient): void {
  const columns = client.query("PRAGMA main.table_xinfo(operatoros_schema_migrations)").all() as LedgerColumn[];
  if (columns.length !== MIGRATION_LEDGER_LAYOUT.length || columns.some((column, index) => {
    const expected = MIGRATION_LEDGER_LAYOUT[index]!;
    return column.cid !== index || column.name !== expected.name || sqliteAffinity(column.type) !== expected.affinity ||
      column.notnull !== expected.notnull || column.pk !== expected.pk || column.dflt_value !== null || column.hidden !== 0;
  })) fail("DATABASE_SCHEMA_INVALID", "migration ledger layout differs from the approved definition");
}

export function assertDatabasePath(path: string): void {
  if (path === ":memory:") return;
  if (!path.startsWith("/")) fail("DATABASE_PATH_INVALID", "an absolute SQLite path is required");
  if (path.split("/").at(-1) === PROTECTED_DATABASE_BASENAME) {
    fail("PROTECTED_DATABASE_FORBIDDEN", "the operational database is never opened by the Elysia API");
  }
}

function validateSchema(client: SqliteClient): void {
  assertOrdinarySchemaObjects(client);

  const integrity = client.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
  if (integrity?.integrity_check !== "ok") fail("DATABASE_INTEGRITY_FAILED", "PRAGMA integrity_check failed");

  const foreignKeys = client.query("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) fail("DATABASE_INTEGRITY_FAILED", "foreign-key violations exist");

  const objects = client
    .query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'")
    .all() as SchemaObject[];
  const tables = new Set(objects.filter((object) => object.type === "table").map((object) => object.name));
  const triggers = new Set(objects.filter((object) => object.type === "trigger").map((object) => object.name));
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missingTables.length > 0) {
    fail(
      "EXISTING_SCHEMA_INCOMPLETE",
      `existing database schema is incomplete for ${CURRENT_SCHEMA_VERSION}; ` +
        `missing required tables: ${missingTables.join(", ")}. ` +
        "Ordinary startup will not modify an existing database. " +
        "Identify the database, back it up, and run the approved schema reconciliation procedure before starting OperatorOS.",
    );
  }
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggers.has(trigger));
  if (missingTriggers.length > 0) fail("DATABASE_SCHEMA_INVALID", `missing triggers: ${missingTriggers.join(", ")}`);

  assertMigrationLedgerShape(client);

  // Ledger validation is version-identity based, not wall-clock ordered:
  // applied_at timestamps come from datetime.now() and a backward clock step
  // (NTP correction) can otherwise make an older migration row look like the
  // head and fail a healthy database.
  const ledgerRows = client
    .query("SELECT version, schema_fingerprint FROM operatoros_schema_migrations")
    .all() as LedgerRow[];
  const currentRow = ledgerRows.find((row) => row.version === CURRENT_SCHEMA_VERSION);
  if (!currentRow) {
    fail("DATABASE_MIGRATION_REQUIRED", `expected ${CURRENT_SCHEMA_VERSION}`);
  }
  if (ledgerRows.some((row) => compareSchemaVersions(row.version, CURRENT_SCHEMA_VERSION) === 1)) {
    fail("DATABASE_MIGRATION_REQUIRED", `database reports a schema newer than ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentRow.schema_fingerprint !== CURRENT_SCHEMA_FINGERPRINT) {
    fail("DATABASE_CHECKSUM_MISMATCH", "schema fingerprint differs from the accepted current schema");
  }
  if (schemaFingerprint(client) !== CURRENT_SCHEMA_FINGERPRINT) {
    fail("DATABASE_CHECKSUM_MISMATCH", "physical schema differs from the accepted current schema");
  }
}

export function openDatabase(path: string, options: { readonly?: boolean; validate?: boolean } = {}): DatabaseHandle {
  assertDatabasePath(path);
  let connection = openClient(path, options);
  let closed = false;
  const close = () => { if (!closed) { connection.client.close(); closed = true; } };
  const reopen = () => {
    close();
    connection = openClient(path, options);
    closed = false;
  };
  return {
    get client() { return connection.client; },
    get db() { return drizzle({ client: connection.database, schema }); },
    path,
    reopen,
    close,
  };
}

function openClient(path: string, options: { readonly?: boolean; validate?: boolean }) {
  const connection = openSqliteConnection(path, {
    readonly: options.readonly ?? false,
    fileMustExist: path !== ":memory:",
  });
  try {
    connection.client.run("PRAGMA foreign_keys = ON");
    if (options.validate !== false) validateSchema(connection.client);
    return connection;
  } catch (error) {
    connection.client.close();
    throw error;
  }
}

export function validateDatabase(client: SqliteClient): void {
  validateSchema(client);
}

export function inTransaction<T>(client: SqliteClient, callback: () => T): T {
  return client.transaction(callback).immediate();
}
