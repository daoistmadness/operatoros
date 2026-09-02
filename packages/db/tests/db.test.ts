import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { assertDatabasePath, CURRENT_SCHEMA_VERSION, inTransaction, openDatabase, PROTECTED_DATABASE_BASENAME, REQUIRED_TABLES, SCHEMA_MIGRATIONS, validateDatabase } from "../src/index";
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
  it("derives the current schema head from migration order", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS.at(-1)!);
    expect(SCHEMA_MIGRATIONS).toContain(SCHEMA_MIGRATIONS.at(-1)!);
  });

  it("derives the required-table authority from the canonical schema exports", () => {
    const declared = Object.keys(schema).filter((key) => {
      const value = (schema as Record<string, unknown>)[key];
      return value && typeof value === "object";
    });
    expect(REQUIRED_TABLES.length).toBe(82);
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
    for (const domain of ["staff_members", "dismissal_policies", "teacher_class_assignments"]) {
      expect(REQUIRED_TABLES).toContain(domain);
    }
    expect(declared.length).toBeGreaterThan(0);
  });

  function buildValidSchema(client: Database, ledgerRows: [string, string, string][]): void {
    client.run("CREATE TABLE operatoros_schema_migrations (version TEXT PRIMARY KEY, schema_fingerprint TEXT, applied_at TEXT)");
    for (const table of REQUIRED_TABLES) {
      if (table === "operatoros_schema_migrations") continue;
      client.run(`CREATE TABLE "${table}" (id INTEGER)`);
    }
    for (const trigger of [
      "trg_academic_roster_batch_session_type", "trg_academic_roster_batch_session_type_update",
      "trg_attendance_correction_audit_no_delete", "trg_attendance_correction_audit_no_update",
      "trg_attendance_follow_up_audit_no_delete", "trg_attendance_follow_up_audit_no_update",
      "trg_attendance_override_history_no_delete", "trg_attendance_override_history_no_update",
      "trg_attendance_period_audit_no_delete", "trg_attendance_period_audit_no_update",
      "trg_student_enrollment_class_history_no_delete", "trg_student_enrollment_class_history_no_update",
      "trg_student_enrollment_lifecycle_audit_no_delete", "trg_student_enrollment_lifecycle_audit_no_update",
      "trg_student_import_actions_immutable", "trg_student_import_actions_no_delete",
      "trg_student_import_batch_session_type", "trg_student_import_batch_session_type_update",
      "trg_student_master_change_history_no_delete", "trg_student_master_change_history_no_update",
      "trg_student_progression_audit_no_delete", "trg_student_progression_audit_no_update",
    ]) {
      client.run(`CREATE TRIGGER "${trigger}" BEFORE UPDATE ON operatoros_schema_migrations BEGIN SELECT RAISE(ABORT, 'append-only'); END`);
    }
    for (const [version, fingerprint, appliedAt] of ledgerRows) {
      client.run("INSERT INTO operatoros_schema_migrations VALUES (?, ?, ?)", [version, fingerprint, appliedAt]);
    }
  }

  const CURRENT_FINGERPRINT = "dd798cf0171b3221577774cc1396cb5e1d57c33d927587fc2fc0c2cd45a88b0a";

  it("accepts a current-version ledger whose timestamps are not wall-clock ordered", () => {
    const client = new Database(":memory:");
    buildValidSchema(client, [
      ["20260724_s42", "baseline-fingerprint", "2026-08-29T10:11:17.184006+00:00"],
      ["20260901_s46", CURRENT_FINGERPRINT, "2026-08-29T10:11:16.338250+00:00"],
    ]);
    try {
      expect(validateDatabase(client)).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it("fails closed when the ledger reports a newer schema than the application knows", () => {
    const client = new Database(":memory:");
    buildValidSchema(client, [
      ["20260725_s43", CURRENT_FINGERPRINT, "2026-08-29T10:00:00+00:00"],
      ["20990101_s99", "future", "2026-08-29T10:00:01+00:00"],
    ]);
    try {
      expect(() => validateDatabase(client)).toThrow("DATABASE_MIGRATION_REQUIRED");
    } finally {
      client.close();
    }
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
