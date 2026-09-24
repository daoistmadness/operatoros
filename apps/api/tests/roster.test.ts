import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { appendRow, createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = "from pathlib import Path; import sqlite3, sys, uuid; sys.path.insert(0, 'backend/src'); from core.schema_migrations import bootstrap_fresh_sqlite_database; from argon2 import PasswordHasher; path=Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db=sqlite3.connect(path); ph=PasswordHasher(); db.execute('INSERT INTO users (username,password_hash,role,is_active) VALUES (?,?,?,1)', ('golden-admin',ph.hash('golden-admin-pass-1'),'admin')); db.execute(\"INSERT INTO academic_years (label,start_date,end_date,is_default,status) VALUES ('2026/2027-roster','2026-07-01','2027-06-30',1,'active')\"); db.execute(\"INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)\"); db.execute(\"INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'Science',1)\"); db.execute(\"INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Grade 7',1,1)\"); db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7A','A',1)\"); master=str(uuid.uuid4()); db.execute(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?, 'Andi', 'andi', 'active')\", (master,)); db.execute(\"INSERT INTO students (id,name) VALUES (123,'Andi')\"); db.execute(\"INSERT INTO student_device_identities (student_master_id,legacy_student_id,device_identifier,device_source,effective_from,is_active,created_by) VALUES (?,123,'123','attendance_machine','2026-07-01',1,'seed')\", (master,)); db.commit(); db.close()";
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function rosterWorkbook(rowCount = 30, headers = [
  "student_identifier", "student_name", "academic_year", "admission_type", "birth_date", "class_name", "homeroom_teacher", "jenjang", "nik", "nipd", "nisn", "program", "start_date", "status", "student_master_id",
]): Promise<Uint8Array> {
  const workbook = createWorkbook({ exportType: "roster-regression" });
  const roster = workbook.addWorksheet("Roster");
  appendRow(roster, headers);
  for (let index = 1; index <= rowCount; index++) {
    appendRow(roster, [
      String(1000 + index), `Synthetic Student ${index}`, "2099/2100", "new", new Date("2010-01-01T00:00:00.000Z"), `Class ${index}`, "Synthetic Teacher", "SMP", null, String(2000 + index), String(3000 + index), "Science", new Date("2099-07-01T00:00:00.000Z"), "active", null,
    ]);
  }
  const instructions = workbook.addWorksheet("Instructions");
  appendRow(instructions, ["OperatorOS Student Roster"]);
  appendRow(instructions, ["Required columns", "academic_year, class_name, jenjang, program, status, student_identifier, student_name"]);
  appendRow(instructions, ["Workflow", "Preview only"]);
  return writeXlsxWorkbook(workbook);
}

async function previewResponse(app: ReturnType<typeof createApp>, auth: Record<string, string>, bytes: Uint8Array, filename = "roster.xlsx"): Promise<{ response: Response; body: any }> {
  const form = new FormData();
  form.append("file", new File([bytes], filename));
  form.append("source_owner", "Synthetic Registrar");
  form.append("date_received", "2026-08-26");
  const response = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: form }));
  return { response, body: await response.json() };
}

describe("academic roster candidates", () => {
  it("previews a 30-row Roster sheet and ignores Instructions without mutating domain data", async () => {
    const path = `/tmp/operatoros-roster-30-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-roster-30-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      const before = Object.fromEntries(["student_masters", "student_enrollments", "attendance", "student_import_sessions", "academic_roster_import_batches"].map((table) => [table, (database.client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count]));
      const result = await previewResponse(app, auth, await rosterWorkbook());

      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.summary).toMatchObject({ total: 30, invalid: 30 });
      expect(result.body.rows).toHaveLength(30);
      expect(result.body.rows.every((row: any) => row.source_sheet === "Roster")).toBe(true);
      expect(result.body.rows[0]).toMatchObject({ source_row: 2, payload: { student_identifier: "1001", student_name: "Synthetic Student 1" }, errors: ["Unknown academic year"] });
      const after = Object.fromEntries(["student_masters", "student_enrollments", "attendance", "student_import_sessions", "academic_roster_import_batches"].map((table) => [table, (database.client.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count]));
      expect(after).toEqual(before);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("returns controlled workbook errors for missing headers, corrupt XLSX, and unsupported types", async () => {
    const path = `/tmp/operatoros-roster-errors-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-roster-errors-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      const missing = await previewResponse(app, auth, await rosterWorkbook(1, ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program"]));
      expect(missing.response.status).toBe(400);
      expect(missing.body.detail).toMatchObject({ code: "ROSTER_REQUIRED_COLUMNS_MISSING" });
      expect(JSON.stringify(missing.body)).not.toContain("TypeError");

      const corrupt = await previewResponse(app, auth, Uint8Array.from([0, 1, 2, 3]));
      expect(corrupt.response.status).toBe(400);
      expect(corrupt.body.detail).toMatchObject({ code: "ROSTER_WORKBOOK_PARSE_FAILED", message: "Unable to read this workbook. Verify that it is a valid supported Excel file." });
      expect(JSON.stringify(corrupt.body)).not.toContain("undefined is not an object");

      const unsupported = await previewResponse(app, auth, await rosterWorkbook(0), "roster.xls");
      expect(unsupported.response.status).toBe(400);
      expect(unsupported.body.detail).toMatchObject({ code: "ROSTER_FILE_TYPE_UNSUPPORTED" });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("previews and commits a disposable roster with provenance", async () => {
    const path = `/tmp/operatoros-roster-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-roster-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      const workbook = createWorkbook({ exportType: "roster-test" }); const sheet = workbook.addWorksheet("Roster"); appendRow(sheet, ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"]); appendRow(sheet, ["123", "Andi", "2026/2027-roster", "SMP", "7A", "Science", "active"]);
      const bytes = await writeXlsxWorkbook(workbook);
      const invalidForm = new FormData(); invalidForm.append("file", new File([bytes], "roster.xlsx")); invalidForm.append("source_owner", "School Office"); invalidForm.append("date_received", "2026-02-30");
      const invalid = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: invalidForm })); expect(invalid.status).toBe(422);
      const form = new FormData(); form.append("file", new File([bytes], "roster.xlsx")); form.append("source_owner", "School Office"); form.append("date_received", "2026-08-26");
      const preview = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: form })); const previewBody = await preview.json() as any;
      expect(preview.status, JSON.stringify(previewBody)).toBe(200); expect(previewBody.summary).toMatchObject({ total: 1, create_enrollment: 1 }); expect(previewBody.rows[0]).toMatchObject({ classification: "CREATE_ENROLLMENT", matched_student_master_id: expect.any(String) });
      const commit = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: previewBody.preview_id, plan_token: previewBody.plan_token, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER", preview_checksum: previewBody.preview_checksum }) })); const commitBody = await commit.json() as any;
      expect(commit.status, JSON.stringify(commitBody)).toBe(200); expect(commitBody).toMatchObject({ status: "committed", created: 1, students_created: 0 }); expect((database.client.query("SELECT COUNT(*) AS count FROM student_enrollments").get() as any).count).toBe(1); expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_applied_actions").get() as any).count).toBe(1);
      const replay = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: previewBody.preview_id, plan_token: previewBody.plan_token, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER", preview_checksum: previewBody.preview_checksum }) })); expect(await replay.json()).toEqual(commitBody);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("uses the canonical year/class hierarchy and explains each class failure", async () => {
    const path = `/tmp/operatoros-roster-class-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-roster-class-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      database.client.run("INSERT INTO academic_years (label,start_date,end_date,is_default,status) VALUES ('2026/2027','2026-07-01','2027-06-30',0,'active'),('2027/2028','2027-07-01','2028-06-30',0,'active')");
      database.client.run("INSERT INTO jenjangs (name,code,level,active) VALUES ('Primary','PRI','primary',1)");
      database.client.run("INSERT INTO academic_programs (jenjang_id,name,active) VALUES (2,'Primary',1)");
      database.client.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (2,2,'P1',1,1)");
      database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (2,2,'P1A','A',1),(2,2,'P1B','B',1),(3,2,'P1A','A',1)");
      const classId = Number((database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = 2 AND class_name = 'P1A'").get() as any).id);
      const preview = async (className: string, program = "Primary", year = "2026/2027", grade = "P1", identifier = "456") => {
        const workbook = createWorkbook({ exportType: "synthetic-class-roster" }); const sheet = workbook.addWorksheet("Roster");
        appendRow(sheet, ["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status", "grade"]);
        appendRow(sheet, [identifier, "Synthetic Student", year, "Primary", className, program, "active", grade]);
        const form = new FormData(); form.append("file", new File([await writeXlsxWorkbook(workbook)], "synthetic.xlsx")); form.append("source_owner", "Synthetic Registrar"); form.append("date_received", "2026-08-26");
        const response = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: form }));
        expect(response.status).toBe(200); return response.json() as Promise<any>;
      };
      const p1a = await preview("P1A", "primary");
      expect(p1a.rows[0]).toMatchObject({ classification: "CREATE_NEW_MASTER", payload: { academic_class_id: classId, target_class: "P1A", target_grade: "P1", target_program: "Primary", target_jenjang: "Primary" } });
      expect((database.client.query("SELECT COUNT(*) AS count FROM academic_roster_import_batches").get() as any).count).toBe(0);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_sessions").get() as any).count).toBe(0);
      expect((await preview("P1B")).rows[0].classification).toBe("CREATE_NEW_MASTER");
      expect((await preview("P1C")).rows[0].classification).toBe("CLASS_NOT_FOUND");
      expect((await preview("P1A", "Secondary")).rows[0].classification).toBe("CLASS_CONTEXT_CONFLICT");
      expect((await preview("P1A", "Primary", "2026/2027", "P2")).rows[0].classification).toBe("CLASS_CONTEXT_CONFLICT");
      expect((await preview(" p1a ")).rows[0].payload.academic_class_id).toBe(classId);
      const otherYear = await preview("P1A", "Primary", "2027/2028");
      expect(otherYear.rows[0].payload.academic_class_id).not.toBe(classId);
      database.client.run("UPDATE academic_classes SET active = 0 WHERE academic_year_id = 2 AND class_name = 'P1B'");
      expect((await preview("P1B")).rows[0].classification).toBe("CLASS_INACTIVE");
      const committed = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: p1a.preview_id, plan_token: p1a.plan_token, preview_checksum: p1a.preview_checksum, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER" }) }));
      expect(committed.status).toBe(200);
      expect((database.client.query("SELECT academic_class_id FROM student_enrollments WHERE academic_year_id = 2").get() as any).academic_class_id).toBe(classId);
      const stale = await preview("P1A", "Primary", "2026/2027", "P1", "457");
      database.client.run("UPDATE academic_classes SET active = 0 WHERE id = ?", [classId]);
      const rejected = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: stale.preview_id, plan_token: stale.plan_token, preview_checksum: stale.preview_checksum, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER" }) }));
      expect(rejected.status).toBe(409);
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_device_identities WHERE device_identifier = '457'").get() as any).count).toBe(0);
      database.client.run("UPDATE academic_classes SET active = 1 WHERE id = ?", [classId]);
      database.client.run("INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (2,2,'P2',2,1)");
      database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (2,3,'p1a','A',1)");
      expect((await preview("P1a")).rows[0].classification).toBe("AMBIGUOUS_CLASS");
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
