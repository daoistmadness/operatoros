import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { appendRow, createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { python } from "./python";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-machine-preview-test-cookie-secret-32";
const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Absent", "Lembur", "Pengecualian", "week"];

function seed(path: string): void {
  const script = [
    "from pathlib import Path", "import sqlite3, sys", "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database", "from argon2 import PasswordHasher", "path=Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db=sqlite3.connect(path); ph=PasswordHasher()",
    "db.execute(\"INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)\", ('preview-admin',ph.hash('preview-admin-pass-1'),'admin'))",
    "db.execute(\"INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-preview','2026-01-01','2026-12-31','active',1)\")",
    "db.execute(\"INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)\")",
    "students=[(123,'Synthetic One','SMP','7A'),(456,'Synthetic Two','SMP','7A'),(999,'Synthetic Three','SMP','7B'),(1000,'Synthetic Four','SMP','7C')]",
    "for sid,name,jenjang,klass in students:", "    db.execute(\"INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)\",(sid,name,jenjang,klass)); db.execute(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')\",(f'master-{sid}',name,name.lower()))",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-123',123,'00123','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-456',456,'00456','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-999',999,'00999','attendance_machine','2026-01-01',1)\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active) VALUES ('master-1000',1000,'00999','secondary_machine','2026-01-01',1)\")",
    "for sid,master,klass in [(123,'master-123','7A'),(456,'master-456','7A'),(999,'master-999','7B'),(1000,'master-1000','7C')]: db.execute(\"INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,1,1,?,1,'2026-01-01','ACTIVE')\",(sid,master,klass))",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,1,'EXPECTED')\")",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,5,'EXPECTED')\")",
    "db.execute(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,6,'EXPECTED')\")",
    "db.execute(\"INSERT INTO attendance_calendar_exceptions (academic_year_id,jenjang_id,date,expectation,reason,created_by) VALUES (1,1,'2026-04-06','NOT_EXPECTED','SCHOOL_BREAK','preview-admin')\")",
    "db.commit(); db.close()",
  ].join("\n");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, OPERATOROS_ISOLATED_TEST: "true" } });
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

async function identityFixture(identifier: string, name: string): Promise<Uint8Array> {
  const book = createWorkbook({ exportType: "machine-identity-onboarding-test" });
  const sheet = book.addWorksheet("Synthetic Machine Export");
  appendRow(sheet, headers);
  appendRow(sheet, [identifier, name, "03/04/2026", "07:00", "15:00", "", "", "", "", "Friday"]);
  return writeXlsxWorkbook(book);
}

async function setup(label: string) {
  const path = `/tmp/operatoros-machine-preview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
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
      expect(find("00123", "2026-04-04")).toMatchObject({ machineEvidence: "NO_SCAN", expectation: { status: "EXPECTED" }, reconciliationState: "NO_SCAN_EXPECTED" });
      expect(find("00456", "2026-04-06")).toMatchObject({ machineEvidence: "NO_SCAN", expectation: { status: "NOT_EXPECTED" }, reconciliationState: "NO_SCAN_NOT_EXPECTED" });
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
      expect(body.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "CONFLICT_EXISTING_ATTENDANCE", existingAttendance: { baseStatus: "sakit", effectiveStatus: "sakit", hasOverride: false }, resolution: { class: "ATTENDANCE_REVIEW", target: { type: "ATTENDANCE_REVIEW", path: "/attendance/daily?date=2026-04-03&academic_year_id=1" } } });
      value.database.client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES ((SELECT id FROM attendance WHERE student_id = 123 AND date = '2026-04-03'), 'sakit', 'izin', 'Synthetic review', 'preview-admin', CURRENT_TIMESTAMP)");
      const second = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      const secondBody = await second.json() as any;
      expect(secondBody.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "CONFLICT_EXISTING_OVERRIDE", existingAttendance: { baseStatus: "sakit", effectiveStatus: "izin", hasOverride: true }, resolution: { class: "ATTENDANCE_CORRECTION", target: { type: "ATTENDANCE_CORRECTION", path: "/attendance/override-review?academic_year_id=1&date_from=2026-04-03&date_to=2026-04-03" } } });
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

  it("applies only eligible complete scans and records transactional provenance", async () => {
    const value = await setup("apply");
    try {
      const source = await fixture();
      const form = new FormData();
      form.append("file", new File([source], "synthetic-machine.xlsx")); form.append("academic_year_id", "1"); form.append("jenjang_id", "1");
      const preview = await value.app.handle(new Request("http://local/api/attendance/machine-import/preview", { method: "POST", headers: { cookie: value.cookie }, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      expect(previewBody.summary).toMatchObject({ eligibleCreates: 1, alreadyCanonical: 0, conflicts: 0 });
      expect(previewBody.rows.find((item: any) => item.machineStudentIdentifier === "00123" && item.date === "2026-04-03")).toMatchObject({ applyClassification: "ELIGIBLE_CREATE", canonicalStatus: "late" });
      const applyForm = new FormData();
      applyForm.append("file", new File([source], "synthetic-machine.xlsx")); applyForm.append("academic_year_id", "1"); applyForm.append("jenjang_id", "1"); applyForm.append("expected_preview_digest", previewBody.previewDigest); applyForm.append("confirmation", "IMPORT_MACHINE_ATTENDANCE");
      const applied = await value.app.handle(new Request("http://local/api/attendance/machine-import/apply", { method: "POST", headers: { cookie: value.cookie }, body: applyForm }));
      expect(applied.status).toBe(200);
      const appliedBody = await applied.json() as any;
      expect(appliedBody).toMatchObject({ status: "APPLIED", summary: { rowsInspected: 6, created: 1, alreadyCanonical: 0 } });
      expect(value.database.client.query("SELECT status, check_in, check_out, late_duration FROM attendance WHERE student_id = 123 AND date = '2026-04-03'").get()).toMatchObject({ status: "late", check_in: "07:00", check_out: "15:00", late_duration: 10 });
      expect((value.database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE import_session_id = ? AND operation = 'MACHINE_IMPORT_CREATE'").get(appliedBody.batchId) as any).count).toBe(1);

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
      expect(preview.status).toBe(200);
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
