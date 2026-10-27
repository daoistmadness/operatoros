import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { assertDatabasePath, CURRENT_SCHEMA_FINGERPRINT, CURRENT_SCHEMA_VERSION, inTransaction, openDatabase, PROTECTED_DATABASE_BASENAME, REQUIRED_TABLES, SCHEMA_MIGRATIONS, validateDatabase } from "../src/index";
import { installS47Schema, installS48EmployeeSchema, installS49SchoolUnitSchema, installS50StaffMonthlyActivitySchema, installS51UppReportsSchema, installS52StudentAdminSchema, installS53StudentVerificationSchema } from "../src/bootstrap";
import { REQUIRED_TRIGGERS } from "../src/manifest";
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
    expect(REQUIRED_TABLES.length).toBe(101);
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
    for (const domain of ["staff_members", "school_units", "staff_school_unit_assignment_versions", "staff_monthly_activity_periods", "staff_monthly_activities", "staff_monthly_activity_history", "dismissal_policies", "teacher_class_assignments", "student_identity_verifications", "student_dapodik_registrations", "student_iom_documents"]) {
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
    for (const trigger of REQUIRED_TRIGGERS) {
      client.run(`CREATE TRIGGER "${trigger}" BEFORE UPDATE ON operatoros_schema_migrations BEGIN SELECT RAISE(ABORT, 'append-only'); END`);
    }
    for (const [version, fingerprint, appliedAt] of ledgerRows) {
      client.run("INSERT INTO operatoros_schema_migrations VALUES (?, ?, ?)", [version, fingerprint, appliedAt]);
    }
  }

  it("accepts a current-version ledger whose timestamps are not wall-clock ordered", () => {
    const client = new Database(":memory:");
    installS47Schema(client);
    installS48EmployeeSchema(client);
    installS49SchoolUnitSchema(client);
    installS50StaffMonthlyActivitySchema(client);
    installS51UppReportsSchema(client);
    installS52StudentAdminSchema(client);
    installS53StudentVerificationSchema(client);
    client.run("INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) VALUES (?, NULL, ?, '{}', 'test', ?)",
      ["20260724_s42", "baseline-fingerprint", "2026-08-29T10:11:17.184006+00:00"]);
    client.run("INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) VALUES (?, ?, ?, '{}', 'test', ?)",
      [CURRENT_SCHEMA_VERSION, "20260724_s42", CURRENT_SCHEMA_FINGERPRINT, "2026-08-29T10:11:16.338250+00:00"]);
    try {
      expect(validateDatabase(client)).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it("keeps monthly activity periods and transition history immutable", () => {
    const client = new Database(":memory:");
    client.exec("PRAGMA foreign_keys=ON");
    installS47Schema(client);
    installS48EmployeeSchema(client);
    installS49SchoolUnitSchema(client);
    installS50StaffMonthlyActivitySchema(client);
    installS51UppReportsSchema(client);
    try {
      const userId = Number(client.run("INSERT INTO users (username,password_hash,role) VALUES ('synthetic-admin','hash','admin')").lastInsertRowid);
      client.run("INSERT INTO staff_members (id,full_name,normalized_name) VALUES ('synthetic-staff','Synthetic Staff','synthetic staff')");
      const unitId = Number(client.run("INSERT INTO school_units (name) VALUES ('Synthetic Unit')").lastInsertRowid);
      const periodId = Number(client.run("INSERT INTO staff_monthly_activity_periods (reporting_year,reporting_month,generated_at,generated_by_user_id) VALUES (2026,10,'2026-10-01T00:00:00.000Z',?)", [userId]).lastInsertRowid);
      const activityId = Number(client.run("INSERT INTO staff_monthly_activities (staff_member_id,school_unit_id,period_id) VALUES ('synthetic-staff',?,?)", [unitId, periodId]).lastInsertRowid);
      client.run("INSERT INTO staff_monthly_activity_history (activity_id,version,from_status,to_status,action,actor_user_id,occurred_at) VALUES (?,1,NULL,'PENDING','GENERATED',?,'2026-10-01T00:00:00.000Z')", [activityId, userId]);

      expect(() => client.run("UPDATE staff_monthly_activities SET status='COMPLETED',confirmation_date='2026-10-01',confirmed_by_user_id=?,version=2 WHERE id=?", [userId, activityId])).toThrow("STAFF_MONTHLY_ACTIVITY_HISTORY_REQUIRED");
      client.run(`INSERT INTO staff_monthly_activity_history
        (activity_id,version,from_status,to_status,from_confirmation_date,to_confirmation_date,to_confirmed_by_user_id,
         action,actor_user_id,occurred_at) VALUES (?,2,'PENDING','COMPLETED',NULL,'2026-10-01',?,'STATUS_CHANGED',?,'2026-10-02T00:00:00.000Z')`, [activityId, userId, userId]);
      client.run("UPDATE staff_monthly_activities SET status='COMPLETED',confirmation_date='2026-10-01',confirmed_by_user_id=?,version=2,updated_at='2026-10-02T00:00:00.000Z' WHERE id=? AND version=1", [userId, activityId]);
      expect(client.query("SELECT status,confirmation_date,version FROM staff_monthly_activities WHERE id=?").get(activityId)).toEqual({ status: "COMPLETED", confirmation_date: "2026-10-01", version: 2 });
      expect(() => client.run("UPDATE staff_monthly_activity_history SET reason='changed' WHERE activity_id=? AND version=2", [activityId])).toThrow("STAFF_MONTHLY_ACTIVITY_HISTORY_IMMUTABLE");
      expect(() => client.run("DELETE FROM staff_monthly_activity_history WHERE activity_id=?", [activityId])).toThrow("STAFF_MONTHLY_ACTIVITY_HISTORY_IMMUTABLE");
      expect(() => client.run("DELETE FROM staff_monthly_activities WHERE id=?", [activityId])).toThrow("STAFF_MONTHLY_ACTIVITY_IMMUTABLE");
      expect(() => client.run("DELETE FROM staff_monthly_activity_periods WHERE id=?", [periodId])).toThrow("STAFF_MONTHLY_ACTIVITY_PERIOD_IMMUTABLE");
    } finally {
      client.close();
    }
  });

  it("fails closed when the ledger reports a newer schema than the application knows", () => {
    const client = new Database(":memory:");
    buildValidSchema(client, [
      ["20260725_s43", CURRENT_SCHEMA_FINGERPRINT, "2026-08-29T10:00:00+00:00"],
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
