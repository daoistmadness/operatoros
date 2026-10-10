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
    CREATE TABLE academic_programs (id INTEGER PRIMARY KEY, jenjang_id INTEGER, name TEXT);
    CREATE TABLE academic_grades (id INTEGER PRIMARY KEY, jenjang_id INTEGER, program_id INTEGER, name TEXT);
    CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, grade_id INTEGER, class_name TEXT);
    CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT);
    CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, jenjang TEXT, class_name TEXT);
    CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT, lifecycle_state TEXT);
    CREATE TABLE student_enrollment_class_history (id INTEGER PRIMARY KEY, enrollment_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, check_in TEXT, check_out TEXT, status TEXT);
    CREATE TABLE attendance_overrides (id INTEGER PRIMARY KEY, attendance_id INTEGER, original_status TEXT, override_status TEXT, override_check_in TEXT);
    CREATE TABLE attendance_calendar_weekday_rules (academic_year_id INTEGER, jenjang_id INTEGER, weekday INTEGER, expectation TEXT);
    CREATE TABLE attendance_calendar_exceptions (academic_year_id INTEGER, jenjang_id INTEGER, date TEXT, expectation TEXT, reason TEXT);
    CREATE TABLE jenjang_config (id INTEGER PRIMARY KEY, jenjang TEXT, cutoff_time TEXT, updated_at TEXT);
    CREATE TABLE jenjang_lateness_policy (jenjang_id INTEGER, effective_from TEXT, cutoff_time TEXT, source TEXT);
    CREATE TABLE academic_term_configs (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, label TEXT, start_date TEXT, end_date TEXT);
  `);
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-01-01', '2026-03-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP')");
  client.run("INSERT INTO academic_programs VALUES (1, 1, 'Regular'); INSERT INTO academic_grades VALUES (1, 1, 1, '7')");
  client.run("INSERT INTO academic_classes VALUES (1, 1, 1, '7A')");
  client.run("INSERT INTO student_masters VALUES ('student-a', 'Alya'), ('student-b', 'Bima')");
  client.run("INSERT INTO students VALUES (1, 'Alya legacy', 'SMP', '7A'), (2, 'Bima legacy', 'SMP', '7A')");
  client.run("INSERT INTO student_enrollments VALUES (1, 1, 'student-a', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE'), (2, 2, 'student-b', 1, 1, 1, '7A', '2026-02-01', NULL, 'ACTIVE')");
  for (let weekday = 0; weekday < 7; weekday++) client.run("INSERT INTO attendance_calendar_weekday_rules VALUES (1, 1, ?, ?)", [weekday, weekday === 0 || weekday === 6 ? "NOT_EXPECTED" : "EXPECTED"]);
  client.run("INSERT INTO jenjang_config VALUES (1, 'SMP', '08:00', '2026-01-01')");
  client.run("INSERT INTO jenjang_lateness_policy VALUES (1, '2026-01-01', '08:00', 'RECORDED')");
  const weekdays = (start: string, end: string) => {
    const result: string[] = [];
    for (const date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1))
      if (date.getUTCDay() > 0 && date.getUTCDay() < 6) result.push(date.toISOString().slice(0, 10));
    return result;
  };
  let attendanceId = 0;
  const record = (date: string, status: string) => {
    attendanceId++;
    const checkIn = status === "late" ? "08:10" : status === "on-time" ? "07:50" : null;
    client.run("INSERT INTO attendance VALUES (?, ?, ?, ?, '14:00', ?)", [attendanceId, 1, date, checkIn, status]);
    return attendanceId;
  };
  const previousStatuses = [...Array(14).fill("on-time"), ...Array(2).fill("late"), "sakit", "izin", ...Array(2).fill("alfa")];
  weekdays("2026-01-19", "2026-02-15").forEach((date, index) => record(date, previousStatuses[index]!));
  const currentStatuses = [...Array(14).fill("on-time"), ...Array(4).fill("late")];
  const currentDates = weekdays("2026-02-16", "2026-03-15");
  currentStatuses.forEach((status, index) => {
    const id = record(currentDates[index]!, status);
    if (index === 14) client.run("INSERT INTO attendance_overrides VALUES (1, ?, 'late', 'on-time', NULL)", [id]);
  });
  client.run("INSERT INTO attendance VALUES (?, 2, '2026-03-15', '07:50', '14:00', 'on-time')", [++attendanceId]);
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
      expect(alya.attendance).toMatchObject({ current: 90, previous: 80, delta: 10, direction: "up", currentSampleSize: 20, previousSampleSize: 20 });
      expect(alya.tardiness).toMatchObject({ current: 15, previous: 10, delta: 5, direction: "up", currentSampleSize: 20, previousSampleSize: 20 });
      expect(alya.alfa).toMatchObject({ current: 0, previous: 10, delta: -10, direction: "down" });
      expect(alya.academic).toMatchObject({ current: null, previous: null, delta: null, direction: "insufficient_data" });
    } finally { value.database.client.close(); }
  });

  it("does not turn missing previous data into zero and supports term boundaries", () => {
    const value = context();
    try {
      const response = studentTrendInsights(value, { academic_year_id: "1", window: "term", search: "Bima", page: "1", page_size: "1" });
      expect(response.window).toMatchObject({ kind: "term", currentStart: "2026-02-16", currentEnd: "2026-03-15", previousStart: "2026-01-01", previousEnd: "2026-01-28" });
      expect(response.totalStudents).toBe(1);
      expect(response.rows[0]?.attendance).toMatchObject({ current: 0, previous: null, currentSampleSize: 20, currentRecordedStudentDays: 0, delta: null, direction: "insufficient_data" });
      value.database.client.run("INSERT INTO attendance VALUES (999, 2, '2026-03-13', NULL, NULL, 'sakit')");
      const observedZero = studentTrendInsights(value, { academic_year_id: "1", window: "term", search: "Bima", page: "1", page_size: "1" });
      expect(observedZero.rows[0]?.attendance).toMatchObject({ current: 0, currentSampleSize: 20, currentRecordedStudentDays: 1 });
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

  it("returns unavailable rates when no expected Student-Days exist", () => {
    const value = context();
    try {
      value.database.client.run("UPDATE attendance_calendar_weekday_rules SET expectation = 'NOT_EXPECTED'");
      const response = studentTrendInsights(value, { academic_year_id: "1" });
      const alya = response.rows.find((student) => student.studentId === "student-a")!;
      expect(alya.attendance).toMatchObject({ current: null, previous: null, delta: null, direction: "insufficient_data" });
      expect(alya.tardiness).toMatchObject({ current: null, previous: null, delta: null, direction: "insufficient_data" });
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
