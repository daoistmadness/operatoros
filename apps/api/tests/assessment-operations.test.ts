import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const migrationRoot = repoRoot;
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "assessment-operations-test-cookie-secret-32";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
    "db = sqlite3.connect(path)",
    "year = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]",
    "jenjang = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]",
    "grade = db.execute(\"SELECT id FROM academic_grades WHERE jenjang_id = ?\", (jenjang,)).fetchone()[0]",
    "class_a = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ? AND class_name = '7A'\", (year,)).fetchone()[0]",
    "db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7B', 'B', 1)\", (year, grade))",
    "class_b = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ? AND class_name = '7B'\", (year,)).fetchone()[0]",
    "db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7C', 'C', 1)\", (year, grade))",
    "master_two = '22222222-2222-2222-2222-222222222222'",
    "master_three = '33333333-3333-3333-3333-333333333333'",
    "master_four = '44444444-4444-4444-4444-444444444444'",
    "db.execute(\"UPDATE student_enrollments SET class_assigned = 1 WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year,))",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'Assessment Student Two', 'assessment student two', 'active')\", (master_three,))",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'Assessment Student Three', 'assessment student three', 'active')\", (master_four,))",
    "db.execute(\"INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, lifecycle_state, effective_from) VALUES (?, ?, ?, ?, '7A', 1, 'ACTIVE', '2026-07-01')\", (master_two, year, jenjang, class_a))",
    "db.execute(\"INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, lifecycle_state, effective_from) VALUES (?, ?, ?, ?, '7B', 1, 'ACTIVE', '2026-07-01')\", (master_four, year, jenjang, class_b))",
    "db.execute(\"INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, lifecycle_state, effective_from) VALUES (?, ?, ?, NULL, 'Outside', 1, 'ACTIVE', '2026-07-01')\", (master_three, year, jenjang))",
    "math = db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)\", (jenjang,)).lastrowid",
    "science = db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Science', ?, 1, 1)\", (jenjang,)).lastrowid",
    "quiz = db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Quiz', 'formatif', ?)\", (math,)).lastrowid",
    "exam = db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Exam', 'sumatif', ?)\", (science,)).lastrowid",
    "db.execute(\"INSERT INTO academic_assessment_sessions (academic_year_id, term_number, label, assessment_date) VALUES (?, 1, 'Midterm', '2026-08-15')\", (year,))",
    "session_one = db.execute(\"SELECT id FROM academic_assessment_sessions WHERE label = 'Midterm'\").fetchone()[0]",
    "db.execute(\"INSERT INTO academic_assessment_sessions (academic_year_id, term_number, label, assessment_date) VALUES (?, 1, 'Project Review', NULL)\", (year,))",
    "session_two = db.execute(\"SELECT id FROM academic_assessment_sessions WHERE label = 'Project Review'\").fetchone()[0]",
    "db.execute(\"INSERT INTO academic_assessment_sessions (academic_year_id, term_number, label, assessment_date) VALUES (?, 2, 'Final', '2027-01-15')\", (year,))",
    "session_three = db.execute(\"SELECT id FROM academic_assessment_sessions WHERE label = 'Final'\").fetchone()[0]",
    "enrollment_one = db.execute(\"SELECT id FROM student_enrollments WHERE student_master_id = '11111111-1111-1111-1111-111111111111' AND academic_year_id = ?\", (year,)).fetchone()[0]",
    "enrollment_two = db.execute(\"SELECT id FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ? ORDER BY id DESC LIMIT 1\", (master_two, year)).fetchone()[0]",
    "enrollment_three = db.execute(\"SELECT id FROM student_enrollments WHERE student_master_id = ? AND academic_year_id = ?\", (master_three, year)).fetchone()[0]",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, 0)\", (enrollment_one, math, quiz, session_one))",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, NULL)\", (enrollment_two, math, quiz, session_one))",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, 88)\", (enrollment_one, math, quiz, session_two))",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, 91)\", (enrollment_two, math, quiz, session_two))",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, 73)\", (enrollment_three, math, quiz, session_one))",
    "db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, NULL, 99)\", (enrollment_one, science, exam))",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: migrationRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  expect(response.status).toBe(200);
  return cookie(response);
}

describe("academic assessment operations", () => {
  let path: string;
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;
  let admin: string;
  let staff: string;
  let yearId: number;
  let classAId: number;
  let classBId: number;
  let mathId: number;

  beforeAll(async () => {
    path = `/tmp/operatoros-assessment-operations-${process.pid}-${Date.now()}.db`;
    seed(path);
    database = openDatabase(path);
    app = createApp({ environment: "test", databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-assessment-operations-audit-${process.pid}` } });
    admin = await login(app, "golden-admin", "golden-admin-pass-1");
    staff = await login(app, "golden-staff", "golden-staff-pass-1");
    yearId = Number((database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number }).id);
    classAId = Number((database.client.query("SELECT id FROM academic_classes WHERE class_name = '7A' AND academic_year_id = ?").get(yearId) as { id: number }).id);
    classBId = Number((database.client.query("SELECT id FROM academic_classes WHERE class_name = '7B' AND academic_year_id = ?").get(yearId) as { id: number }).id);
    mathId = Number((database.client.query("SELECT id FROM subjects WHERE name = 'Mathematics'").get() as { id: number }).id);
  });

  afterAll(async () => {
    database?.close();
    await rm(path, { force: true });
  });

  const get = (params: Record<string, string>, auth = admin) => app.handle(new Request(`http://local/api/grades/assessment-operations?${new URLSearchParams({ academic_year_id: String(yearId), ...params })}`, { headers: { cookie: auth } }));

  it("returns exact coverage states, counts, date semantics, and valid zero-score presence", async () => {
    const response = await get({ class_id: String(classAId), subject_id: String(mathId), term: "term_1", page_size: "100" });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.totals).toMatchObject({ assessment_sessions: 2, scopes: 2, applicable_students: 4, recorded_scores: 3, unrecorded_scores: 1, complete_scopes: 1, partial_scopes: 1, no_score_scopes: 0, empty_scopes: 0 });
    expect(body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ assessment_label: "Midterm", applicable_student_count: 2, recorded_score_count: 1, unrecorded_score_count: 1, coverage_percent: 50, coverage_state: "PARTIAL", assessment_date: "2026-08-15" }),
      expect.objectContaining({ assessment_label: "Project Review", applicable_student_count: 2, recorded_score_count: 2, unrecorded_score_count: 0, coverage_percent: 100, coverage_state: "COMPLETE", assessment_date: null }),
    ]));
  });

  it("keeps no scores, empty classes, and out-of-scope scores distinct", async () => {
    const noScores = await get({ class_id: String(classBId), subject_id: String(mathId), term: "term_1", coverage_state: "NONE", page_size: "100" });
    expect(noScores.status).toBe(200);
    const noneBody = await noScores.json() as any;
    expect(noneBody.total).toBe(2);
    expect(noneBody.sessions.every((value: any) => value.coverage_state === "NONE" && value.recorded_score_count === 0)).toBe(true);

    const empty = await get({ subject_id: String(mathId), term: "term_1", search: "7C", coverage_state: "EMPTY", page_size: "100" });
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json() as any;
    expect(emptyBody.total).toBe(2);
    expect(emptyBody.sessions.every((value: any) => value.coverage_state === "EMPTY" && value.coverage_percent === null)).toBe(true);
  });

  it("relies on the canonical unique enrollment constraint to prevent duplicate roster rows", () => {
    const enrollment = database.client.query("SELECT student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name FROM student_enrollments WHERE student_master_id = '22222222-2222-2222-2222-222222222222'").get() as any;
    expect(() => database.client.run("INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, lifecycle_state, effective_from) VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE', '2026-07-01')", [enrollment.student_master_id, enrollment.academic_year_id, enrollment.jenjang_id, enrollment.academic_class_id, enrollment.class_name])).toThrow();
  });

  it("supports term, search, sorting, pagination, and excludes legacy unknown-period scores", async () => {
    const termTwo = await get({ term: "term_2", subject_id: String(mathId), sort: "assessment", order: "desc", page: "1", page_size: "1" });
    expect(termTwo.status).toBe(200);
    const body = await termTwo.json() as any;
    expect(body.total).toBe(3);
    expect(body.page_size).toBe(1);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ assessment_label: "Final", term_number: 2, assessment_date: "2027-01-15" });

    const search = await get({ search: "Project Review", subject_id: String(mathId), page_size: "100" });
    expect(search.status).toBe(200);
    const searchBody = await search.json() as any;
    expect(searchBody.total).toBe(3);
    expect(searchBody.sessions.every((value: any) => value.assessment_label === "Project Review")).toBe(true);
  });

  it("enforces current admin-only grade authority and does not mutate business rows", async () => {
    const before = database.client.query("SELECT (SELECT COUNT(*) FROM student_subject_grades) AS grades, (SELECT COUNT(*) FROM academic_assessment_sessions) AS sessions, (SELECT COUNT(*) FROM student_enrollments) AS enrollments").get();
    expect((await get({}, "")).status).toBe(401);
    expect((await get({}, staff)).status).toBe(403);
    expect((await get({ subject_id: String(mathId) }, admin)).status).toBe(200);
    const after = database.client.query("SELECT (SELECT COUNT(*) FROM student_subject_grades) AS grades, (SELECT COUNT(*) FROM academic_assessment_sessions) AS sessions, (SELECT COUNT(*) FROM student_enrollments) AS enrollments").get();
    expect(after).toEqual(before);
    const body = await (await get({ subject_id: String(mathId) })).json() as any;
    expect(JSON.stringify(body)).not.toMatch(/risk|atRisk|alert|intervention|overdue|failed/i);
  });
});
