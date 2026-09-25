import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Value } from "@sinclair/typebox/value";
import { TermAttendanceResponseSchema } from "@operatoros/contracts/analytics";
import { termAttendance } from "../src/domains/term-attendance";

function fixture() {
  const client = new Database(":memory:");
  client.run("CREATE TABLE academic_years (id INTEGER PRIMARY KEY, label TEXT, start_date TEXT, end_date TEXT)");
  client.run("CREATE TABLE academic_term_configs (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, label TEXT, start_date TEXT, end_date TEXT)");
  client.run("CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT)");
  client.run("CREATE TABLE academic_programs (id INTEGER PRIMARY KEY, jenjang_id INTEGER, name TEXT)");
  client.run("CREATE TABLE academic_grades (id INTEGER PRIMARY KEY, jenjang_id INTEGER, program_id INTEGER, name TEXT)");
  client.run("CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, grade_id INTEGER, class_name TEXT)");
  client.run("CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT)");
  client.run("CREATE TABLE student_enrollment_class_history (id INTEGER PRIMARY KEY, enrollment_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT)");
  client.run("CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, status TEXT)");
  client.run("CREATE TABLE attendance_overrides (attendance_id INTEGER, override_status TEXT)");
  client.run("CREATE TABLE attendance_calendar_weekday_rules (academic_year_id INTEGER, jenjang_id INTEGER, weekday INTEGER, expectation TEXT)");
  client.run("CREATE TABLE attendance_calendar_exceptions (academic_year_id INTEGER, jenjang_id INTEGER, date TEXT, expectation TEXT, reason TEXT)");
  client.run("INSERT INTO academic_years VALUES (1,'2026/2027','2026-07-01','2027-06-30'),(2,'2025/2026','2025-07-01','2026-06-30')");
  client.run("INSERT INTO academic_term_configs VALUES (11,1,1,'Configured Term 1','2026-08-03','2026-08-09')");
  client.run("INSERT INTO jenjangs VALUES (1,'Primary')");
  client.run("INSERT INTO academic_programs VALUES (1,1,'Primary')");
  client.run("INSERT INTO academic_grades VALUES (1,1,1,'P1')");
  client.run("INSERT INTO academic_classes VALUES (10,1,1,'P1A'),(11,1,1,'P1B'),(12,2,1,'P1A')");
  client.run("INSERT INTO student_enrollments VALUES (1,101,'synthetic-1',1,1,10,'P1A','2026-08-03',NULL)");
  for (let weekday = 0; weekday < 7; weekday++) client.run("INSERT INTO attendance_calendar_weekday_rules VALUES (1,1,?,?)", [weekday, weekday === 0 || weekday === 6 ? "NOT_EXPECTED" : "EXPECTED"]);
  const context = { database: { client } } as any;
  const get = () => termAttendance(context, { academic_year_id: "1", term_number: "1" });
  const attendance = (date: string, status: string, id: number) => client.run("INSERT INTO attendance VALUES (?,?,?,?)", [id, 101, date, status]);
  return { client, get, attendance, close: () => client.close() };
}

describe("canonical term attendance", () => {
  it("uses configured dates, calendar, and expected-day rates without inventing Hadir or Alfa", () => {
    const value = fixture();
    try {
      value.attendance("2026-08-03", "on-time", 1);
      value.attendance("2026-08-04", "late", 2);
      value.attendance("2026-08-05", "sakit", 3);
      value.attendance("2026-08-06", "izin", 4);
      const writesBefore = (value.client.query("SELECT total_changes() AS count").get() as { count: number }).count;
      const result = value.get();
      expect((value.client.query("SELECT total_changes() AS count").get() as { count: number }).count).toBe(writesBefore);
      expect(result.period).toMatchObject({ term_id: 11, start_date: "2026-08-03", end_date: "2026-08-09", source: "custom" });
      expect(result.totals).toMatchObject({ expected_student_days: 5, recorded_student_days: 4, unrecorded_student_days: 1,
        hadir_count: 2, sakit_count: 1, izin_count: 1, alfa_count: 0, late_count: 1, coverage_rate: 80,
        hadir_rate: 40, sakit_rate: 20, izin_rate: 20, alfa_rate: 0, attendance_rate: 40 });
      expect(result.students[0]?.class_representations).toEqual([{ class_id: 10, class_name: "P1A" }]);
      expect(result.classes[0]?.totals).toEqual(result.totals);
      expect(result.students[0]?.totals).toEqual(result.totals);
      expect(result.quality.report_data_ready).toBe(true);
      expect(Value.Check(TermAttendanceResponseSchema, result)).toBe(true);
    } finally { value.close(); }
  });

  it("preserves explicit no-scan statuses and uses an override exactly once", () => {
    const value = fixture();
    try {
      value.attendance("2026-08-03", "sakit", 1);
      value.attendance("2026-08-04", "izin", 2);
      value.attendance("2026-08-05", "alfa", 3);
      value.attendance("2026-08-06", "late", 4);
      value.attendance("2026-08-07", "alfa", 5);
      value.client.run("INSERT INTO attendance_overrides VALUES (5,'on-time')");
      expect(value.get().totals).toMatchObject({ expected_student_days: 5, recorded_student_days: 5, unrecorded_student_days: 0,
        hadir_count: 2, sakit_count: 1, izin_count: 1, alfa_count: 1, late_count: 1, coverage_rate: 100, attendance_rate: 40 });
    } finally { value.close(); }
  });

  it("shows unknown calendar dates and excludes NOT_EXPECTED dates", () => {
    const value = fixture();
    try {
      value.client.run("DELETE FROM attendance_calendar_weekday_rules WHERE weekday = 3");
      value.client.run("INSERT INTO attendance_calendar_exceptions VALUES (1,1,'2026-08-06','NOT_EXPECTED','SCHOOL_CLOSED')");
      const result = value.get();
      expect(result.totals.expected_student_days).toBe(3);
      expect(result.quality).toMatchObject({ unknown_calendar_dates: ["2026-08-05"], unknown_calendar_student_days: 1, report_data_ready: false });
    } finally { value.close(); }
  });

  it("respects enrollment windows and historical class transfers, then reconciles every level", () => {
    const value = fixture();
    try {
      value.client.run("UPDATE student_enrollments SET academic_class_id = 11, class_name = 'P1B' WHERE id = 1");
      value.client.run("INSERT INTO student_enrollment_class_history VALUES (1,1,'P1A','2026-08-03','2026-08-06'),(2,1,'P1B','2026-08-06',NULL)");
      value.client.run("INSERT INTO student_enrollments VALUES (2,102,'synthetic-2',1,1,10,'P1A','2026-08-05','2026-08-06')");
      value.client.run("UPDATE student_enrollments SET effective_to = '2026-08-07' WHERE id = 1");
      value.attendance("2026-08-04", "on-time", 1);
      value.attendance("2026-08-07", "late", 2);
      value.client.run("INSERT INTO attendance VALUES (3,102,'2026-08-06','alfa')");
      const result = value.get();
      expect(result.totals).toMatchObject({ expected_student_days: 7, recorded_student_days: 3, unrecorded_student_days: 4, hadir_count: 2, alfa_count: 1, late_count: 1 });
      expect(result.classes.find((row) => row.class_id === 10)?.totals).toMatchObject({ expected_student_days: 5, recorded_student_days: 2, hadir_count: 1, alfa_count: 1 });
      expect(result.classes.find((row) => row.class_id === 11)?.totals).toMatchObject({ expected_student_days: 2, recorded_student_days: 1, hadir_count: 1, late_count: 1 });
      expect(result.students.find((row) => row.student_key === "synthetic-1")?.class_representations).toEqual([
        { class_id: 10, class_name: "P1A" }, { class_id: 11, class_name: "P1B" },
      ]);
      for (const field of ["expected_student_days", "recorded_student_days", "unrecorded_student_days", "hadir_count", "alfa_count"] as const) {
        expect(result.classes.reduce((sum, row) => sum + row.totals[field], 0)).toBe(result.totals[field]);
        expect(result.students.reduce((sum, row) => sum + row.totals[field], 0)).toBe(result.totals[field]);
      }
      expect(termAttendance({ database: { client: value.client } } as any, { academic_year_id: "1", term_number: "1", class_id: "10" }).totals.expected_student_days).toBe(5);
    } finally { value.close(); }
  });

  it("fails closed when a historical class name is ambiguous", () => {
    const value = fixture();
    try {
      value.client.run("INSERT INTO academic_grades VALUES (2,1,1,'P2')");
      value.client.run("INSERT INTO academic_classes VALUES (13,1,2,'P1A')");
      value.client.run("INSERT INTO student_enrollment_class_history VALUES (1,1,'P1A','2026-08-03',NULL)");
      const result = value.get();
      expect(result.quality).toMatchObject({ unresolved_class_student_days: 5, report_data_ready: false });
      expect(result.classes[0]?.class_id).toBeNull();
    } finally { value.close(); }
  });

  it("accumulates across months with a configured term instead of keeping the last month", () => {
    const value = fixture();
    try {
      value.client.run("UPDATE academic_term_configs SET end_date = '2026-09-04' WHERE id = 11");
      value.attendance("2026-08-03", "on-time", 1);
      value.attendance("2026-09-03", "sakit", 2);
      const result = value.get();
      expect(result.period.end_date).toBe("2026-09-04");
      expect(result.totals).toMatchObject({ expected_student_days: 25, recorded_student_days: 2, unrecorded_student_days: 23,
        hadir_count: 1, sakit_count: 1, attendance_rate: 4, coverage_rate: 8 });
      expect(result.classes[0]?.totals).toEqual(result.totals);
      expect(result.students[0]?.totals).toEqual(result.totals);
    } finally { value.close(); }
  });
});
