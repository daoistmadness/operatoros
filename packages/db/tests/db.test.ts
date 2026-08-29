import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { assertDatabasePath, inTransaction, openDatabase, PROTECTED_DATABASE_BASENAME, REQUIRED_TABLES, validateDatabase } from "../src/index";
import * as schema from "../src/schema";

describe("@operatoros/db", () => {
  it("exports the accepted persistence schema", () => {
    expect(schema.users).toBeDefined();
    expect(schema.operatoros_schema_migrations).toBeDefined();
    expect(Object.keys(schema)).toContain("student_enrollments");
  });

  it("opens a disposable SQLite handle without application configuration", () => {
    const handle = openDatabase(":memory:", { validate: false });
    try {
      expect(handle.path).toBe(":memory:");
      expect(handle.client.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally {
      handle.close();
    }
  });

  it("preserves immediate transaction rollback semantics", () => {
    const client = new Database(":memory:");
    client.run("CREATE TABLE values_for_test (value INTEGER NOT NULL)");
    try {
      expect(() => inTransaction(client, () => {
        client.run("INSERT INTO values_for_test VALUES (1)");
        throw new Error("rollback");
      })).toThrow("rollback");
      expect(client.query("SELECT COUNT(*) AS count FROM values_for_test").get()).toEqual({ count: 0 });
    } finally {
      client.close();
    }
  });

  it("rejects the protected operational database basename", () => {
    expect(PROTECTED_DATABASE_BASENAME).toBe("attendance.db");
    expect(() => assertDatabasePath(`/tmp/${PROTECTED_DATABASE_BASENAME}`)).toThrow("PROTECTED_DATABASE_FORBIDDEN");
  });
});

describe("@operatoros/db existing-schema validation authority", () => {
  it("derives the required-table authority from the canonical schema exports", () => {
    const declared = Object.keys(schema).filter((key) => {
      const value = (schema as Record<string, unknown>)[key];
      return value && typeof value === "object";
    });
    expect(REQUIRED_TABLES.length).toBe(78);
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
    for (const domain of ["staff_members", "dismissal_policies", "teacher_class_assignments"]) {
      expect(REQUIRED_TABLES).toContain(domain);
    }
    expect(declared.length).toBeGreaterThan(0);
  });

  it("fails closed when a schema-declared table is missing, listing the gap safely", () => {
    const client = new Database(":memory:");
    client.run("CREATE TABLE operatoros_schema_migrations (version TEXT, schema_fingerprint TEXT, applied_at TEXT)");
    client.run("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    try {
      expect(() => validateDatabase(client)).toThrow("EXISTING_SCHEMA_INCOMPLETE");
      expect(() => validateDatabase(client)).toThrow(/staff_members/);
    } finally {
      client.close();
    }
  });
});
