import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, CURRENT_SCHEMA_VERSION, openDatabase } from "../src";

describe("Bun S5.1 fresh bootstrap", () => {
  it("creates a startup-valid database and enforces approved identities", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-ts-bootstrap-"));
    const path = join(root, "operatoros.sqlite");
    try {
      createFreshDatabase(path);
      const handle = openDatabase(path);
      const db = handle.client;
      try {
        expect(db.query("SELECT version FROM operatoros_schema_migrations").get()).toEqual({ version: CURRENT_SCHEMA_VERSION });
        expect((db.query("PRAGMA table_info(staff_job_title_mappings)").all() as Array<{ name: string }>).map((column) => column.name)).toContain("is_teaching_role");
        expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('school_units','staff_school_unit_assignment_versions') ORDER BY name").all()).toEqual([
          { name: "school_units" }, { name: "staff_school_unit_assignment_versions" },
        ]);
        expect((db.query("PRAGMA table_info(school_units)").all() as Array<{ name: string }>).map((column) => column.name)).toContain("version");
        expect((db.query("PRAGMA table_info(student_masters)").all() as Array<{ name: string }>).map((column) => column.name)).toContain("kk");
        expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('staff_monthly_activity_periods','staff_monthly_activities','staff_monthly_activity_history') ORDER BY name").all()).toEqual([
          { name: "staff_monthly_activities" }, { name: "staff_monthly_activity_history" }, { name: "staff_monthly_activity_periods" },
        ]);
        expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('upp_monthly_reports','upp_report_versions','upp_report_submission_evidence','upp_report_history') ORDER BY name").all()).toEqual([
          { name: "upp_monthly_reports" }, { name: "upp_report_history" }, { name: "upp_report_submission_evidence" }, { name: "upp_report_versions" },
        ]);
        const unitId = Number(db.run("INSERT INTO school_units (name) VALUES ('Synthetic UPP Unit')").lastInsertRowid);
        const userId = Number(db.run("INSERT INTO users (username,password_hash,role) VALUES ('synthetic-upp-admin','synthetic-hash','admin')").lastInsertRowid);
        const reportId = Number(db.run("INSERT INTO upp_monthly_reports (school_unit_id,reporting_year,reporting_month) VALUES (?,2026,10)", [unitId]).lastInsertRowid);
        const versionId = Number(db.run(`INSERT INTO upp_report_versions (report_id,version_number,original_filename,file_sha256,file_size_bytes,uploaded_by_user_id,uploaded_at)
          VALUES (?,1,'monthly.xlsx',?,12,?,'2026-10-27T00:00:00.000Z')`, [reportId, "a".repeat(64), userId]).lastInsertRowid);
        expect(() => db.run("UPDATE upp_monthly_reports SET submission_status='SUBMITTED' WHERE id=?", [reportId])).toThrow("UPP_REPORT_INVALID_STATUS_TRANSITION");
        expect(() => db.run("UPDATE upp_report_versions SET original_filename='changed.xlsx' WHERE id=?", [versionId])).toThrow("UPP_REPORT_VERSION_IMMUTABLE");
        db.run("UPDATE upp_report_versions SET is_active=0 WHERE id=?", [versionId]);
        expect(() => db.run("DELETE FROM upp_report_versions WHERE id=?", [versionId])).toThrow("UPP_REPORT_VERSION_IMMUTABLE");
        expect(db.query("SELECT version FROM school_units").get()).toEqual({ version: 1 });
        db.run("INSERT INTO staff_job_title_mappings (raw_title, normalized_title, position_category, is_teaching_role) VALUES ('Synthetic Teacher', 'Teacher', 'TEACHING', 1)");
        expect(() => db.run("INSERT INTO staff_job_title_mappings (raw_title, normalized_title, position_category, is_teaching_role) VALUES ('Synthetic Invalid', 'Invalid', 'MADE_UP', 1)")).toThrow();
        db.run("INSERT INTO students (id, name) VALUES (1, 'Same Name'), (2, 'Same Name')");
        db.run("INSERT INTO student_masters (id, full_name, normalized_name, nipd) VALUES ('one', 'Same Name', 'same name', 'N001')");
        expect(() => db.run("INSERT INTO student_masters (id, full_name, normalized_name, nipd) VALUES ('two', 'Same Name', 'same name', 'N001')")).toThrow();
        for (const [index, status] of ["upcoming", "active", "closed"].entries()) {
          db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES (?, '2026-07-01', '2027-06-30', ?, ?)", [`Year ${index}`, status, index === 0 ? 1 : 0]);
        }
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Year 0', '2027-07-01', '2028-06-30', 'active', 0)")).toThrow();
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Another', '2027-07-01', '2028-06-30', 'active', 1)")).toThrow();
        expect(() => db.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Invalid', '2027-07-01', '2028-06-30', 'invalid', 0)")).toThrow();
      } finally {
        handle.close();
      }
      expect(() => createFreshDatabase(path)).toThrow("DATABASE_ALREADY_EXISTS");
      const reopened = openDatabase(path, { readonly: true });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces append-only school-unit assignment history and valid references", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-ts-bootstrap-"));
    const path = join(root, "operatoros.sqlite");
    try {
      createFreshDatabase(path);
      const handle = openDatabase(path);
      const db = handle.client;
      try {
        db.run("INSERT INTO staff_members (id,full_name,normalized_name) VALUES ('staff-1','Synthetic Staff','synthetic staff')");
        const firstUnit = Number(db.run("INSERT INTO school_units (name) VALUES ('Unit One')").lastInsertRowid);
        const secondUnit = Number(db.run("INSERT INTO school_units (name) VALUES ('Unit Two')").lastInsertRowid);
        const thirdUnit = Number(db.run("INSERT INTO school_units (name) VALUES ('Unit Three')").lastInsertRowid);
        const insertAssignment = (staffId: string, unitId: number, from: string, to: string | null = null) => db.run(
          "INSERT INTO staff_school_unit_assignment_versions (staff_member_id,school_unit_id,effective_from,effective_to,ptk_applicability,reason,created_by) VALUES (?,?,?,?, 'UNKNOWN','Synthetic reason','synthetic-admin')",
          [staffId, unitId, from, to],
        );

        insertAssignment("staff-1", firstUnit, "2026-10-01");
        expect(() => insertAssignment("staff-1", firstUnit, "2026-10-31")).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_OVERLAP");
        insertAssignment("staff-1", secondUnit, "2026-10-01");
        expect(() => insertAssignment("missing-staff", firstUnit, "2026-11-01")).toThrow();
        expect(() => insertAssignment("staff-1", 99999, "2026-11-01")).toThrow();
        expect(() => insertAssignment("staff-1", firstUnit, "2026-02-30")).toThrow();
        expect(() => insertAssignment("staff-1", thirdUnit, "2026-99-99")).toThrow();
        expect(() => insertAssignment("staff-1", thirdUnit, "2026-13-01")).toThrow();
        expect(() => insertAssignment("staff-1", thirdUnit, "2026-11-01", "2026-99-99")).toThrow();
        expect(() => insertAssignment("staff-1", firstUnit, "2026-09-01", "2026-08-31")).toThrow();
        expect(() => insertAssignment("staff-1", thirdUnit, "2026-11-01", "2026-11-30")).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_MUST_START_OPEN");

        const assignmentId = Number(db.query<{ id: number }, [number]>("SELECT id FROM staff_school_unit_assignment_versions WHERE school_unit_id=? ORDER BY id LIMIT 1").get(firstUnit)?.id);
        db.run("UPDATE staff_school_unit_assignment_versions SET effective_to='2026-10-30',closed_reason='Synthetic close',closed_by='synthetic-admin',closed_at=CURRENT_TIMESTAMP WHERE id=?", [assignmentId]);
        expect(() => db.run("UPDATE staff_school_unit_assignment_versions SET effective_to='2026-10-29' WHERE id=?", [assignmentId])).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE");
        expect(() => db.run("UPDATE staff_school_unit_assignment_versions SET ptk_applicability='APPLICABLE' WHERE id=?", [assignmentId])).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE");
        expect(() => db.run("DELETE FROM staff_school_unit_assignment_versions WHERE id=?", [assignmentId])).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE");
        insertAssignment("staff-1", firstUnit, "2026-10-31");

        const futureId = Number(insertAssignment("staff-1", thirdUnit, "2026-11-01").lastInsertRowid);
        db.run("UPDATE staff_school_unit_assignment_versions SET cancelled_reason='Synthetic cancellation',cancelled_by='synthetic-admin',cancelled_at=CURRENT_TIMESTAMP WHERE id=?", [futureId]);
        expect(() => db.run("UPDATE staff_school_unit_assignment_versions SET cancelled_reason='Rewritten cancellation' WHERE id=?", [futureId])).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE");
        expect(() => db.run("DELETE FROM staff_school_unit_assignment_versions WHERE id=?", [futureId])).toThrow("STAFF_SCHOOL_UNIT_ASSIGNMENT_IMMUTABLE");
        expect(() => insertAssignment("staff-1", thirdUnit, "2026-11-01")).not.toThrow();
        expect(db.query("SELECT cancelled_reason,cancelled_by FROM staff_school_unit_assignment_versions WHERE id=?").get(futureId)).toEqual({ cancelled_reason: "Synthetic cancellation", cancelled_by: "synthetic-admin" });
      } finally {
        handle.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing unknown database without changing it", () => {
    const root = mkdtempSync(join(tmpdir(), "operatoros-ts-bootstrap-"));
    const path = join(root, "operatoros.sqlite");
    try {
      const db = new Database(path);
      db.run("CREATE TABLE preserve_me (id INTEGER PRIMARY KEY)");
      db.close();
      expect(() => createFreshDatabase(path)).toThrow("DATABASE_ALREADY_EXISTS");
      const reopened = new Database(path, { readonly: true });
      expect(reopened.query("SELECT name FROM sqlite_master WHERE name = 'preserve_me'").get()).toEqual({ name: "preserve_me" });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
