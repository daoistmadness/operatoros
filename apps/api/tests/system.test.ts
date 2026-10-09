import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { isEncryptedBackup, parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createResetFixture } from "./fixtures/reset";

const secret = "astryx-test-only-cookie-secret-32-chars";
const backupKey = Buffer.alloc(32, 7).toString("base64");
const targets = ["students", "student_masters", "student_enrollments", "attendance", "student_subject_grades", "academic_interventions"];

function seed(path: string): void {
  createResetFixture(path);
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-reset-${label}-${process.pid}-${Date.now()}.db`;
  const backupDir = `/tmp/operatoros-reset-backups-${label}-${process.pid}-${Date.now()}`;
  const auditDir = `/tmp/operatoros-reset-audit-${label}-${process.pid}-${Date.now()}`;
  seed(path);
  mkdirSync(backupDir, { recursive: true });
  const database = openDatabase(path);
  const backupEncryption = parseBackupEncryptionConfig({ activeKey: backupKey, activeKeyId: "test", authCookieSecret: secret });
  const auth = { authCookieSecret: secret, auditDir };
  const disabled = createApp({ databaseHandle: database, auth, backupDir, backupEncryption, destructiveOperationsEnabled: false });
  const enabled = createApp({ databaseHandle: database, auth, backupDir, backupEncryption, destructiveOperationsEnabled: true });
  const adminLogin = await enabled.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffLogin = await enabled.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, backupDir, database, disabled, enabled, admin: cookie(adminLogin), staff: cookie(staffLogin),
    cleanup() {
      database.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
      rmSync(backupDir, { recursive: true, force: true });
      rmSync(auditDir, { recursive: true, force: true });
    },
  };
}

function post(app: ReturnType<typeof createApp>, url: string, body: unknown, session?: string): Promise<Response> {
  return app.handle(new Request(`http://local${url}`, {
    method: "POST",
    headers: { ...(session ? { cookie: session, origin: "http://localhost:5173" } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function count(client: ReturnType<typeof openDatabase>["client"], table: string): number {
  return Number((client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function expectForeignKeysClean(client: ReturnType<typeof openDatabase>["client"]): void {
  expect(client.query("PRAGMA foreign_key_check").all()).toEqual([]);
}

describe("granular data reset API", () => {
  it("enforces the environment and admin gates, keeps preview read-only, and rejects a wrong phrase", async () => {
    const value = await setup("gates");
    try {
      const previewBody = { scope: "ATTENDANCE" };
      const commitBody = { scope: "ATTENDANCE", confirmation: "RESET ATTENDANCE" };
      expect((await post(value.disabled, "/api/system/data-reset/preview", previewBody, value.admin)).status).toBe(403);
      expect((await post(value.disabled, "/api/system/data-reset", commitBody, value.admin)).status).toBe(403);
      expect((await post(value.enabled, "/api/system/data-reset/preview", previewBody)).status).toBe(401);
      expect((await post(value.enabled, "/api/system/data-reset", commitBody, value.staff)).status).toBe(403);

      const before = Object.fromEntries(targets.map((table) => [table, count(value.database.client, table)]));
      const auditsBefore = count(value.database.client, "operations_audit_events");
      const sessionsBefore = count(value.database.client, "sessions");
      const invalid = await post(value.enabled, "/api/system/data-reset", { scope: "FACTORY_RESET", confirmation: "DELETE EVERYTHING" }, value.admin);
      expect(invalid.status).toBe(400);
      expect(Object.fromEntries(targets.map((table) => [table, count(value.database.client, table)]))).toEqual(before);
      expect(count(value.database.client, "sessions")).toBe(sessionsBefore);
      expect(count(value.database.client, "operations_audit_events")).toBe(auditsBefore);
      expect(readdirSync(value.backupDir)).toEqual([]);

      const previewResponse = await post(value.enabled, "/api/system/data-reset/preview", previewBody, value.admin);
      const preview = await previewResponse.json() as any;
      expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
      expect(preview).toMatchObject({ scope: "ATTENDANCE", encrypted_backup_required: true });
      expect(preview.will_delete).toContainEqual({ domain: "Attendance records", count: 1 });
      expect(preview.will_preserve).toContain("Students, student identities, and enrollments");
      expect(Object.fromEntries(targets.map((table) => [table, count(value.database.client, table)]))).toEqual(before);
      expect(count(value.database.client, "sessions")).toBe(sessionsBefore);
      expect(count(value.database.client, "operations_audit_events")).toBe(auditsBefore);
      expect(readdirSync(value.backupDir)).toEqual([]);

      const wrong = await post(value.enabled, "/api/system/data-reset", { ...commitBody, confirmation: "reset attendance" }, value.admin);
      expect(wrong.status).toBe(400);
      expect(Object.fromEntries(targets.map((table) => [table, count(value.database.client, table)]))).toEqual(before);
      expect(count(value.database.client, "sessions")).toBe(sessionsBefore);
      expect(count(value.database.client, "operations_audit_events")).toBe(auditsBefore);
      expect(readdirSync(value.backupDir)).toEqual([]);
    } finally { value.cleanup(); }
  }, 30000);

  it("resets attendance only and preserves the roster, results, and calendar", async () => {
    const value = await setup("attendance");
    try {
      const response = await post(value.enabled, "/api/system/data-reset", { scope: "ATTENDANCE", confirmation: "RESET ATTENDANCE" }, value.admin);
      const result = await response.json() as any;
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.deleted_counts).toMatchObject({ "Attendance records": 1 });
      expect(count(value.database.client, "attendance")).toBe(0);
      expect(count(value.database.client, "students")).toBe(1);
      expect(count(value.database.client, "student_enrollments")).toBe(1);
      expect(count(value.database.client, "student_subject_grades")).toBe(1);
      expect(count(value.database.client, "academic_interventions")).toBe(1);
      expect(count(value.database.client, "attendance_calendar_weekday_rules")).toBe(1);
      expectForeignKeysClean(value.database.client);
      expect(isEncryptedBackup(readFileSync(`${value.backupDir}/${result.backup_filename}`))).toBe(true);
      const audit = value.database.client.query("SELECT actor_id, occurred_at, entity_reference, operation, success, failure_code, metadata FROM operations_audit_events WHERE entity_type = 'SCHOOL_DATA' AND operation = 'RESET'").get() as any;
      expect(audit).toMatchObject({ entity_reference: "ATTENDANCE", operation: "RESET", success: 1, failure_code: null });
      expect(audit.actor_id).toBeTruthy();
      expect(JSON.parse(audit.metadata)).toMatchObject({ deleted_counts: { "Attendance records": 1 }, backup_filename: result.backup_filename });
    } finally { value.cleanup(); }
  }, 30000);

  it("resets results while preserving students and attendance", async () => {
    const value = await setup("academics");
    try {
      const response = await post(value.enabled, "/api/system/data-reset", { scope: "ACADEMIC_RESULTS", confirmation: "RESET ACADEMICS" }, value.admin);
      const result = await response.json() as any;
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.deleted_counts).toMatchObject({ "Academic results and interventions": 2 });
      expect(count(value.database.client, "student_subject_grades")).toBe(0);
      expect(count(value.database.client, "academic_interventions")).toBe(0);
      expect(count(value.database.client, "students")).toBe(1);
      expect(count(value.database.client, "student_enrollments")).toBe(1);
      expect(count(value.database.client, "attendance")).toBe(1);
      expectForeignKeysClean(value.database.client);
    } finally { value.cleanup(); }
  }, 30000);

  it("removes student-dependent data while preserving structure and administrator access", async () => {
    const value = await setup("students");
    try {
      const response = await post(value.enabled, "/api/system/data-reset", { scope: "STUDENTS", confirmation: "RESET STUDENTS" }, value.admin);
      const result = await response.json() as any;
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(count(value.database.client, "students")).toBe(0);
      expect(count(value.database.client, "student_masters")).toBe(0);
      expect(count(value.database.client, "student_enrollments")).toBe(0);
      expect(count(value.database.client, "attendance")).toBe(0);
      expect(count(value.database.client, "student_subject_grades")).toBe(0);
      expect(count(value.database.client, "academic_interventions")).toBe(0);
      expect(count(value.database.client, "academic_years")).toBe(1);
      expect(count(value.database.client, "academic_classes")).toBe(1);
      expect(count(value.database.client, "attendance_calendar_weekday_rules")).toBe(1);
      expect(result.deleted_counts).toMatchObject({
        "Attendance records": 1,
        "Academic results and interventions": 2,
        "Student identity and profile data": 3,
      });
      expect(count(value.database.client, "users")).toBe(2);
      expect((await value.enabled.handle(new Request("http://local/api/auth/me", { headers: { cookie: value.admin, origin: "http://localhost:5173" } }))).status).toBe(200);
      expectForeignKeysClean(value.database.client);
    } finally { value.cleanup(); }
  }, 30000);

  it("clears school structure but keeps login, backup settings, and a usable API", async () => {
    const value = await setup("all");
    try {
      value.database.client.run("INSERT INTO staff_members (id,full_name,normalized_name) VALUES ('synthetic-reset-staff','Synthetic Reset Employee','synthetic reset employee')");
      value.database.client.run("INSERT INTO staff_employment_history (staff_member_id,effective_date,employment_status,source,created_by) VALUES ('synthetic-reset-staff','2026-10-01','ACTIVE','MANUAL','test')");
      const response = await post(value.enabled, "/api/system/data-reset", { scope: "ALL_SCHOOL_DATA", confirmation: "RESET ALL SCHOOL DATA" }, value.admin);
      const result = await response.json() as any;
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.deleted_counts).toMatchObject({
        "Attendance and academic configuration": 2,
        "Academic classes and references": 6,
        "School report setup": 3,
      });
      for (const table of ["students", "student_masters", "student_enrollments", "attendance", "student_subject_grades", "academic_interventions", "academic_years", "academic_programs", "academic_grades", "academic_classes", "subjects", "jenjangs", "attendance_calendar_weekday_rules", "report_templates", "report_branding_configs", "staff_job_title_mappings", "staff_employment_history"]) {
        expect(count(value.database.client, table), table).toBe(0);
      }
      expect(count(value.database.client, "users")).toBe(2);
      expect(count(value.database.client, "sessions")).toBe(2);
      expect(count(value.database.client, "backup_scheduler_config")).toBe(1);
      expect(count(value.database.client, "operatoros_schema_migrations")).toBeGreaterThan(0);
      expect((await value.enabled.handle(new Request("http://local/api/auth/me", { headers: { cookie: value.admin, origin: "http://localhost:5173" } }))).status).toBe(200);
      expectForeignKeysClean(value.database.client);
    } finally { value.cleanup(); }
  }, 30000);

  it("rolls back every delete when any table rejects a delete", async () => {
    const value = await setup("rollback");
    try {
      value.database.client.run("CREATE TRIGGER reset_test_failure BEFORE DELETE ON attendance BEGIN SELECT RAISE(ABORT, 'synthetic reset failure'); END");
      const response = await post(value.enabled, "/api/system/data-reset", { scope: "ATTENDANCE", confirmation: "RESET ATTENDANCE" }, value.admin);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ detail: { code: "DATA_RESET_ROLLED_BACK" } });
      for (const table of targets) expect(count(value.database.client, table), table).toBe(1);
      const audit = value.database.client.query("SELECT entity_reference, success, failure_code, metadata FROM operations_audit_events WHERE entity_type = 'SCHOOL_DATA' AND operation = 'RESET'").get() as any;
      expect(audit).toMatchObject({ entity_reference: "ATTENDANCE", success: 0, failure_code: "DATA_RESET_ROLLED_BACK" });
      expect(JSON.parse(audit.metadata)).toMatchObject({ deleted_counts: { "Attendance records": 0 } });
      expectForeignKeysClean(value.database.client);
    } finally { value.cleanup(); }
  }, 30000);
});
