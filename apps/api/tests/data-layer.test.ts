import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { inTransaction, openDatabase, validateDatabase } from "../src/db/connection";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;

function disposableDatabasePath(label: string): string {
  return `/tmp/operatoros-${label}-${process.pid}-${Date.now()}.db`;
}

function bootstrapDatabase(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "bootstrap_fresh_sqlite_database(Path(sys.argv[1]))",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:///${path}`,
      AUTH_COOKIE_SECRET: "astryx-test-only-cookie-secret-32-chars",
      OPERATOROS_ISOLATED_TEST: "true",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

describe("S4.3 data layer", () => {
  it("opens and validates a fresh disposable S4.3 database", () => {
    const path = disposableDatabasePath("fresh");
    bootstrapDatabase(path);
    try {
      const handle = openDatabase(path, { readonly: true });
      expect(handle.db).toBeDefined();
      handle.close();
    } finally {
      unlinkSync(path);
    }
  }, 30000);

  it("rejects the protected operational database before opening it", () => {
    expect(() => openDatabase("/tmp/attendance.db")).toThrow("PROTECTED_DATABASE_FORBIDDEN");
  });

  it("rolls back a failed transaction", () => {
    const client = new Database(":memory:");
    client.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    expect(() =>
      inTransaction(client, () => {
        client.run("INSERT INTO items (name) VALUES (?)", ["kept only until failure"]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(client.query("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 0 });
    client.close();
  });

  it("fails closed when a required trigger is missing", () => {
    const client = new Database(":memory:");
    client.run("CREATE TABLE operatoros_schema_migrations (version TEXT, schema_fingerprint TEXT, applied_at TEXT)");
    expect(() => validateDatabase(client)).toThrow("DATABASE_SCHEMA_INVALID");
    client.close();
  });
});
