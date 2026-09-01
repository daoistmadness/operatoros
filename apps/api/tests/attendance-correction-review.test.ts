import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";

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
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db(); core_database.engine.dispose()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "year_id = db.execute('SELECT id FROM academic_years WHERE is_default = 1').fetchone()[0]",
    "jenjang_id = db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMP', 'SMP', 'junior', 1)\").lastrowid",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, 'MAIN', 1)\", (jenjang_id,)).lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (?, ?, 'Grade 7', 1, 1)\", (jenjang_id, program_id)).lastrowid",
    "class_a = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7A', 'A', 1)\", (year_id, grade_id)).lastrowid",
    "class_b = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7B', 'B', 1)\", (year_id, grade_id)).lastrowid",
    "students = [(9601, 'Alpha Student', '7A'), (9602, 'Beta Student', '7B'), (9603, 'Gamma Student', '7A')]; db.executemany(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, 'SMP', ?)\", students)",
    "master_ids = [str(uuid.uuid4()) for _ in students]; db.executemany(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", [(master_ids[index], students[index][1], students[index][1].lower()) for index in range(len(students))])",
    "db.executemany(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, 1, '2026-07-01', 'ACTIVE')\", [(students[index][0], master_ids[index], year_id, jenjang_id, class_a if index != 1 else class_b, students[index][2]) for index in range(len(students))])",
    "db.executemany(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, '07:30:00', '16:00:00', 0, 'test', 0, ?)\", [(9601, '2026-08-04', 'late'), (9602, '2026-08-05', 'absent'), (9603, '2026-08-06', 'on-time')])",
    "db.executemany(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)\", [(1, 'late', 'on-time', 'Device missed scan', 'golden-admin', '2026-08-04T10:00:00Z'), (2, 'absent', 'sakit', 'Medical note received', 'golden-admin', '2026-08-05T10:00:00Z')])",
    "staff_id = db.execute(\"SELECT id FROM users WHERE username = 'golden-staff'\").fetchone()[0]; db.execute(\"INSERT INTO teacher_class_assignments (user_id, academic_year_id, academic_class_id, class_role, active, assigned_by, effective_from) VALUES (?, ?, ?, 'HOMEROOM_TEACHER', 1, 'golden-admin', '2026-07-01')\", (staff_id, year_id, class_a))",
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
  const path = `/tmp/operatoros-attendance-correction-review-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-correction-review-audit-${process.pid}` } });
  const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app, admin: cookie(adminLogin), staff: cookie(staffLogin),
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("attendance correction review", () => {
  it("projects only canonical current overrides with original/effective parity and links", async () => {
    const value = await setup("projection");
    try {
      const response = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31", { headers: { cookie: value.admin } }));
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.summary).toEqual({ corrections: 2 });
      expect(body.items.map((item: any) => [item.studentName, item.baseStatus, item.effectiveStatus])).toEqual([["Beta Student", "absent", "sakit"], ["Alpha Student", "late", "on-time"]]);
      expect(body.items[0].correction).toMatchObject({ note: "Medical note received", reviewedBy: "golden-admin", active: true });
      expect(body.items[0].links.student360).toMatch(/^\/students\//);
      expect(body.items[0].links.class360).toBe("/classes/2?attendance_date_from=2026-08-05&attendance_date_to=2026-08-05");
      expect(body.items[0].links.dailyAttendance).toContain("/attendance/daily");
      expect(body.items[0].canEdit).toBe(true);
      expect(body.items[0].links.editCorrection).toContain("/attendance-review");
    } finally { value.cleanup(); }
  }, 30000);

  it("applies filters, stable pagination, and assignment scope before counting", async () => {
    const value = await setup("scope");
    try {
      const staff = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&page=1&page_size=1", { headers: { cookie: value.staff } }));
      const staffBody = await staff.json() as any;
      expect(staff.status).toBe(200);
      expect(staffBody.total).toBe(1);
      expect(staffBody.summary.corrections).toBe(1);
      expect(staffBody.items[0]).toMatchObject({ studentName: "Alpha Student", canEdit: false, links: { editCorrection: null } });
      const filtered = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&effective_status=sakit", { headers: { cookie: value.admin } }));
      expect((await filtered.json() as any).total).toBe(1);
      const search = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&student_search=alpha", { headers: { cookie: value.admin } }));
      expect((await search.json() as any).items[0].studentName).toBe("Alpha Student");
    } finally { value.cleanup(); }
  }, 30000);

  it("denies anonymous access and leaves business rows unchanged on GET", async () => {
    const value = await setup("auth");
    try {
      const anonymous = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1"));
      expect(anonymous.status).toBe(401);
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count);
      const response = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1", { headers: { cookie: value.admin } }));
      const after = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count);
      expect(response.status).toBe(200);
      expect(after).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
