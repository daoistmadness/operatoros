import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db()",
    "core_database.engine.dispose()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "year_id = db.execute('SELECT id FROM academic_years WHERE is_default = 1').fetchone()[0]",
    "jenjang_id = db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMP', 'SMP', 'junior', 1)\").lastrowid",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, 'MAIN', 1)\", (jenjang_id,)).lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (?, ?, 'Grade 7', 1, 1)\", (jenjang_id, program_id)).lastrowid",
    "class_id = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7A', 'A', 1)\", (year_id, grade_id)).lastrowid",
    "other_jenjang_id = db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMA', 'SMA', 'senior', 1)\").lastrowid",
    "rows = [(str(uuid.uuid4()), f'Student {index}', gender, religion, birth, 9000 + index) for index, (gender, religion, birth) in enumerate([('L', 'Islam', '2013-05-01'), ('L', None, '2013-06-15'), ('P', 'Kristen', '2012-01-20'), (None, None, None)], start=1)]",
    "db.executemany(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender, religion, birth_date) VALUES (?, ?, ?, 'active', ?, ?, ?)\", [(m, n, n.lower(), g, r, b) for (m, n, g, r, b, _) in rows])",
    "db.executemany(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, 'SMP', '7A')\", [(sid, n) for (m, n, g, r, b, sid) in rows])",
    "db.executemany(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, '7A', 1, '2026-07-01', 'ACTIVE')\", [(sid, m, year_id, jenjang_id, class_id) for (m, n, g, r, b, sid) in rows])",
    "db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (9100, 'Graduated Student', 'SMP', '7A')\")",
    "graduated_master = str(uuid.uuid4())",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'Graduated Student', 'graduated student', 'graduated')\", (graduated_master,))",
    "db.execute(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (9100, ?, ?, ?, ?, '7A', 1, '2025-07-01', 'GRADUATED')\", (graduated_master, year_id, jenjang_id, class_id))",
    "db.executemany(\"INSERT INTO staff_members (id, full_name, normalized_name, employment_status, job_title_raw) VALUES (?, ?, ?, ?, ?)\", [(f'staff-{index:03d}', f'Staff {index}', f'staff {index}', status, title) for index, (status, title) in enumerate([('ACTIVE', 'Guru'), ('ACTIVE', None), ('ACTIVE', 'Kepala Sekolah')], start=1)])",
    "db.execute(\"INSERT INTO staff_members (id, full_name, normalized_name, employment_status) VALUES ('staff-004', 'Former Staff', 'former staff', 'FORMER')\")",
    "db.execute(\"INSERT INTO staff_education (staff_member_id, education_level, institution_name) VALUES ('staff-001', 'S1', 'Universitas A')\")",
    "db.execute(\"INSERT INTO staff_education (staff_member_id, education_level, institution_name) VALUES ('staff-001', 'S2', 'Universitas B')\")",
    "db.execute(\"INSERT INTO staff_jenjang_assignments (staff_member_id, jenjang_id) VALUES ('staff-001', 1)\")",
    "db.execute(\"INSERT INTO staff_jenjang_assignments (staff_member_id, jenjang_id) VALUES ('staff-001', 2)\")",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-recap-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-recap-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin) },
    staff: { cookie: cookie(staff) },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("data recapitulation analytics", () => {
  it("returns gender rows with unknown handling and summary cards", async () => {
    const value = await setup("gender");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students?dimension=gender", { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.total).toBe(4); // GRADUATED enrollment excluded by default
      expect(body.summary.male).toBe(2);
      expect(body.summary.female).toBe(1);
      expect(body.summary.genderUnknown).toBe(1);
      expect(body.summary.classes).toBe(1);
      expect(body.unknownCount).toBe(1);
      const male = body.rows.find((row: any) => row.key === "L");
      expect(male.count).toBe(2);
      expect(male.percentage).toBe(50);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("builds a class-by-category matrix with row and column totals", async () => {
    const value = await setup("matrix");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students?dimension=religion", { headers: { cookie: value.admin.cookie } }));
      const body = await response.json() as any;
      expect(body.matrix).toBeTruthy();
      expect(body.matrix.rows.length).toBe(1); // one class
      expect(body.matrix.columns.length).toBe(3); // Islam, Kristen, Unknown
      expect(body.matrix.grandTotal).toBe(4);
      const islamIndex = body.matrix.columns.findIndex((column: any) => column.key === "Islam");
      expect(body.matrix.columnTotals[islamIndex]).toBe(1);
      expect(body.matrix.rows[0].rowTotal).toBe(4);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("derives age bands server-side and hides birth dates", async () => {
    const value = await setup("age");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students?dimension=age", { headers: { cookie: value.admin.cookie } }));
      const body = await response.json() as any;
      const keys = body.rows.map((row: any) => row.key);
      expect(keys).toContain("12-13"); // 2013 births against current reference date
      expect(keys).toContain("Unknown");
      expect(JSON.stringify(body)).not.toContain("2013-05-01");
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("protects against duplicate enrollment counting", async () => {
    const value = await setup("dup");
    try {
      const db = value.database;
      const master = db.client.query("SELECT id FROM student_masters LIMIT 1").get() as any;
      const enrollment = db.client.query("SELECT * FROM student_enrollments WHERE student_master_id = ?").get(master.id) as any;
      let duplicateRejected = false;
      try {
        db.client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, '7A', 1, '2026-07-01', 'ACTIVE')", [enrollment.student_id, master.id, enrollment.academic_year_id, enrollment.jenjang_id, enrollment.academic_class_id]);
      } catch {
        duplicateRejected = true; // schema enforces one enrollment per student per year
      }
      expect(duplicateRejected).toBe(true);
      const response = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students?dimension=gender", { headers: { cookie: value.admin.cookie } }));
      const body = await response.json() as any;
      expect(body.total).toBe(4); // still 4 unique students
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("counts staff with duplicate assignment protection and unknown handling", async () => {
    const value = await setup("staff");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff?dimension=employment", { headers: { cookie: value.admin.cookie } }));
      const body = await response.json() as any;
      expect(body.total).toBe(3); // ACTIVE only; FORMER excluded; duplicate jenjang assignments don't inflate
      const active = body.rows.find((row: any) => row.key === "ACTIVE");
      expect(active.count).toBe(3);
      expect(active.percentage).toBe(100);
      const education = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff?dimension=education", { headers: { cookie: value.admin.cookie } }));
      const educationBody = await education.json() as any;
      const s2 = educationBody.rows.find((row: any) => row.key === "S2");
      expect(s2.count).toBe(1); // highest level wins over S1
      const unknown = educationBody.rows.find((row: any) => row.key === "Unknown");
      expect(unknown.count).toBe(2);
      const jenjang = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff?dimension=jenjang", { headers: { cookie: value.admin.cookie } }));
      const jenjangBody = await jenjang.json() as any;
      const smp = jenjangBody.rows.find((row: any) => row.key === "SMP");
      expect(smp.count).toBe(1); // staff-001 assigned to SMP
      const primary = jenjangBody.rows.find((row: any) => row.key === "Primary");
      expect(primary.count).toBe(1); // multi-assignment staff appears in both jenjangs
      const jenjangUnknown = jenjangBody.rows.find((row: any) => row.key === "Unknown");
      expect(jenjangUnknown.count).toBe(2); // staff without assignments
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("applies filters without broadening scope", async () => {
    const value = await setup("filters");
    try {
      const status = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students?dimension=status&status=GRADUATED", { headers: { cookie: value.admin.cookie } }));
      const statusBody = await status.json() as any;
      expect(statusBody.total).toBe(1);
      const staffUnknown = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff?employment_status=UNKNOWN", { headers: { cookie: value.admin.cookie } }));
      expect((await staffUnknown.json() as any).total).toBe(0);
      const staffFormer = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff?employment_status=FORMER", { headers: { cookie: value.admin.cookie } }));
      expect((await staffFormer.json() as any).total).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("enforces server-side authorization", async () => {
    const value = await setup("auth");
    try {
      const anonStudent = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students"));
      expect(anonStudent.status).toBe(401);
      const anonStaff = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff"));
      expect(anonStaff.status).toBe(401);
      const staffStudent = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students", { headers: { cookie: value.staff.cookie } }));
      expect(staffStudent.status).toBe(200); // staff holds view_student
      const staffStaff = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff", { headers: { cookie: value.staff.cookie } }));
      expect(staffStaff.status).toBe(403); // staff lacks view_staff
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("exports student and staff workbooks without mutation", async () => {
    const value = await setup("export");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      const studentExport = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students/export-excel", { headers: { cookie: value.admin.cookie } }));
      expect(studentExport.status).toBe(200);
      const bytes = new Uint8Array(await studentExport.arrayBuffer());
      expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
      const workbook = await loadXlsxWorkbook(bytes);
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toContain("Summary");
      expect(names).toContain("Gender");
      expect(names).toContain("Age");
      expect(names).not.toContain("Employment");
      const staffExport = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff/export-excel", { headers: { cookie: value.admin.cookie } }));
      if (staffExport.status !== 200) console.log("STAFF EXPORT BODY:", await staffExport.text());
      expect(staffExport.status).toBe(200);
      const staffWorkbook = await loadXlsxWorkbook(new Uint8Array(await staffExport.arrayBuffer()));
      expect(staffWorkbook.worksheets.map((sheet) => sheet.name)).toContain("Employment");
      const staffDenied = await value.app.handle(new Request("http://local/api/analytics/recapitulation/students/export-excel", { headers: { cookie: value.staff.cookie } }));
      expect(staffDenied.status).toBe(403);
      const staffStaffExport = await value.app.handle(new Request("http://local/api/analytics/recapitulation/staff/export-excel", { headers: { cookie: value.staff.cookie } }));
      expect(staffStaffExport.status).toBe(403); // staff lacks export_staff
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);
});

