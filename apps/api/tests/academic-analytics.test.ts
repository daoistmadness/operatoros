import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createAssessmentFixture } from "./fixtures/assessments";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createAssessmentFixture(path, "analytics");
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
      const response = await value.app.handle(new Request(`http://local/api/analytics/academic/overview${query}`, { headers: { cookie: value.admin, origin: "http://localhost:5173" } }));
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
      expect(body.metricDefinitions.term).toContain("period-unknown");
    } finally { value.cleanup(); }
  }, 30000);

  it("supports filters, server-side student pagination, and authorization", async () => {
    const value = await setup("filters");
    try {
      const base = `?academic_year_id=${value.yearId}`;
      const options = await value.app.handle(new Request(`http://local/api/analytics/academic/options${base}`, { headers: { cookie: value.staff, origin: "http://localhost:5173" } }));
      expect(options.status).toBe(200);
      expect((await options.json() as any).subjects).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Mathematics" }), expect.objectContaining({ name: "Science" })]));
      const filtered = await value.app.handle(new Request(`${"http://local/api/analytics/academic/overview"}${base}&assessment_type=formatif`, { headers: { cookie: value.staff, origin: "http://localhost:5173" } }));
      expect(filtered.status).toBe(200);
      expect((await filtered.json() as any).summary).toMatchObject({ expectedResults: 3, scoredResults: 3, score: { average: 80 } });
      const students = await value.app.handle(new Request(`http://local/api/analytics/academic/students${base}&search=beta&page_size=1`, { headers: { cookie: value.staff, origin: "http://localhost:5173" } }));
      expect(students.status).toBe(200);
      expect(await students.json()).toMatchObject({ total: 1, rows: [expect.objectContaining({ studentName: "Beta Academic", missingAssessments: 1, average: 80 })] });
      const anonymous = await value.app.handle(new Request(`http://local/api/analytics/academic/overview${base}`));
      expect(anonymous.status).toBe(401);
      const exportDenied = await value.app.handle(new Request(`http://local/api/analytics/academic/export-excel${base}`, { headers: { cookie: value.staff, origin: "http://localhost:5173" } }));
      expect(exportDenied.status).toBe(403);
    } finally { value.cleanup(); }
  }, 30000);

  it("exports the same filtered server aggregates without mutating grades", async () => {
    const value = await setup("export");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM student_subject_grades").get() as { count: number }).count);
      const mathId = Number((value.database.client.query("SELECT id FROM subjects WHERE name = 'Mathematics'").get() as { id: number }).id);
      const response = await value.app.handle(new Request(`http://local/api/analytics/academic/export-excel?academic_year_id=${value.yearId}&subject_id=${mathId}`, { headers: { cookie: value.admin, origin: "http://localhost:5173" } }));
      expect(response.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await response.arrayBuffer()));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Subjects", "Classes", "Jenjang", "Assessments", "Students", "Distribution"]);
      expect(workbook.getWorksheet("Summary")?.getRow(2).getCell(2).value).toBe("2026/2027-academic");
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM student_subject_grades").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);

  it("filters session-attributed scores and compares adjacent academic terms", async () => {
    const value = await setup("timeline");
    try {
      const enrollment = value.database.client.query("SELECT id, student_master_id FROM student_enrollments WHERE student_id = 701 AND academic_year_id = ?").get(value.yearId) as { id: number; student_master_id: string };
      const math = value.database.client.query("SELECT id FROM subjects WHERE name = 'Mathematics'").get() as { id: number };
      const quiz = value.database.client.query("SELECT id FROM assessment_components WHERE name = 'Quiz'").get() as { id: number };
      const invalidDate = await value.app.handle(new Request("http://local/api/grades/assessment-sessions", { method: "POST", headers: { cookie: value.admin, "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ academic_year_id: value.yearId, term_number: 1, label: "Invalid date", assessment_date: "not-a-date" }) }));
      expect(invalidDate.status).toBe(400);
      const outsideTerm = await value.app.handle(new Request("http://local/api/grades/assessment-sessions", { method: "POST", headers: { cookie: value.admin, "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ academic_year_id: value.yearId, term_number: 1, label: "Outside term", assessment_date: "2026-11-15" }) }));
      expect(outsideTerm.status).toBe(400);
      const makeSession = async (term: number, label: string, date: string) => {
        const response = await value.app.handle(new Request("http://local/api/grades/assessment-sessions", { method: "POST", headers: { cookie: value.admin, "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ academic_year_id: value.yearId, term_number: term, label, assessment_date: date }) }));
        expect(response.status).toBe(200);
        return await response.json() as { id: number };
      };
      const first = await makeSession(1, "Term 1 quiz", "2026-08-15");
      const second = await makeSession(2, "Term 2 quiz", "2026-11-15");
      value.database.client.run("INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)", [enrollment.id, math.id, quiz.id, first.id, 70, enrollment.id, math.id, quiz.id, second.id, 80]);

      const termOne = await value.app.handle(new Request(`http://local/api/analytics/academic/overview?academic_year_id=${value.yearId}&term=term_1`, { headers: { cookie: value.admin, origin: "http://localhost:5173" } }));
      expect(termOne.status).toBe(200);
      expect(await termOne.json()).toMatchObject({ scope: { term: 1 }, summary: { scoredResults: 1, score: { average: 70 } } });
      const trends = await value.app.handle(new Request(`http://local/api/analytics/student-trends?academic_year_id=${value.yearId}&student_id=${enrollment.student_master_id}&window=term`, { headers: { cookie: value.admin, origin: "http://localhost:5173" } }));
      expect(trends.status).toBe(200);
      expect((await trends.json() as any).rows[0].academic).toMatchObject({ current: 80, previous: 70, delta: 10, currentSampleSize: 1, previousSampleSize: 1 });
      const overview = await value.app.handle(new Request(`http://local/api/student-masters/${enrollment.student_master_id}/overview`, { headers: { cookie: value.admin, origin: "http://localhost:5173" } }));
      expect(overview.status).toBe(200);
      const overviewBody = await overview.json() as any;
      expect(overviewBody).toMatchObject({ academic: { temporalTrend: "available" } });
      expect(overviewBody.academic.history.filter((value: any) => value.periodStatus === "known")).toEqual([
        expect.objectContaining({ periodStatus: "known", termNumber: 1 }),
        expect.objectContaining({ periodStatus: "known", termNumber: 2 }),
      ]);
      expect(overviewBody.academic.history.filter((value: any) => value.periodStatus === "unknown")).toHaveLength(3);
    } finally { value.cleanup(); }
  }, 30000);
});
