import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, migrateExistingDatabase, openDatabase, schemaFingerprint } from "../src";
import * as schema from "../src/schema";
import { S47_SCHEMA_FINGERPRINT } from "../src/manifest";

const s47Sql = readFileSync(new URL("../src/s47-schema.sql", import.meta.url), "utf8");
const expectedKeys: { attendance: string[][]; attendance_import_rows: string[][]; attendance_overrides: string[][]; attendance_periods: string[][] } = {
  attendance: [["student_id", "date"]],
  attendance_import_rows: [["batch_id", "student_identifier", "attendance_date"]],
  attendance_overrides: [["attendance_id"]],
  attendance_periods: [["attendance_date"]],
};

function withDatabases(run: (root: string, freshPath: string, migratedPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "operatoros-attendance-unique-"));
  try {
    run(root, join(root, "fresh.sqlite"), join(root, "migrated.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createMigratedS47(path: string): void {
  const source = new Database(path, { create: true });
  source.exec("PRAGMA foreign_keys = ON");
  source.exec(s47Sql);
  expect(schemaFingerprint(source)).toBe(S47_SCHEMA_FINGERPRINT);
  source.run(
    "INSERT INTO operatoros_schema_migrations (version, predecessor, schema_fingerprint, protected_fingerprints, approved_by, applied_at) VALUES ('20260929_s47', '20260901_s46', ?, '{}', 'SYNTHETIC_FIXTURE', '2026-09-30T00:00:00Z')",
    [S47_SCHEMA_FINGERPRINT],
  );
  source.close();
  expect(migrateExistingDatabase(path)).toBe("MIGRATED");
}

function physicalUniqueKeys(db: Database): string[][][] {
  return Object.entries(expectedKeys).map(([table]) => {
    const indexes = db.query(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number }[];
    return indexes
      .filter((index) => index.unique === 1)
      .map((index) => (db.query(`PRAGMA index_info("${index.name}")`).all() as { seqno: number; name: string }[])
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name))
      .sort((left, right) => left.join("|").localeCompare(right.join("|")));
  });
}

function assertHistoricalNames(db: Database): void {
  const tableDefinitions = db.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('attendance', 'attendance_import_rows')").all() as { name: string; sql: string }[];
  expect(tableDefinitions.find((table) => table.name === "attendance")?.sql).toMatch(/CONSTRAINT _student_date_uc UNIQUE\s*\(student_id, date\)/);
  expect(tableDefinitions.find((table) => table.name === "attendance_import_rows")?.sql).toMatch(/CONSTRAINT uq_attendance_import_batch_key UNIQUE\s*\(batch_id, student_identifier, attendance_date\)/);
  expect(db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?) ORDER BY name").all("ix_attendance_overrides_attendance_id", "ix_attendance_periods_attendance_date"))
    .toEqual([{ name: "ix_attendance_overrides_attendance_id" }, { name: "ix_attendance_periods_attendance_date" }]);
}

function declaredUniqueKeys(table: SQLiteTable): string[][] {
  const config = getTableConfig(table);
  return [
    ...config.indexes.filter((index) => index.config.unique).map((index) => index.config.columns.map((column) => "name" in column ? column.name : "<expression>")),
    ...config.uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name)),
  ]
    .sort((left, right) => left.join("|").localeCompare(right.join("|")));
}

function assertEnforced(db: Database): void {
  db.run("INSERT INTO students (id, name) VALUES (1, 'Synthetic One'), (2, 'Synthetic Two')");
  db.run("INSERT INTO attendance (student_id, date, late_duration, late_source, is_absent, status) VALUES (1, '2026-09-01', 0, 'none', 0, 'present')");
  expect(() => db.run("INSERT INTO attendance (student_id, date, late_duration, late_source, is_absent, status) VALUES (1, '2026-09-01', 10, 'manual', 0, 'late')")).toThrow(/UNIQUE constraint failed/);
  expect(db.query("SELECT status, late_duration FROM attendance WHERE student_id = 1 AND date = '2026-09-01'").get()).toEqual({ status: "present", late_duration: 0 });
  db.run("INSERT INTO attendance (student_id, date, late_duration, late_source, is_absent, status) VALUES (2, '2026-09-01', 0, 'none', 0, 'present'), (1, '2026-09-02', 0, 'none', 0, 'present')");

  db.run("INSERT INTO attendance_import_batches (id, filename, checksum, uploaded_by) VALUES ('batch-1', 'synthetic.xlsx', 'synthetic-checksum', 'test')");
  db.run("INSERT INTO attendance_import_batches (id, filename, checksum, uploaded_by) VALUES ('batch-2', 'synthetic-2.xlsx', 'synthetic-checksum-2', 'test')");
  db.run("INSERT INTO attendance_import_rows (batch_id, student_identifier, attendance_date, classification) VALUES ('batch-1', '001', '2026-09-01', 'NEW')");
  expect(() => db.run("INSERT INTO attendance_import_rows (batch_id, student_identifier, attendance_date, classification) VALUES ('batch-1', '001', '2026-09-01', 'CONFLICT')")).toThrow(/UNIQUE constraint failed/);
  expect(db.query("SELECT classification FROM attendance_import_rows WHERE batch_id = 'batch-1' AND student_identifier = '001'").get()).toEqual({ classification: "NEW" });
  db.run("INSERT INTO attendance_import_rows (batch_id, student_identifier, attendance_date, classification) VALUES ('batch-1', '001', '2026-09-02', 'NEW'), ('batch-1', '002', '2026-09-01', 'NEW'), ('batch-2', '001', '2026-09-01', 'NEW'), ('batch-1', NULL, NULL, 'INVALID'), ('batch-1', NULL, NULL, 'INVALID')");

  const attendanceId = (db.query("SELECT id FROM attendance WHERE student_id = 1 AND date = '2026-09-01'").get() as { id: number }).id;
  db.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'present', 'izin', 'Synthetic review', 'test', '2026-09-01')", [attendanceId]);
  expect(() => db.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'present', 'sakit', 'Replacement attempt', 'test', '2026-09-02')", [attendanceId])).toThrow(/UNIQUE constraint failed/);
  expect(db.query("SELECT override_status, note FROM attendance_overrides WHERE attendance_id = ?").get(attendanceId)).toEqual({ override_status: "izin", note: "Synthetic review" });
  const secondAttendanceId = (db.query("SELECT id FROM attendance WHERE student_id = 2 AND date = '2026-09-01'").get() as { id: number }).id;
  db.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'present', 'izin', 'Another row', 'test', '2026-09-01')", [secondAttendanceId]);

  db.run("INSERT INTO attendance_periods (attendance_date) VALUES ('2026-09-01')");
  expect(() => db.run("INSERT INTO attendance_periods (attendance_date, status) VALUES ('2026-09-01', 'FINALIZED')")).toThrow(/UNIQUE constraint failed/);
  expect(db.query("SELECT status FROM attendance_periods WHERE attendance_date = '2026-09-01'").get()).toEqual({ status: "OPEN" });
  db.run("INSERT INTO attendance_periods (attendance_date) VALUES ('2026-09-02')");
}

describe("attendance uniqueness authority", () => {
  it("declares the four S47 keys in Drizzle with their historical names", () => {
    expect(declaredUniqueKeys(schema.attendance)).toEqual(expectedKeys.attendance);
    expect(declaredUniqueKeys(schema.attendance_import_rows)).toEqual(expectedKeys.attendance_import_rows);
    expect(declaredUniqueKeys(schema.attendance_overrides)).toEqual(expectedKeys.attendance_overrides);
    expect(declaredUniqueKeys(schema.attendance_periods)).toEqual(expectedKeys.attendance_periods);
    expect(getTableConfig(schema.attendance).uniqueConstraints.map((constraint) => constraint.name)).toEqual(["_student_date_uc"]);
    expect(getTableConfig(schema.attendance_import_rows).uniqueConstraints.map((constraint) => constraint.name)).toEqual(["uq_attendance_import_batch_key"]);
    expect(getTableConfig(schema.attendance_overrides).indexes.filter((index) => index.config.unique).map((index) => index.config.name)).toEqual(["ix_attendance_overrides_attendance_id"]);
    expect(getTableConfig(schema.attendance_periods).indexes.filter((index) => index.config.unique).map((index) => index.config.name)).toEqual(["ix_attendance_periods_attendance_date"]);
    expect(schema.attendance_import_rows.batch_id.notNull).toBe(true);
    expect(schema.attendance_import_rows.student_identifier.notNull).toBe(false);
    expect(schema.attendance_import_rows.attendance_date.notNull).toBe(false);
  });

  it("enforces the invariants in fresh and S47-migrated disposable databases", () => withDatabases((_, freshPath, migratedPath) => {
    createFreshDatabase(freshPath);
    createMigratedS47(migratedPath);
    const fresh = openDatabase(freshPath);
    const migrated = openDatabase(migratedPath);
    try {
      expect(physicalUniqueKeys(fresh.client)).toEqual(Object.values(expectedKeys));
      expect(physicalUniqueKeys(migrated.client)).toEqual(Object.values(expectedKeys));
      expect(physicalUniqueKeys(migrated.client)).toEqual(physicalUniqueKeys(fresh.client));
      expect(schemaFingerprint(migrated.client)).toBe(schemaFingerprint(fresh.client));
      assertHistoricalNames(fresh.client);
      assertHistoricalNames(migrated.client);
      assertEnforced(fresh.client);
      assertEnforced(migrated.client);
    } finally {
      fresh.close();
      migrated.close();
    }
  }));

  it("reports duplicate groups and rolls back a conflicting SQLite uniqueness migration", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, date TEXT NOT NULL)");
      db.run("INSERT INTO attendance (id, student_id, date) VALUES (1, 71, '2026-09-01'), (2, 71, '2026-09-01')");
      const duplicates = db.query("SELECT student_id, date, COUNT(*) AS record_count FROM attendance GROUP BY student_id, date HAVING COUNT(*) > 1").all();
      expect(duplicates).toEqual([{ student_id: 71, date: "2026-09-01", record_count: 2 }]);
      const before = db.query("SELECT * FROM attendance ORDER BY id").all();
      expect(() => db.transaction(() => db.exec("CREATE UNIQUE INDEX _student_date_uc ON attendance (student_id, date)")).immediate()).toThrow(/UNIQUE constraint failed/);
      expect(db.query("SELECT * FROM attendance ORDER BY id").all()).toEqual(before);
      expect(db.query("PRAGMA index_list('attendance')").all()).toEqual([]);
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });
});
