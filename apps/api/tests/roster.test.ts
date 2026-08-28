import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
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

describe("academic roster candidates", () => {
  it("previews and commits a disposable roster with provenance", async () => {
    const path = `/tmp/operatoros-roster-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-roster-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: cookie(login) };
      const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Roster"); sheet.addRow(["student_identifier", "student_name", "academic_year", "jenjang", "class_name", "program", "status"]); sheet.addRow(["123", "Andi", "2026/2027-roster", "SMP", "7A", "Science", "active"]);
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      const invalidForm = new FormData(); invalidForm.append("file", new File([bytes], "roster.xlsx")); invalidForm.append("source_owner", "School Office"); invalidForm.append("date_received", "2026-02-30");
      const invalid = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: invalidForm })); expect(invalid.status).toBe(422);
      const form = new FormData(); form.append("file", new File([bytes], "roster.xlsx")); form.append("source_owner", "School Office"); form.append("date_received", "2026-08-26");
      const preview = await app.handle(new Request("http://local/api/student-enrollments/roster-preview", { method: "POST", headers: auth, body: form })); const previewBody = await preview.json() as any;
      expect(preview.status, JSON.stringify(previewBody)).toBe(200); expect(previewBody.summary).toMatchObject({ total: 1, create_enrollment: 1 }); expect(previewBody.rows[0]).toMatchObject({ classification: "CREATE_ENROLLMENT", matched_student_master_id: expect.any(String) });
      const commit = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: previewBody.preview_id, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER", preview_checksum: previewBody.preview_checksum }) })); const commitBody = await commit.json() as any;
      expect(commit.status, JSON.stringify(commitBody)).toBe(200); expect(commitBody).toMatchObject({ status: "committed", created: 1, students_created: 0 }); expect((database.client.query("SELECT COUNT(*) AS count FROM student_enrollments").get() as any).count).toBe(1); expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_applied_actions").get() as any).count).toBe(1);
      const replay = await app.handle(new Request("http://local/api/student-enrollments/roster-commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_id: previewBody.preview_id, selected_row_ids: [1], confirmation: "COMMIT_ACADEMIC_ROSTER", preview_checksum: previewBody.preview_checksum }) })); expect(await replay.json()).toEqual(commitBody);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
