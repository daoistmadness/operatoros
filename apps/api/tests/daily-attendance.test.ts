import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-daily-attendance-test-secret-32";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.database_exists = lambda: True; core_database.engine.dispose()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "year_id = db.execute(\"INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-daily','2026-07-01','2027-06-30','active',1)\").lastrowid",
    "jenjang_id = db.execute(\"INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)\").lastrowid",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?, 'MAIN', 1)\", (jenjang_id,)).lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?, ?, 'Grade 7', 1, 1)\", (jenjang_id,program_id)).lastrowid",
    "class_a = db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, '7A','A',1)\", (year_id,grade_id)).lastrowid; class_b = db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, '7B','B',1)\", (year_id,grade_id)).lastrowid; class_c = db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, '7C','C',1)\", (year_id,grade_id)).lastrowid",
    "students = [(9501,'Alpha Student','SMP','7A'),(9502,'Beta Student','SMP','7A'),(9503,'Gamma Student','SMP','7B')]; db.executemany('INSERT INTO students (id,name,jenjang,class_name) VALUES (?,?,?,?)', students)",
    "masters = [str(uuid.uuid4()) for _ in students]; db.executemany(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?, ?, ?, 'active')\", [(masters[i], students[i][1], students[i][1].lower()) for i in range(3)])",
    "db.executemany(\"INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,?,?,?,?,1,'2026-07-01','ACTIVE')\", [(9501,masters[0],year_id,jenjang_id,class_a,'7A'),(9502,masters[1],year_id,jenjang_id,class_a,'7A'),(9503,masters[2],year_id,jenjang_id,class_b,'7B')])",
    "staff_id = db.execute(\"SELECT id FROM users WHERE username = 'golden-staff'\").fetchone()[0]; db.execute(\"INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from) VALUES (?,?,?,'HOMEROOM_TEACHER',1,'golden-admin','2026-07-01')\", (staff_id,year_id,class_a))",
    "db.executemany(\"INSERT INTO attendance (student_id,date,check_in,late_duration,late_source,is_absent,status) VALUES (?,?,?,?,?,?,?)\", [(9501,'2026-08-03','07:30:00',0,'test',0,'on-time'),(9502,'2026-08-03','07:45:00',15,'test',0,'late'),(9501,'2026-08-04','07:45:00',15,'test',0,'late'),(9503,'2026-08-04','07:30:00',0,'test',0,'on-time')])",
    "late_id = db.execute(\"SELECT id FROM attendance WHERE student_id=9502 AND date='2026-08-03'\").fetchone()[0]; db.execute(\"INSERT INTO attendance_overrides (attendance_id,original_status,override_status,note,reviewed_by,reviewed_at) VALUES (?, 'late','on-time','Correction','golden-admin','2026-08-03T10:00:00Z')\", (late_id,))",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-daily-attendance-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-daily-attendance-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return { app, database, admin: cookie(admin), staff: cookie(staff), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("daily attendance operations", () => {
  it("reports complete, none, empty, and effective status counts", async () => {
    const value = await setup("coverage");
    try {
      const response = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03", { headers: { cookie: value.admin } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.totals).toMatchObject({ classes: 3, expectedStudents: 3, recordedStudents: 2, unrecordedStudents: 1, completeClasses: 1, noRecordClasses: 1, emptyClasses: 1 });
      expect(body.scope).toMatchObject({ date: "2026-08-03", schoolDayAuthority: "NOT_AVAILABLE" });
      expect(body.classes[0]).toMatchObject({ className: "7A", coverageState: "COMPLETE", expectedStudentCount: 2, recordedStudentCount: 2, unrecordedStudentCount: 0, coveragePercent: 100, counts: { present: 2, late: 0 } });
      expect(body.classes[1]).toMatchObject({ className: "7B", coverageState: "NONE", expectedStudentCount: 1, recordedStudentCount: 0, unrecordedStudentCount: 1, counts: { alfa: 0 } });
      expect(body.classes[2]).toMatchObject({ className: "7C", coverageState: "EMPTY_CLASS", expectedStudentCount: 0, recordedStudentCount: 0, unrecordedStudentCount: 0, coveragePercent: null });
      expect(JSON.stringify(body)).not.toMatch(/overdue|risk|alert|intervention/i);
    } finally { value.cleanup(); }
  }, 30000);

  it("reports partial coverage and keeps unrecorded students out of Alfa", async () => {
    const value = await setup("partial");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count);
      const response = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-04&academic_year_id=1&jenjang_id=1&class_id=1", { headers: { cookie: value.admin } }));
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.totals).toMatchObject({ classes: 1, expectedStudents: 2, recordedStudents: 1, unrecordedStudents: 1, partialClasses: 1 });
      expect(body.classes[0]).toMatchObject({ coverageState: "PARTIAL", counts: { late: 1, alfa: 0 } });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);

  it("applies server authorization before class filters", async () => {
    const value = await setup("auth");
    try {
      expect((await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03"))).status).toBe(401);
      const staff = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03", { headers: { cookie: value.staff } }));
      expect(staff.status).toBe(200);
      expect((await staff.json() as any).classes.map((item: any) => item.className)).toEqual(["7A"]);
      const forbidden = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03&class_id=2", { headers: { cookie: value.staff } }));
      expect(forbidden.status).toBe(200);
      expect((await forbidden.json() as any).classes).toEqual([]);
    } finally { value.cleanup(); }
  }, 30000);
});
