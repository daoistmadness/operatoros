import { describe, expect, it } from "bun:test";
import { rmSync, existsSync } from "node:fs";
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
    "db = sqlite3.connect(path); year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]; jenjang_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]; class_id = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ?\", (year_id,)).fetchone()[0]; db.execute(\"UPDATE student_enrollments SET student_id = 701 WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,))",
    "subject_id = db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)\", (jenjang_id,)).lastrowid; component_id = db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Quiz', 'formatif', ?)\", (subject_id,)).lastrowid; enrollment_id = db.execute(\"SELECT id FROM student_enrollments WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,)).fetchone()[0]; db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, 88)\", (enrollment_id, subject_id, component_id))",
    "db.executemany(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)\", [(701, '2026-08-03', '07:10:00', '16:00:00', 0, 'test', 0, 'on-time'), (701, '2026-08-04', '07:40:00', '16:00:00', 25, 'test', 0, 'late')])",
    "late_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 701 AND date = '2026-08-04'\").fetchone()[0]; db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'on-time', 'Correction', 'golden-admin', '2026-08-04T10:00:00Z')\", (late_id,)); db.commit(); db.close()",
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
  const path = `/tmp/operatoros-management-overview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-management-overview-audit-${process.pid}` } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  return { app, database, yearId: year.id, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("management analytics overview", () => {
  it("matches the canonical analytics authorities", async () => {
    const value = await setup("canonical");
    try {
      const query = `?academic_year_id=${value.yearId}&attendance_date_from=2026-08-01&attendance_date_to=2026-08-31`;
      const headers = { cookie: value.admin };
      const overview = await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`, { headers }));
      expect(overview.status).toBe(200);
      const body = await overview.json() as any;
      const recap = await value.app.handle(new Request(`http://local/api/analytics/recapitulation/students?academic_year_id=${value.yearId}&dimension=jenjang&status=ACTIVE`, { headers }));
      const attendance = await value.app.handle(new Request(`http://local/api/analytics/attendance/overview?academic_year_id=${value.yearId}&date_from=2026-08-01&date_to=2026-08-31`, { headers }));
      const academic = await value.app.handle(new Request(`http://local/api/analytics/academic/overview?academic_year_id=${value.yearId}`, { headers }));
      const quality = await value.app.handle(new Request(`http://local/api/analytics/data-quality/students?academic_year_id=${value.yearId}&status=ACTIVE`, { headers }));
      expect(body.school.students.activeStudents).toBe((await recap.json() as any).total);
      expect(body.attendance).toMatchObject({ attendanceRate: (await attendance.clone().json() as any).attendanceRate, present: 2, late: 0, overriddenRecords: 1 });
      expect(body.academic).toMatchObject({ average: (await academic.json() as any).summary.score.average, students: 1 });
      const qualityBody = await quality.json() as any;
      expect(body.dataQuality.students).toMatchObject({ total: qualityBody.totalStudents, issueCount: qualityBody.recordsWithRequiredIssues });
      expect(body.scope).toMatchObject({ academicYearId: value.yearId, attendanceDateFrom: "2026-08-01", attendanceDateTo: "2026-08-31" });
    } finally { value.cleanup(); }
  }, 30000);

  it("enforces authentication and returns unavailable staff data", async () => {
    const value = await setup("authorization");
    try {
      const query = `?academic_year_id=${value.yearId}`;
      expect((await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`))).status).toBe(401);
      const response = await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`, { headers: { cookie: value.staff } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.school.staff).toEqual({ status: "unavailable", reason: "unauthorized" });
      expect(body.dataQuality.staff).toEqual({ status: "unavailable", reason: "unauthorized" });
      expect(body.school.students.status).toBe("available");
      expect(body.attendance.status).toBe("available");
    } finally { value.cleanup(); }
  }, 30000);

  it("rejects invalid scope without touching business data", async () => {
    const value = await setup("validation");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = await value.app.handle(new Request("http://local/api/analytics/management-overview?academic_year_id=999999", { headers: { cookie: value.admin } }));
      expect(response.status).toBe(400);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
