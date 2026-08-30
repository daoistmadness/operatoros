import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { studentTrendInsights } from "../src/domains/student-trends";
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
  `);
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-01-01', '2026-03-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP')");
  client.run("INSERT INTO academic_grades VALUES (1, 1)");
  client.run("INSERT INTO academic_classes VALUES (1, 1, 1, '7A')");
  client.run("INSERT INTO student_masters VALUES ('student-a', 'Alya'), ('student-b', 'Bima')");
  client.run("INSERT INTO students VALUES (1, 'Alya legacy', '7A'), (2, 'Bima legacy', '7A')");
  client.run("INSERT INTO student_enrollments VALUES (1, 1, 'student-a', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE'), (2, 2, 'student-b', 1, 1, 1, '7A', '2026-02-01', NULL, 'ACTIVE')");
  client.run("INSERT INTO attendance VALUES (1, 1, '2026-01-30', 'late'), (2, 1, '2026-02-01', 'alfa'), (3, 1, '2026-03-10', 'on-time'), (4, 1, '2026-03-11', 'late'), (5, 1, '2026-03-12', 'alfa'), (6, 2, '2026-03-15', 'on-time')");
  client.run("INSERT INTO attendance_overrides VALUES (1, 1, 'late', 'on-time')");
  client.run("INSERT INTO academic_term_configs VALUES (1, 1, 1, 'Term 1', '2026-01-01', '2026-02-15'), (2, 1, 2, 'Term 2', '2026-02-16', '2026-03-31')");
  return { database: { client } } as AuthContext;
}

describe("student trend insights", () => {
  it("compares deterministic rolling windows and applies attendance overrides", () => {
    const value = context();
    try {
      const response = studentTrendInsights(value, { academic_year_id: "1", page_size: "25" });
      expect(response.window).toMatchObject({ kind: "rolling_4w", anchorDate: "2026-03-15", currentStart: "2026-02-16", currentEnd: "2026-03-15", previousStart: "2026-01-19", previousEnd: "2026-02-15" });
      const alya = response.rows.find((student) => student.studentId === "student-a")!;
      expect(alya.attendance).toMatchObject({ current: 66.67, previous: 50, delta: 16.67, direction: "up", currentSampleSize: 3, previousSampleSize: 2 });
      expect(alya.tardiness).toMatchObject({ current: 50, previous: 0, delta: 50, direction: "up" });
      expect(alya.alfa).toMatchObject({ current: 33.33, previous: 50, delta: -16.67, direction: "down" });
      expect(alya.academic).toMatchObject({ current: null, previous: null, delta: null, direction: "insufficient_data" });
    } finally { value.database.client.close(); }
  });

  it("does not turn missing previous data into zero and supports term boundaries", () => {
    const value = context();
    try {
      const response = studentTrendInsights(value, { academic_year_id: "1", window: "term", search: "Bima", page: "1", page_size: "1" });
      expect(response.window).toMatchObject({ kind: "term", currentStart: "2026-02-16", currentEnd: "2026-03-15", previousStart: "2026-01-01", previousEnd: "2026-01-28" });
      expect(response.totalStudents).toBe(1);
      expect(response.rows[0]?.attendance).toMatchObject({ current: 100, previous: null, delta: null, direction: "insufficient_data" });
    } finally { value.database.client.close(); }
  });

  it("uses server-side pagination, stable sorting, and no business-table writes", () => {
    const value = context();
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = studentTrendInsights(value, { academic_year_id: "1", sort: "attendance_delta", order: "desc", page: "2", page_size: "1" });
      expect(response.totalStudents).toBe(2);
      expect(response.page).toBe(2);
      expect(response.pageSize).toBe(1);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
      expect(JSON.stringify(response)).not.toMatch(/risk|alert|intervention|atRisk/i);
    } finally { value.database.client.close(); }
  });

  it("protects the HTTP endpoint with the existing student capability", async () => {
    const value = context();
    try {
      const app = createApp({ environment: "test", databaseHandle: value.database, auth: { authCookieSecret: "student-trends-test-auth-secret-32" } });
      const response = await app.handle(new Request("http://local/api/analytics/student-trends?academic_year_id=1"));
      expect(response.status).toBe(401);
    } finally { value.database.client.close(); }
  });
});
