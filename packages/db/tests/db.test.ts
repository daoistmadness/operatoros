import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { assertDatabasePath, inTransaction, openDatabase, PROTECTED_DATABASE_BASENAME } from "../src/index";
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
