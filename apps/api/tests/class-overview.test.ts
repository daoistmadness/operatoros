import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
    "db = sqlite3.connect(path); year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]; jenjang_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]; class_id = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ?\", (year_id,)).fetchone()[0]; db.execute(\"UPDATE student_enrollments SET student_id = 701 WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,)); db.execute(\"INSERT INTO teacher_class_assignments (user_id, academic_year_id, academic_class_id, class_role, active, assigned_by) SELECT id, ?, ?, 'HOMEROOM_TEACHER', 1, 'golden-admin' FROM users WHERE username = 'golden-staff'\", (year_id, class_id)); db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) SELECT academic_year_id, grade_id, 'SMP-2', 'B', 1 FROM academic_classes WHERE id = ?\", (class_id,)); subject_id = db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)\", (jenjang_id,)).lastrowid; component_id = db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Quiz', 'formatif', ? )\", (subject_id,)).lastrowid; enrollment_id = db.execute(\"SELECT id FROM student_enrollments WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,)).fetchone()[0]; db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, 88)\", (enrollment_id, subject_id, component_id)); db.executemany(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)\", [(701, '2026-08-03', '07:10:00', '16:00:00', 0, 'test', 0, 'on-time'), (701, '2026-08-04', '07:40:00', '16:00:00', 25, 'test', 0, 'late')]); late_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 701 AND date = '2026-08-04'\").fetchone()[0]; db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'on-time', 'Correction', 'golden-admin', '2026-08-04T10:00:00Z')\", (late_id,)); db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-class-overview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-overview-audit-${process.pid}` } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  const classValue = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id LIMIT 1").get(year.id) as { id: number };
  const otherClass = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id DESC LIMIT 1").get(year.id) as { id: number };
  return { app, database, yearId: year.id, classId: classValue.id, otherClassId: otherClass.id, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("class overview", () => {
  it("composes canonical class, roster, attendance, academic, and quality data", async () => {
    const value = await setup("canonical");
    try {
      const query = "?attendance_date_from=2026-08-01&attendance_date_to=2026-08-31";
      const headers = { cookie: value.admin };
      const response = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview${query}`, { headers }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.class).toMatchObject({ id: value.classId, name: "7A", jenjang: "SMP", academicYearId: value.yearId });
      expect(body.roster.total).toBe(1);
      expect(body.roster.rows[0]).toMatchObject({ studentName: "Academic Master 1111", enrollmentStatus: "ACTIVE", dataQualityIssueCount: 3 });
      expect(body.roster.rows[0].student360Link).toBe("/students/11111111-1111-1111-1111-111111111111?academic_year_id=2&class_id=1");
      expect(body.attendance).toMatchObject({ totalRecords: 2, attendanceRate: 100, overriddenRecords: 1 });
      expect(body.academic).toMatchObject({ average: 88, students: 1, periodStatus: "mixed" });
      expect(body.dataQuality).toMatchObject({ totalStudents: 1, recordsWithRequiredIssues: 0 });
      expect(JSON.stringify(body)).not.toMatch(/risk|alert|intervention|classification/i);
    } finally { value.cleanup(); }
  }, 30000);

  it("enforces assignment scope and preserves term context", async () => {
    const value = await setup("authorization");
    try {
      const staffResponse = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview?term=term_1`, { headers: { cookie: value.staff } }));
      expect(staffResponse.status).toBe(200);
      expect((await staffResponse.json() as any).academic).toMatchObject({ term: 1, periodStatus: "known" });
      const forbidden = await value.app.handle(new Request(`http://local/api/classes/${value.otherClassId}/overview`, { headers: { cookie: value.staff } }));
      expect(forbidden.status).toBe(403);
      expect((await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview`))).status).toBe(401);
    } finally { value.cleanup(); }
  }, 30000);

  it("rejects invalid dates without mutating business data", async () => {
    const value = await setup("readonly");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview?attendance_date_from=2026-09-01&attendance_date_to=2026-08-01`, { headers: { cookie: value.admin } }));
      expect(response.status).toBe(400);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
