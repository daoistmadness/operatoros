import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { studentIndicatorInsights } from "../src/domains/student-indicators";
import { studentTrendInsights } from "../src/domains/student-trends";
import { academicOverview } from "../src/domains/academic-analytics";
import type { AuthContext } from "../src/auth/service";
import { createApp } from "../src/app";

function context(): AuthContext {
  const client = new Database(":memory:");
  client.run(`
    CREATE TABLE academic_years (id INTEGER PRIMARY KEY, label TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE academic_grades (id INTEGER PRIMARY KEY, jenjang_id INTEGER);
    CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, grade_id INTEGER, class_name TEXT);
    CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
    CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, class_name TEXT);
    CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT, lifecycle_state TEXT);
    CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, status TEXT);
    CREATE TABLE attendance_overrides (id INTEGER PRIMARY KEY, attendance_id INTEGER, original_status TEXT, override_status TEXT);
    CREATE TABLE academic_term_configs (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, label TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE kkm_thresholds (id INTEGER PRIMARY KEY, academic_year_id INTEGER, jenjang_id INTEGER, subject_id INTEGER, assessment_type TEXT, threshold REAL);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT, jenjang_id INTEGER);
    CREATE TABLE assessment_components (id INTEGER PRIMARY KEY, name TEXT, assessment_type TEXT, subject_id INTEGER);
    CREATE TABLE student_subject_grades (id INTEGER PRIMARY KEY, enrollment_id INTEGER, subject_id INTEGER, component_id INTEGER, score REAL);
  `);
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-01-01', '2026-03-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP')");
  client.run("INSERT INTO academic_grades VALUES (1, 1)");
  client.run("INSERT INTO academic_classes VALUES (1, 1, 1, '7A')");
  client.run("INSERT INTO student_masters VALUES ('student-a', 'Alya'), ('student-b', 'Bima')");
  client.run("INSERT INTO students VALUES (1, 'Alya legacy', '7A'), (2, 'Bima legacy', '7A')");
  client.run("INSERT INTO student_enrollments VALUES (1, 1, 'student-a', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE'), (2, 2, 'student-b', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE')");
  client.run("INSERT INTO academic_classes VALUES (2, 1, 1, '7B'); UPDATE student_enrollments SET academic_class_id = 2, class_name = '7B' WHERE id = 2");
  client.run("INSERT INTO attendance VALUES (1, 1, '2026-01-30', 'late'), (2, 1, '2026-02-01', 'alfa'), (3, 1, '2026-03-10', 'on-time'), (4, 1, '2026-03-11', 'late'), (5, 1, '2026-03-12', 'alfa'), (6, 2, '2026-03-15', 'on-time')");
  client.run("INSERT INTO attendance_overrides VALUES (1, 1, 'late', 'on-time')");
  client.run("INSERT INTO subjects VALUES (1, 'Mathematics', 1)");
  client.run("INSERT INTO assessment_components VALUES (1, 'Quiz', 'formatif', 1), (2, 'Exam', 'sumatif', 1)");
  client.run("INSERT INTO student_subject_grades VALUES (1, 1, 1, 1, 80), (2, 1, 1, 2, 70)");
  client.run("INSERT INTO academic_term_configs VALUES (1, 1, 1, 'Term 1', '2026-01-01', '2026-02-15'), (2, 1, 2, 'Term 2', '2026-02-16', '2026-03-31')");
  return { database: { client } } as AuthContext;
}

describe("student indicator insights", () => {
  it("reuses attendance semantics, reports current academic measurements, and keeps academic change unavailable", () => {
    const value = context();
    try {
      const response = studentIndicatorInsights(value, { academic_year_id: "1", page_size: "25", sort: "academic_average", order: "desc" });
      const alya = response.rows.find((student) => student.studentId === "student-a")!;
      const trends = studentTrendInsights(value, { academic_year_id: "1" });
      const trendAlya = trends.rows.find((student) => student.studentId === "student-a")!;
      const academic = academicOverview(value, { academic_year_id: "1", class_id: "1" })!;
      expect(alya.attendanceRate).toMatchObject({ current: 66.67, previous: 50, delta: 16.67, currentSampleSize: 3, previousSampleSize: 2, dataStatus: "available" });
      expect(alya.tardinessRate).toMatchObject({ current: 50, previous: 0, delta: 50, currentSampleSize: 2, previousSampleSize: 1 });
      expect(alya.alfaRate).toMatchObject({ current: 33.33, previous: 50, delta: -16.67 });
      expect(alya.academicAverage).toMatchObject({ current: 75, previous: null, delta: null, direction: "insufficient_data", currentSampleSize: 2 });
      expect(alya.academicParticipation).toMatchObject({ current: 100, previous: null, delta: null, currentSampleSize: 2 });
      expect(alya.dataAvailability).toEqual({ attendance: "available", comparison: "available", academic: "available" });
      expect(alya.attendanceRate?.current).toBe(trendAlya.attendance?.current);
      expect(alya.tardinessRate?.current).toBe(trendAlya.tardiness?.current);
      expect(alya.alfaRate?.current).toBe(trendAlya.alfa?.current);
      expect(alya.academicAverage.current).toBe(academic.summary.score.average);
      expect(alya.academicParticipation.current).toBe(academic.summary.participationPercentage);
      expect(response.indicatorDefinitions.map((item) => item.id)).toEqual(["attendance_rate", "tardiness_rate", "alfa_rate", "academic_average", "academic_participation"]);
      expect(response.limitations.join(" ")).toContain("no date or term field");
      expect(JSON.stringify(response)).not.toMatch(/risk|alert|intervention|severity|threshold|recommendation|atRisk/i);
    } finally { value.database.client.close(); }
  });

  it("uses deterministic pagination, preserves no-data semantics, and does not write business data", () => {
    const value = context();
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = studentIndicatorInsights(value, { academic_year_id: "1", page: "2", page_size: "1", sort: "academic_average", order: "desc" });
      expect(response.totalStudents).toBe(2);
      expect(response.page).toBe(2);
      expect(response.rows[0]?.studentId).toBe("student-b");
      expect(response.rows[0]?.academicAverage).toMatchObject({ current: null, previous: null, delta: null, dataStatus: "not_applicable" });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
    } finally { value.database.client.close(); }
  });

  it("requires the existing student capability at the HTTP boundary", async () => {
    const value = context();
    try {
      const app = createApp({ environment: "test", databaseHandle: value.database, auth: { authCookieSecret: "student-indicators-test-auth-secret-32" } });
      const response = await app.handle(new Request("http://local/api/analytics/student-indicators?academic_year_id=1"));
      expect(response.status).toBe(401);
    } finally { value.database.client.close(); }
  });
});
