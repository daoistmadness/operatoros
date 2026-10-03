import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAssessmentFixture } from "./fixtures/assessments";

const secret = "assessment-operations-test-cookie-secret-32";

function seed(path: string): void {
  createAssessmentFixture(path, "operations");
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
  }, 30000);

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
