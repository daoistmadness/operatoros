import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
    "db = sqlite3.connect(path); year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]; jenjang_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]; grade_id = db.execute(\"SELECT id FROM academic_grades WHERE jenjang_id = ?\", (jenjang_id,)).fetchone()[0]; class_id = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ?\", (year_id,)).fetchone()[0]; db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7B', 'B', 1)\", (year_id, grade_id)); class_b = db.execute('SELECT last_insert_rowid()').fetchone()[0]",
    "db.execute(\"UPDATE student_enrollments SET student_id = 701 WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,)); names = [(705, 'Beta Academic', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', class_id), (706, 'Gamma Academic', 'cccccccc-cccc-cccc-cccc-cccccccccccc', class_b)]; db.executemany(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", [(mid, name, name.lower()) for _, name, mid, _ in names]); db.executemany(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, 'SMP', ?)\", [(sid, name, '7A' if cls == class_id else '7B') for sid, name, _, cls in names]); db.executemany(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, 1, '2026-07-01', 'ACTIVE')\", [(sid, mid, year_id, jenjang_id, cls, '7A' if cls == class_id else '7B') for sid, _, mid, cls in names])",
    "db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)\", (jenjang_id,)); math_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Science', ?, 1, 1)\", (jenjang_id,)); science_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Quiz', 'formatif', ?), ('Exam', 'sumatif', ?), ('Project', 'sumatif', ?)\", (math_id, math_id, science_id)); components = db.execute(\"SELECT id, name FROM assessment_components WHERE subject_id IN (?, ?) ORDER BY id\", (math_id, science_id)).fetchall(); quiz, exam, project = [item[0] for item in components]",
    "enrollment = lambda sid: db.execute(\"SELECT id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ?\", (sid, year_id)).fetchone()[0]; rows = [(enrollment(701), math_id, quiz, 80), (enrollment(701), math_id, exam, 90), (enrollment(701), science_id, project, 70), (enrollment(705), math_id, quiz, 60), (enrollment(705), science_id, project, 100), (enrollment(706), math_id, quiz, 100), (enrollment(706), math_id, exam, 80)]; db.executemany(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, ?)\", rows); db.execute(\"INSERT INTO kkm_thresholds (academic_year_id, jenjang_id, subject_id, assessment_type, threshold) VALUES (?, ?, ?, 'overall', 85)\", (year_id, jenjang_id, math_id)); db.commit(); db.close()",
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
  const path = `/tmp/operatoros-academic-analytics-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-academic-analytics-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  return { path, database, app, yearId: year.id, admin: cookie(admin), staff: cookie(staff), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("academic analytics expansion", () => {
  it("uses canonical score rows, missing slots, KKM, and weighted denominators", async () => {
    const value = await setup("overview");
    try {
      const query = `?academic_year_id=${value.yearId}`;
      const response = await value.app.handle(new Request(`http://local/api/analytics/academic/overview${query}`, { headers: { cookie: value.admin } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.summary).toMatchObject({ students: 3, assessments: 3, expectedResults: 9, scoredResults: 7, missingResults: 2, participationPercentage: 77.8 });
      expect(body.summary.score).toMatchObject({ average: 82.9, scoreSum: 580, scoreCount: 7, min: 60, max: 100 });
      expect(body.summary.formative).toMatchObject({ average: 80, scoreCount: 3 });
      expect(body.summary.summative).toMatchObject({ average: 85, scoreCount: 4 });
      expect(body.summary.mastery).toMatchObject({ evaluatedResults: 7, meetingResults: 3, belowResults: 4 });
      expect(body.distribution.map((item: any) => item.count)).toEqual([0, 0, 1, 1, 2, 3]);
      expect(body.subjects.find((item: any) => item.label === "Mathematics")).toMatchObject({ students: 3, assessments: 2, scoredResults: 5, missingResults: 1, average: 82 });
      expect(body.classes).toHaveLength(2);
      expect(body.jenjang).toHaveLength(1);
      expect(body.assessments).toHaveLength(3);
      expect(body.scope.term).toBeNull();
      expect(body.metricDefinitions.term).toContain("no term field");
    } finally { value.cleanup(); }
  }, 30000);

  it("supports filters, server-side student pagination, and authorization", async () => {
    const value = await setup("filters");
    try {
      const base = `?academic_year_id=${value.yearId}`;
      const options = await value.app.handle(new Request(`http://local/api/analytics/academic/options${base}`, { headers: { cookie: value.staff } }));
      expect(options.status).toBe(200);
      expect((await options.json() as any).subjects).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Mathematics" }), expect.objectContaining({ name: "Science" })]));
      const filtered = await value.app.handle(new Request(`${"http://local/api/analytics/academic/overview"}${base}&assessment_type=formatif`, { headers: { cookie: value.staff } }));
      expect(filtered.status).toBe(200);
      expect((await filtered.json() as any).summary).toMatchObject({ expectedResults: 3, scoredResults: 3, score: { average: 80 } });
      const students = await value.app.handle(new Request(`http://local/api/analytics/academic/students${base}&search=beta&page_size=1`, { headers: { cookie: value.staff } }));
      expect(students.status).toBe(200);
      expect(await students.json()).toMatchObject({ total: 1, rows: [expect.objectContaining({ studentName: "Beta Academic", missingAssessments: 1, average: 80 })] });
      const anonymous = await value.app.handle(new Request(`http://local/api/analytics/academic/overview${base}`));
      expect(anonymous.status).toBe(401);
      const exportDenied = await value.app.handle(new Request(`http://local/api/analytics/academic/export-excel${base}`, { headers: { cookie: value.staff } }));
      expect(exportDenied.status).toBe(403);
    } finally { value.cleanup(); }
  }, 30000);

  it("exports the same filtered server aggregates without mutating grades", async () => {
    const value = await setup("export");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM student_subject_grades").get() as { count: number }).count);
      const mathId = Number((value.database.client.query("SELECT id FROM subjects WHERE name = 'Mathematics'").get() as { id: number }).id);
      const response = await value.app.handle(new Request(`http://local/api/analytics/academic/export-excel?academic_year_id=${value.yearId}&subject_id=${mathId}`, { headers: { cookie: value.admin } }));
      expect(response.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await response.arrayBuffer()));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Subjects", "Classes", "Jenjang", "Assessments", "Students", "Distribution"]);
      expect(workbook.getWorksheet("Summary")?.getRow(2).getCell(2).value).toBe("2026/2027-academic");
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM student_subject_grades").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
