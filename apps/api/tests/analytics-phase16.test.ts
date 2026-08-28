import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { analyticsCohorts, analyticsOverview, analyticsTrends, roundHalfEven } from "../src/analytics/queries";
import type { AuthContext } from "../src/auth/service";

function context(): AuthContext {
  const client = new Database(":memory:");
  client.run(`
    CREATE TABLE academic_years (id INTEGER PRIMARY KEY, label TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, jenjang TEXT, class_name TEXT);
    CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, class_name TEXT);
    CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, class_name TEXT);
    CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, status TEXT);
    CREATE TABLE attendance_overrides (attendance_id INTEGER PRIMARY KEY, override_status TEXT);
    CREATE TABLE absence_reasons (id INTEGER PRIMARY KEY, student_id INTEGER, year INTEGER, month INTEGER, sakit INTEGER, izin INTEGER, alfa INTEGER);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT, jenjang_id INTEGER);
    CREATE TABLE student_subject_grades (id INTEGER PRIMARY KEY, enrollment_id INTEGER, subject_id INTEGER, score REAL);
  `);
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-01-01', '2026-03-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP')");
  client.run("INSERT INTO students VALUES (1, 'Alya', 'SMP', '7A'), (2, 'Bima', 'SMP', '7B')");
  client.run("INSERT INTO academic_classes VALUES (1, '7A'), (2, '7B')");
  client.run("INSERT INTO student_enrollments VALUES (1, 1, 1, 1, 1, '7A'), (2, 2, 1, 1, 2, '7B')");
  client.run("INSERT INTO attendance VALUES (1, 1, '2026-01-10', 'on-time'), (2, 1, '2026-01-11', 'late'), (3, 2, '2026-01-10', 'absent')");
  client.run("INSERT INTO absence_reasons VALUES (1, 2, 2026, 1, 1, 0, 0)");
  client.run("INSERT INTO subjects VALUES (1, 'Matematika', 1)");
  client.run("INSERT INTO student_subject_grades VALUES (1, 1, 1, 80), (2, 1, 1, 90), (3, 2, 1, NULL)");
  return { database: { client } } as AuthContext;
}

describe("Phase 16 canonical analytics aggregates", () => {
  it("keeps canonical rounding and protects analytics routes", async () => {
    expect(roundHalfEven(80.05)).toBe(80);
    expect(roundHalfEven(80.15)).toBe(80.2);
    const client = new Database(":memory:");
    const app = createApp({ environment: "test", databaseHandle: { client } as any, auth: { authCookieSecret: "phase16-test-auth-secret-32-characters" } });
    try {
      for (const path of ["overview?academic_year_id=1", "trends?academic_year_id=1", "cohorts?academic_year_id=1&dimension=class"]) {
        expect((await app.handle(new Request(`http://local/api/analytics/${path}`))).status).toBe(401);
      }
    } finally {
      client.close();
    }
  });

  it("computes overview metrics and cohort comparisons with SQL aggregates", () => {
    const value = context();
    try {
      const overview = analyticsOverview(value, { academic_year_id: 1 });
      expect(overview.contract_version).toBe("analytics.v1");
      expect(overview.summary).toMatchObject({
        student_count: 2,
        attendance_counts: { present: 2, late: 1, sakit: 1, izin: 0, alfa: 0 },
        attendance_rate: { value: 66.7, numerator: 2, denominator: 3, status: "value" },
        grade_average: { value: 85, numerator: 170, denominator: 2, status: "value" },
      });
      expect(overview.cohorts).toEqual(expect.arrayContaining([
        expect.objectContaining({ dimension: "jenjang", label: "SMP", student_count: 2 }),
        expect.objectContaining({ dimension: "class", label: "7A", student_count: 1, attendance_rate: expect.objectContaining({ value: 100 }) }),
      ]));
    } finally {
      value.database.client.close();
    }
  });

  it("returns ordered monthly trend points and preserves missing data", () => {
    const value = context();
    try {
      const trends = analyticsTrends(value, { academic_year_id: 1 });
      const points = trends.series[0]?.points ?? [];
      expect(points.map((point) => point.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
      expect(points[0]?.metric).toMatchObject({ value: 66.7, denominator: 3 });
      expect(points[1]?.metric).toMatchObject({ value: null, status: "unavailable" });
      expect(points[0]?.start_date).toBe("2026-01-01");
      expect(points[0]?.end_date).toBe("2026-01-31");
    } finally {
      value.database.client.close();
    }
  });

  it("rejects invalid ranges and supports scoped cohorts", () => {
    const value = context();
    try {
      expect(() => analyticsOverview(value, { academic_year_id: 1, start_date: "2026-02-01", end_date: "2026-01-01" })).toThrow("The analytics date range is invalid");
      const cohorts = analyticsCohorts(value, { academic_year_id: 1, class_name: "7B" }, "class");
      expect(cohorts.cohorts).toHaveLength(1);
      expect(cohorts.cohorts[0]).toMatchObject({ label: "7B", student_count: 1, attendance_rate: { value: 0, status: "zero" } });
    } finally {
      value.database.client.close();
    }
  });
});
