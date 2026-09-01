import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { appendRow, createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";

const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${root}/backend/.venv/bin/python`;
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
    ["00123", "Synthetic One", "03/04/2026", "07:00", "15:00", "", "", "", "", "Friday"],
    ["00123", "Synthetic One", "04/04/2026", "", "", "", "", "", "", "Saturday"],
    ["00456", "Synthetic Two", "06/04/2026", "", "", "", "", "", "", "Monday"],
    ["00123", "Synthetic One", "05/04/2026", "07:05", "15:00", "", "", "", "", "Sunday"],
    ["88888", "Not Mapped", "03/04/2026", "07:10", "15:00", "", "", "", "", "Friday"],
    ["00999", "Ambiguous", "03/04/2026", "07:10", "15:00", "", "", "", "", "Friday"],
  ].forEach((row) => appendRow(sheet, row));
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
      for (const [table, count] of Object.entries(before)) expect((value.database.client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count).toBe(count);
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
});
