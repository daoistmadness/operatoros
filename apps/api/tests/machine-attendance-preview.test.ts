import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { appendRow, createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { python } from "./python";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-machine-preview-test-cookie-secret-32";
const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Absent", "Lembur", "Pengecualian", "week"];

function seed(path: string, includeCutoffPolicy = true): void {
  const script = [
    "from pathlib import Path", "import sqlite3, sys", "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database", "from argon2 import PasswordHasher", "path=Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db=sqlite3.connect(path); ph=PasswordHasher()",
    "db.execute(\"INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)\", ('preview-admin',ph.hash('preview-admin-pass-1'),'admin'))",
    "db.execute(\"INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-preview','2026-01-01','2026-12-31','active',1)\")",
    "db.execute(\"INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)\")",
    "program_id=db.execute(\"INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'Synthetic Program',1)\").lastrowid; grade_id=db.execute(\"INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,?,'Synthetic Grade',1,1)\",(program_id,)).lastrowid",
    "classes={name:db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,?,?,?,1)\",(grade_id,name,name)).lastrowid for name in ('7A','7B','7C','P1A','P1B')}",
    "db.execute(\"INSERT INTO jenjang_config (jenjang,cutoff_time,updated_at) VALUES ('SMP','07:30',CURRENT_TIMESTAMP)\")",
    "if sys.argv[2] == 'true': db.execute(\"INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (1,'2026-01-01','07:30','BACKFILL_ASSUMED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic test cutoff')\")",
    "students=[(123,'Synthetic One','SMP','7A'),(456,'Synthetic Two','SMP','7A'),(999,'Synthetic Three','SMP','7B'),(1000,'Synthetic Four','SMP','7C')]",
    "for sid,name,jenjang,klass in students:", "    db.execute(\"INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)\",(sid,name,jenjang,klass)); db.execute(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')\",(f'master-{sid}',name,name.lower()))",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-123',123,'00123','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-456',456,'00456','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-999',999,'00999','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-1000',1000,'00999','secondary_machine','2026-01-01',1)\")",
    "for sid,master,klass in [(123,'master-123','7A'),(456,'master-456','7A'),(999,'master-999','7B'),(1000,'master-1000','7C')]: db.execute(\"INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,1,?,?,1,'2026-01-01','ACTIVE')\",(sid,master,classes[klass],klass))",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,1,'EXPECTED')\")",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,5,'EXPECTED')\")",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,6,'EXPECTED')\")",
    "for weekday in (2,3,4): db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,?,'EXPECTED')\", (weekday,))",
    "db.execute(\"INSERT INTO attendance_calendar_exceptions (academic_year_id,jenjang_id,date,expectation,reason,created_by) VALUES (1,1,'2026-04-06','NOT_EXPECTED','SCHOOL_BREAK','preview-admin')\")",
    "db.execute(\"INSERT INTO academic_term_configs (academic_year_id,term_number,label,start_date,end_date) VALUES (1,1,'Term 1','2026-04-01','2026-04-30')\")",
    "db.commit(); db.close()",
  ].join("\n");
  const result = Bun.spawnSync([python, "-c", script, path, String(includeCutoffPolicy)], { cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function fixture(): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-preview-test" });
  const sheet = book.addWorksheet("Synthetic Machine Export");
  appendRow(sheet, headers);
  [
    ["00123", "Synthetic One", "03/04/2026", "07:00", "15:00", "00:10", "", "", "", "Friday"],
    ["00123", "Synthetic One", "04/04/2026", "", "", "", "", "", "", "Saturday"],
    ["00456", "Synthetic Two", "06/04/2026", "", "", "", "", "", "", "Monday"],
    ["00123", "Synthetic One", "05/04/2026", "07:05", "15:00", "", "", "", "", "Sunday"],
    ["88888", "Not Mapped", "03/04/2026", "07:10", "15:00", "", "", "", "", "Friday"],
    ["00999", "Ambiguous", "03/04/2026", "07:10", "15:00", "", "", "", "", "Friday"],
  ].forEach((row) => appendRow(sheet, row));
  return writeXlsxWorkbook(book);
}

async function twoEligibleFixture(): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-controlled-import-test" });
  const sheet = book.addWorksheet("Synthetic Machine Export");
  appendRow(sheet, headers);
  [["00123", "Synthetic One", "03/04/2026", "07:00", "15:00", "", "", "", "", "Friday"], ["00456", "Synthetic Two", "03/04/2026", "07:05", "15:00", "", "", "", "", "Friday"]].forEach((row) => appendRow(sheet, row));
  return writeXlsxWorkbook(book);
}

async function rowsFixture(rows: unknown[][]): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-canonicalization-test" });
  const sheet = book.addWorksheet("Synthetic Machine Export");
  appendRow(sheet, headers);
  rows.forEach((row) => appendRow(sheet, row));
  return writeXlsxWorkbook(book);
}

async function identityFixture(identifier: string, name: string): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-identity-onboarding-test" });
  const sheet = book.addWorksheet("Synthetic Machine Export");
  appendRow(sheet, headers);
  appendRow(sheet, [identifier, name, "03/04/2026", "07:00", "15:00", "", "", "", "", "Friday"]);
  return writeXlsxWorkbook(book);
}

async function setup(label: string, includeCutoffPolicy = true) {
  const path = `/tmp/operatoros-machine-preview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path, includeCutoffPolicy);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-machine-preview-audit-${process.pid}` } });
  const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "preview-admin", password: "preview-admin-pass-1" }) }));
  const cookie = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!cookie) throw new Error("session cookie missing");
  return { path, database, app, cookie: `astyx_session=${cookie}` };
}

describe("attendance machine preview", () => {
  it("reconciles exact machine evidence with calendar authority without mutating business data", async () => {
    const value = await setup("preview");
    try {
      const before = Object.fromEntries(["attendance", "students", "student_enrollments", "attendance_import_batches", "attendance_import_rows"].map((table) => [table, (value.database.client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count]));
      const form = new FormData();
      form.append("file", new File([await fixture()], "synthetic-machine.xlsx"));
      form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const response = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.previewOnly).toBe(true);
      expect(body.summary).toMatchObject({ matchedStudents: 2, unmappedStudents: 1, ambiguousStudents: 1, scanFacts: 4, expectedNoScan: 1, notExpectedNoScan: 1 });
      const find = (identifier: string, date: string) => body.rows.find((item: any) => item.machineStudentIdentifier === identifier && item.date === date);
      expect(find("00123", "2026-04-04")).toMatchObject({ machineEvidence: "NO_SCAN", expectation: { status: "EXPECTED" }, reconciliationState: "NO_SCAN_EXPECTED", applyClassification: "NOOP_NO_CHECK_IN", canonicalAttendance: "NO_CHECK_IN" });
      expect(find("00456", "2026-04-06")).toMatchObject({ machineEvidence: "NO_SCAN", expectation: { status: "NOT_EXPECTED" }, reconciliationState: "NO_SCAN_NOT_EXPECTED", applyClassification: "NOOP_NOT_EXPECTED", qualityWarnings: expect.arrayContaining(["NON_EXPECTED_DATE"]) });
      expect(find("88888", "2026-04-03")).toMatchObject({ matchingState: "UNMAPPED", reconciliationState: "UNMAPPED" });
      expect(find("00999", "2026-04-03")).toMatchObject({ matchingState: "AMBIGUOUS", reconciliationState: "AMBIGUOUS" });
      expect(find("00123", "2026-04-05")).toMatchObject({ expectation: { status: "UNKNOWN" }, reconciliationState: "EXPECTATION_UNKNOWN" });
      expect(find("00456", "2026-04-06")).toMatchObject({ resolution: { class: "CALENDAR_RESOLUTION", target: { type: "CALENDAR_RESOLUTION", path: "/attendance/calendar?academic_year_id=1&jenjang_id=1&date=2026-04-06" } } });
      expect(find("88888", "2026-04-03")).toMatchObject({ resolution: { class: "STUDENT_DATA_RESOLUTION", target: { type: "STUDENT_DATA_RESOLUTION", path: "/students" } } });
      expect(find("00123", "2026-04-04")).toMatchObject({ resolution: { class: "NO_ACTION_REQUIRED", target: null } });
      for (const [table, count] of Object.entries(before)) expect((value.database.client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count).toBe(count);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("maps existing attendance and override conflicts to canonical review workflows", async () => {
    const value = await setup("resolution");
    try {
      value.database.client.run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (123, '2026-04-03', '07:00', '15:00', 0, 'manual', 0, 'sakit')");
      const form = new FormData(); form.append("file", new File([await fixture()], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const response = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const body = await response.json() as any;
      expect(body.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "CONFLICT_EXISTING_ATTENDANCE", existingAttendance: { baseStatus: "sakit", effectiveStatus: "sakit", hasOverride: false }, resolution: { class: "ATTENDANCE_REVIEW", target: { type: "ATTENDANCE_REVIEW", path: "/attendance/daily?date=2026-04-03&academic_year_id=1&class_id=1" } } });
      value.database.client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES ((SELECT id FROM attendance WHERE student_id = 123 AND date = '2026-04-03'), 'sakit', 'izin', 'Synthetic review', 'preview-admin', CURRENT_TIMESTAMP)");
      const second = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const secondBody = await second.json() as any;
      expect(secondBody.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "CONFLICT_EXISTING_OVERRIDE", existingAttendance: { baseStatus: "sakit", effectiveStatus: "izin", hasOverride: true }, resolution: { class: "ATTENDANCE_CORRECTION", target: { type: "ATTENDANCE_CORRECTION", path: "/attendance/override-review?academic_year_id=1&class_id=1&date_from=2026-04-03&date_to=2026-04-03" } } });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("rejects unsupported physical files and remains authorization protected", async () => {
    const value = await setup("safety");
    try {
      const anonymousForm = new FormData(); anonymousForm.append("file", new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "legacy.xlsx")); anonymousForm.append("academic_year_id", "1"); anonymousForm.append("jenjang_id", "1");
      const anonymous = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", body: anonymousForm }));
      expect(anonymous.status).toBe(401);
      const form = new FormData(); form.append("file", new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "legacy.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const response = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ detail: "Only Excel OOXML .xlsx workbooks are supported." });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("retains source evidence when every row is blocked from canonical writes", async () => {
    const value = await setup("evidence-only");
    try {
      const source = await rowsFixture([["88888", "Not Mapped", "03/04/2026", "07:10", "14", "", "", "", "", "Friday"]]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-evidence-only.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.summary).toMatchObject({ eligibleCreates: 0, blocked: 1 });
      expect(previewBody.rows[0]).toMatchObject({ matchingState: "UNMAPPED", applyClassification: "BLOCKED_UNMAPPED" });
      const apply = new FormData(); apply.append("file", new File([source], "synthetic-evidence-only.xlsx")); apply.append("academic_year_id", "1"); apply.append("jenjang_id", "1"); apply.append("expected_preview_digest", previewBody.previewDigest); apply.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: apply }));
      expect(applied.status).toBe(200);
      expect((await applied.json() as any).summary).toMatchObject({ created: 0, blocked: 1 });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count).toBe(0);
      const retained = value.database.client.query("SELECT source_row, classification, proposed_change FROM attendance_import_rows").get() as any;
      expect(retained).toMatchObject({ source_row: 2, classification: "CONFLICT" });
      expect(JSON.parse(retained.proposed_change)).toMatchObject({ classification: "BLOCKED_UNMAPPED", source_sheet: "Synthetic Machine Export", source_rows: [2], source_evidence: [{ values: { "No. ID": "88888", "Scan Masuk": "07:10", "Scan Pulang": "14" } }] });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("imports a valid arrival with canonical lateness and retains row provenance transactionally", async () => {
    const value = await setup("apply");
    try {
      const source = await fixture();
      const form = new FormData();
      form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      expect(previewBody.summary).toMatchObject({ eligibleCreates: 1, alreadyCanonical: 0, conflicts: 0 });
      expect(previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "ELIGIBLE_CREATE", canonicalStatus: "on-time", canonicalAttendance: "PRESENT", punctuality: "ON_TIME", lateMinutes: 0, qualityWarnings: ["SOURCE_LATENESS_DISAGREEMENT"] });
      const applyForm = new FormData();
      applyForm.append("file", new File([source], "synthetic-machine.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      const appliedBody = await applied.json() as any;
      expect(appliedBody).toMatchObject({ status: "APPLIED", summary: { rowsInspected: 6, created: 1, alreadyCanonical: 0 } });
      expect(value.database.client.query("SELECT status, check_in, check_out, late_duration FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ status: "on-time", check_in: "07:00", check_out: "15:00", late_duration: 0 });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE import_session_id = ? AND operation = 'MACHINE_IMPORT_CREATE'").get(appliedBody.batchId) as any).count).toBe(1);
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 88888").get() as any).count).toBe(0);
      const unresolvedEvidence = value.database.client.query("SELECT classification, proposed_change FROM attendance_import_rows WHERE batch_id = ? AND student_identifier = '88888'").get(appliedBody.batchId) as any;
      expect(unresolvedEvidence.classification).toBe("CONFLICT");
      expect(JSON.parse(unresolvedEvidence.proposed_change)).toMatchObject({ classification: "BLOCKED_UNMAPPED", source_rows: [6], attendance: "NOT_COMMITTED" });
      const retained = value.database.client.query("SELECT source_row, proposed_change FROM attendance_import_rows WHERE batch_id = ? AND student_identifier = '00123' AND attendance_date = '2026-04-03'").get(appliedBody.batchId) as any;
      expect(retained.source_row).toBe(2);
      expect(JSON.parse(retained.proposed_change)).toMatchObject({ classification: "ELIGIBLE_CREATE", source_rows: [2], source_evidence: [{ sourceRow: 2, values: { "Scan Masuk": "07:00", "Terlambat": "00:10" } }], attendance: "PRESENT", punctuality: "ON_TIME", late_minutes: 0 });

      const secondPreviewForm = new FormData();
      secondPreviewForm.append("file", new File([source], "synthetic-machine.xlsx")); secondPreviewForm.append("academic_year_id", "1"); secondPreviewForm.append("jenjang_id", "1");
      const secondPreview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: secondPreviewForm }));
      const secondBody = await secondPreview.json() as any;
      expect(secondBody.summary.alreadyCanonical).toBe(1);
      const secondApplyForm = new FormData();
      secondApplyForm.append("file", new File([source], "synthetic-machine.xlsx")); secondApplyForm.append("academic_year_id", "1"); secondApplyForm.append("jenjang_id", "1"); secondApplyForm.append("expected_preview_digest", secondBody.previewDigest); secondApplyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const secondApplied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: secondApplyForm }));
      expect(secondApplied.status).toBe(200);
      expect((await secondApplied.json() as any).summary).toMatchObject({ created: 0, alreadyCanonical: 1 });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get() as any).count).toBe(1);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("derives machine lateness from the configured cutoff instead of the workbook value", async () => {
    const value = await setup("cutoff");
    try {
      value.database.client.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (1,'2026-04-03','06:50','RECORDED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic cutoff update')");
      const source = await fixture();
      const form = new FormData();
      form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      // 07:00 arrival against a 06:50 cutoff is 10 minutes late by the canonical rule.
      expect(previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "ELIGIBLE_CREATE", canonicalStatus: "late" });
      const applyForm = new FormData();
      applyForm.append("file", new File([source], "synthetic-machine.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      expect(value.database.client.query("SELECT status, late_duration, late_source FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ status: "late", late_duration: 10, late_source: "calculated" });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("blocks a valid arrival when canonical jenjang cutoff is unavailable", async () => {
    const value = await setup("missing-cutoff", false);
    try {
      value.database.client.run("DELETE FROM jenjang_config WHERE jenjang = 'SMP'");
      const source = await identityFixture("00123", "Synthetic One");
      const form = new FormData(); form.append("file", new File([source], "synthetic-no-cutoff.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.rows[0]).toMatchObject({ applyClassification: "BLOCKED_CUTOFF_UNAVAILABLE", canonicalAttendance: "NOT_COMMITTED", canonicalStatus: null, punctuality: "N/A", qualityWarnings: expect.arrayContaining(["CUTOFF_UNCONFIGURED"]) });
      const apply = new FormData(); apply.append("file", new File([source], "synthetic-no-cutoff.xlsx")); apply.append("academic_year_id", "1"); apply.append("jenjang_id", "1"); apply.append("expected_preview_digest", previewBody.previewDigest); apply.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: apply }));
      expect(applied.status).toBe(200);
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get() as any).count).toBe(0);
      const provenance = value.database.client.query("SELECT proposed_change FROM attendance_import_rows").get() as any;
      expect(JSON.parse(provenance.proposed_change)).toMatchObject({ classification: "BLOCKED_CUTOFF_UNAVAILABLE", source_evidence: [{ values: { "Scan Masuk": "07:00" } }] });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("resolves retired Device IDs for their effective historical dates", async () => {
    const value = await setup("retired-identity");
    try {
      value.database.client.run("UPDATE student_device_identities SET is_active = 0, effective_to = '2026-04-15' WHERE device_identifier = '00123'");
      const source = await identityFixture("00123", "Synthetic One");
      const form = new FormData(); form.append("file", new File([source], "synthetic-retired-id.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const response = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const body = await response.json() as any;
      expect(body.rows[0]).toMatchObject({ matchingState: "MATCHED", student: { id: 123 }, historicalClass: "7A", applyClassification: "ELIGIBLE_CREATE" });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("keeps a valid Scan Masuk when secondary fields and Scan Pulang are malformed", async () => {
    const value = await setup("bad-secondary");
    try {
      value.database.client.run("INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (1,'2026-04-03','07:15','RECORDED','TEST_SEED',CURRENT_TIMESTAMP,'Synthetic cutoff update')");
      const source = await rowsFixture([
        ["00123", "Synthetic One", "03/04/2026", "07:21", "14", "14", "14", "14", "14", "Friday"],
        ["00456", "Synthetic Two", "03/04/2026", "14", "14:05", "00:03", "", "", "", "Friday"],
      ]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-secondary.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      const goodIn = previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00123");
      const sentinelIn = previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00456");
      expect(goodIn).toMatchObject({ applyClassification: "ELIGIBLE_CREATE", canonicalAttendance: "PRESENT", punctuality: "LATE", checkIn: "07:21", checkOut: null, lateMinutes: 6, qualityWarnings: expect.arrayContaining(["INVALID_SCAN_OUT", "INVALID_SOURCE_LATENESS", "INVALID_ABSENT_FIELD", "INVALID_OVERTIME"]) });
      expect(sentinelIn).toMatchObject({ applyClassification: "NOOP_NO_CHECK_IN", canonicalAttendance: "NO_CHECK_IN", punctuality: "N/A", checkIn: null, checkOut: "14:05", qualityWarnings: expect.arrayContaining(["INVALID_SCAN_IN", "MISSING_SCAN_IN"]) });
      expect(previewBody.summary).toMatchObject({ eligibleCreates: 1, blocked: 0 });
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-secondary.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      expect(value.database.client.query("SELECT status, check_in, check_out, late_duration FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ status: "late", check_in: "07:21", check_out: null, late_duration: 6 });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 456 AND date = '2026-04-03'").get() as any).count).toBe(0);
      const retained = value.database.client.query("SELECT proposed_change FROM attendance_import_rows WHERE batch_id = ? AND student_identifier = '00123'").get((await applied.json() as any).batchId) as any;
      expect(JSON.parse(retained.proposed_change)).toMatchObject({ source_evidence: [{ values: { "Scan Masuk": "07:21", "Scan Pulang": "14", "Terlambat": "14", "Absent": "14", "Lembur": "14", "Pengecualian": "14" } }], punctuality: "LATE", late_minutes: 6 });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("merges compatible rows to the earliest check-in and latest check-out while retaining each source row", async () => {
    const value = await setup("duplicates");
    try {
      const source = await rowsFixture([
        ["00123", "Synthetic One", "03/04/2026", "07:12", "13:50", "", "", "", "", "Friday"],
        ["00123", "Synthetic One", "03/04/2026", "07:10", "14:10", "", "", "", "", "Friday"],
        ["00123", "Synthetic One", "03/04/2026", "07:14", "14:05", "", "", "", "", "Friday"],
      ]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-duplicates.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.rows[0]).toMatchObject({ sourceRows: [2, 3, 4], machineEvidence: "MULTIPLE_SCANS", checkIn: "07:10", checkOut: "14:10", canonicalAttendance: "PRESENT", applyClassification: "ELIGIBLE_CREATE", qualityWarnings: expect.arrayContaining(["DUPLICATE_SOURCE_ROWS_MERGED"]) });
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-duplicates.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      const batchId = (await applied.json() as any).batchId;
      expect(value.database.client.query("SELECT check_in, check_out FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ check_in: "07:10", check_out: "14:10" });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get() as any).count).toBe(1);
      const retained = value.database.client.query("SELECT source_row, proposed_change FROM attendance_import_rows WHERE batch_id = ?").get(batchId) as any;
      expect(retained.source_row).toBe(2);
      expect(JSON.parse(retained.proposed_change)).toMatchObject({ source_rows: [2, 3, 4], source_evidence: [{ sourceRow: 2 }, { sourceRow: 3 }, { sourceRow: 4 }] });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("retains a valid scan on a NOT_EXPECTED date without writing attendance", async () => {
    const value = await setup("not-expected");
    try {
      const source = await rowsFixture([["00123", "Synthetic One", "06/04/2026", "07:10", "14:10", "", "", "", "", "Monday"]]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-non-school.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.rows[0]).toMatchObject({ expectation: { status: "NOT_EXPECTED" }, checkIn: "07:10", canonicalAttendance: "NOT_COMMITTED", applyClassification: "NOOP_NOT_EXPECTED", qualityWarnings: expect.arrayContaining(["NON_EXPECTED_DATE"]) });
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-non-school.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 123 AND date = '2026-04-06'").get() as any).count).toBe(0);
      const retained = value.database.client.query("SELECT proposed_change FROM attendance_import_rows WHERE batch_id = ?").get((await applied.json() as any).batchId) as any;
      expect(JSON.parse(retained.proposed_change)).toMatchObject({ attendance: "NOT_COMMITTED", calendar_expectation: { status: "NOT_EXPECTED" }, quality: expect.arrayContaining(["NON_EXPECTED_DATE"]) });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("uses the date-effective enrollment class after a class transfer", async () => {
    const value = await setup("historical-class");
    try {
      const enrollmentId = Number((value.database.client.query("SELECT id FROM student_enrollments WHERE student_id = 123").get() as any).id);
      const classA = Number((value.database.client.query("SELECT id FROM academic_classes WHERE class_name = 'P1A'").get() as any).id);
      const classB = Number((value.database.client.query("SELECT id FROM academic_classes WHERE class_name = 'P1B'").get() as any).id);
      value.database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = 'P1B' WHERE id = ?", [classB, enrollmentId]);
      value.database.client.run("INSERT INTO student_enrollment_class_history (enrollment_id, class_name, effective_from, effective_to, changed_by, source) VALUES (?, 'P1A', '2026-01-01', '2026-08-15', 'synthetic-test', 'synthetic-test')", [enrollmentId]);
      value.database.client.run("INSERT INTO student_enrollment_class_history (enrollment_id, class_name, effective_from, changed_by, source) VALUES (?, 'P1B', '2026-08-16', 'synthetic-test', 'synthetic-test')", [enrollmentId]);
      const source = await rowsFixture([
        ["00123", "Synthetic One", "10/08/2026", "07:31", "14:10", "", "", "", "", "Monday"],
        ["00123", "Synthetic One", "20/08/2026", "07:38", "14:10", "", "", "", "", "Thursday"],
      ]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-transfer.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ date: "2026-08-10", historicalClass: "P1A", student: expect.objectContaining({ className: "P1A" }) }),
        expect.objectContaining({ date: "2026-08-20", historicalClass: "P1B", student: expect.objectContaining({ className: "P1B" }) }),
      ]));
      expect(classA).not.toBe(classB);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("keeps approved attendance corrections authoritative over imported check-ins", async () => {
    const value = await setup("correction");
    try {
      const source = await rowsFixture([["00123", "Synthetic One", "03/04/2026", "07:45", "14:10", "", "", "", "", "Friday"]]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-correction.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-correction.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      const attendanceId = Number((value.database.client.query("SELECT id FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get() as any).id);
      value.database.client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'on-time', '07:25', 'Synthetic approved correction', 'preview-admin', CURRENT_TIMESTAMP)", [attendanceId]);
      const lateness = await value.app.handle(new Request("http://local/api/analytics/attendance/term-lateness?academic_year_id=1&term_number=1", { headers: { cookie: value.cookie } }));
      expect((await lateness.json() as any).totals).toMatchObject({ late_events: 0, total_late_minutes: 0 });
      const secondPreview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect((await secondPreview.json() as any).rows[0]).toMatchObject({ applyClassification: "CONFLICT_EXISTING_OVERRIDE", existingAttendance: { hasOverride: true } });
      expect(applied.status).toBe(200);
      expect(value.database.client.query("SELECT check_in FROM attendance WHERE id = ?").get(attendanceId)).toMatchObject({ check_in: "07:45" });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("feeds machine imports into Term Attendance, Term Lateness, and the tardiness report", async () => {
    const value = await setup("canonical-reports");
    try {
      const classA = Number((value.database.client.query("SELECT id FROM academic_classes WHERE class_name = 'P1A'").get() as any).id);
      const classB = Number((value.database.client.query("SELECT id FROM academic_classes WHERE class_name = 'P1B'").get() as any).id);
      value.database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = 'P1A' WHERE student_id = 123", [classA]);
      value.database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = 'P1B' WHERE student_id = 456", [classB]);
      const source = await rowsFixture([
        ["00123", "Synthetic One", "03/04/2026", "07:31", "14:10", "", "", "", "", "Friday"],
        ["00123", "Synthetic One", "10/04/2026", "07:38", "14", "00:03", "", "", "", "Friday"],
        ["00456", "Synthetic Two", "03/04/2026", "08:30", "14:10", "", "", "", "", "Friday"],
        ["00456", "Synthetic Two", "10/04/2026", "07:18", "14:10", "00:18", "", "", "", "Friday"],
      ]);
      const form = new FormData(); form.append("file", new File([source], "synthetic-report.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.summary.eligibleCreates).toBe(4);
      expect(previewBody.rows.find((item: any) => item.date === "2026-04-10")).toMatchObject({ checkIn: "07:38", checkOut: null, canonicalAttendance: "PRESENT", punctuality: "LATE", lateMinutes: 8, qualityWarnings: expect.arrayContaining(["INVALID_SCAN_OUT", "SOURCE_LATENESS_DISAGREEMENT"]) });
      expect(previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00456" && item.date === "2026-04-10")).toMatchObject({ canonicalStatus: "on-time", canonicalAttendance: "PRESENT", punctuality: "ON_TIME", lateMinutes: 0, qualityWarnings: expect.arrayContaining(["SOURCE_LATENESS_DISAGREEMENT"]) });
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-report.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      const termAttendance = await value.app.handle(new Request("http://local/api/analytics/attendance/term?academic_year_id=1&term_number=1", { headers: { cookie: value.cookie } }));
      expect((await termAttendance.json() as any).totals).toMatchObject({ late_count: 3, hadir_count: 4 });
      const termLateness = await value.app.handle(new Request("http://local/api/analytics/attendance/term-lateness?academic_year_id=1&term_number=1", { headers: { cookie: value.cookie } }));
      const termBody = await termLateness.json() as any;
      expect(termBody.totals).toMatchObject({ late_events: 3, total_late_minutes: 69 });
      expect(termBody.classes).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_name: "P1A", totals: expect.objectContaining({ late_events: 2, total_late_minutes: 9 }) }),
        expect.objectContaining({ class_name: "P1B", totals: expect.objectContaining({ late_events: 1, total_late_minutes: 60 }) }),
      ]));
      const tardiness = await value.app.handle(new Request("http://local/api/analytics/tardiness-report?date_from=2026-04-01&date_to=2026-04-30", { headers: { cookie: value.cookie } }));
      const tardinessBody = await tardiness.json() as any;
      expect(tardinessBody.totals).toMatchObject({ late_events: 3, total_late_minutes: 69, total_late_minutes_str: "01:09" });
      expect(tardinessBody.breakdown_by_class).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_name: "P1A", late_events: 2, total_late_minutes: 9, total_late_minutes_str: "00:09" }),
        expect.objectContaining({ class_name: "P1B", late_events: 1, total_late_minutes: 60, total_late_minutes_str: "01:00" }),
      ]));
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("rejects a stale preview without changing attendance", async () => {
    const value = await setup("stale");
    try {
      const source = await fixture();
      const form = new FormData(); form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      value.database.client.run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (123, '2026-04-03', '07:00', '15:00', 0, 'manual', 0, 'sakit')");
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-machine.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const response = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ detail: { code: "PREVIEW_STALE" } });
      expect(value.database.client.query("SELECT status FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ status: "sakit" });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE operation LIKE 'MACHINE_IMPORT_%'").get() as any).count).toBe(0);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("rolls back the whole batch when one canonical insert fails", async () => {
    const value = await setup("transaction");
    try {
      const source = await twoEligibleFixture();
      value.database.client.run("CREATE TRIGGER machine_import_test_failure AFTER INSERT ON attendance WHEN NEW.student_id = 456 BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
      const form = new FormData(); form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const previewBody = await preview.json() as any;
      expect(previewBody.summary.eligibleCreates).toBe(2);
      const applyForm = new FormData(); applyForm.append("file", new File([source], "synthetic-machine.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(409);
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count).toBe(0);
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE operation LIKE 'MACHINE_IMPORT_%'").get() as any).count).toBe(0);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("resolves one unmatched Device ID through bounded search and canonical link authority", async () => {
    const value = await setup("identity-link");
    try {
      value.database.client.run("INSERT INTO students (id, name, jenjang, class_name) VALUES (88888, 'Existing Canonical Student', 'SMP', '7A')");
      value.database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES ('identity-target', 'Existing Canonical Student', 'existing canonical student', 'active')");
      value.database.client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (88888, 'identity-target', 1, 1, '7A', 1, '2026-01-01', 'ACTIVE')");
      const search = await value.app.handle(new Request("http://local/api/attendance/machine-import/student-search?search=Existing%20Canonical&academic_year_id=1&jenjang_id=1", { headers: { cookie: value.cookie } }));
      expect(search.status).toBe(200);
      expect(await search.json()).toEqual({ items: [{ id: "identity-target", full_name: "Existing Canonical Student", current_jenjang: "SMP", current_class: "7A" }] });
      const source = await fixture();
      const before = (value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count;
      const previewForm = new FormData(); previewForm.append("file", new File([source], "synthetic-machine.xlsx")); previewForm.append("academic_year_id", "1"); previewForm.append("jenjang_id", "1");
      const beforePreview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: previewForm }));
      expect((await beforePreview.json() as any).identityReview).toEqual([{ deviceIdentifier: "88888", machineName: "Not Mapped", effectiveFrom: "2026-04-03", occurrences: 1 }]);
      const linked = await value.app.handle(new Request("http://local/api/attendance/machine-import/device-identities/link", { method: "POST", headers: { ...{ cookie: value.cookie }, "content-type": "application/json" }, body: JSON.stringify({ device_identifier: "88888", student_master_id: "identity-target", effective_from: "2026-04-03", confirmation: "LINK_ATTENDANCE_DEVICE_ID" }) }));
      expect(linked.status).toBe(201);
      expect(await linked.json()).toMatchObject({ status: "LINKED", student: { id: "identity-target", full_name: "Existing Canonical Student" } });
      const afterPreview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: previewForm }));
      const afterBody = await afterPreview.json() as any;
      expect(afterBody.identityReview).toEqual([]);
      expect(afterBody.rows.find((item: any) => item.machineStudentIdentifier === "88888")).toMatchObject({ matchingState: "MATCHED", applyClassification: "ELIGIBLE_CREATE" });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count).toBe(before);
      const repeated = await value.app.handle(new Request("http://local/api/attendance/machine-import/device-identities/link", { method: "POST", headers: { ...{ cookie: value.cookie }, "content-type": "application/json" }, body: JSON.stringify({ device_identifier: "88888", student_master_id: "identity-target", effective_from: "2026-04-03", confirmation: "LINK_ATTENDANCE_DEVICE_ID" }) }));
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({ status: "NOOP_ALREADY_LINKED" });
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("creates a canonical student and Device ID through the existing transactional authority", async () => {
    const value = await setup("identity-create");
    try {
      const create = await value.app.handle(new Request("http://local/api/student-masters", { method: "POST", headers: { ...{ cookie: value.cookie }, "content-type": "application/json" }, body: JSON.stringify({ identity: { full_name: "New Onboarded Student", student_status: "active" }, device_identity: { device_identifier: "77777", device_source: "attendance_machine", effective_from: "2026-04-03", reason: "Machine identity onboarding" }, enrollment: null }) }));
      expect(create.status).toBe(201);
      const created = await create.json() as any;
      expect(created.identity.full_name).toBe("New Onboarded Student");
      const mapping = value.database.client.query("SELECT student_master_id, device_identifier, device_source FROM student_device_identities WHERE device_identifier = '77777'").get() as any;
      expect(mapping).toMatchObject({ device_identifier: "77777", device_source: "attendance_machine", student_master_id: created.id });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 77777").get() as any).count).toBe(0);
      const source = await identityFixture("77777", "New Onboarded Student");
      const form = new FormData(); form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(200);
      expect((await preview.json() as any).identityReview).toEqual([]);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);

  it("blocks Device ID reassignment and unauthorized identity search", async () => {
    const value = await setup("identity-conflict");
    try {
      value.database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES ('identity-other', 'Other Canonical Student', 'other canonical student', 'active')");
      value.database.client.run("INSERT INTO students (id, name) VALUES (77776, 'Other Canonical Student')");
      value.database.client.run("INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active) VALUES ('identity-other', 77776, '77776', 'attendance_machine', '2026-01-01', 1)");
      const conflict = await value.app.handle(new Request("http://local/api/attendance/machine-import/device-identities/link", { method: "POST", headers: { ...{ cookie: value.cookie }, "content-type": "application/json" }, body: JSON.stringify({ device_identifier: "77776", student_master_id: "master-123", effective_from: "2026-04-03", confirmation: "LINK_ATTENDANCE_DEVICE_ID" }) }));
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ detail: { code: "DEVICE_IDENTITY_ALREADY_LINKED" } });
      const anonymous = await value.app.handle(new Request("http://local/api/attendance/machine-import/student-search?search=Other&academic_year_id=1&jenjang_id=1"));
      expect(anonymous.status).toBe(401);
    } finally { value.database.close(); rmSync(value.path, { force: true }); }
  }, 30000);
});
