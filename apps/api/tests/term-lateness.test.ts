import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Value } from "@sinclair/typebox/value";
import { TermLatenessResponseSchema } from "@operatoros/contracts/analytics";
import { classifyLateness, termLateness } from "../src/domains/term-lateness";

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
  client.run("CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, jenjang TEXT, class_name TEXT)");
  client.run("CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, check_in TEXT, check_out TEXT, status TEXT)");
  client.run("CREATE TABLE attendance_overrides (id INTEGER PRIMARY KEY, attendance_id INTEGER, original_status TEXT, override_status TEXT, override_check_in TEXT, override_check_out TEXT, note TEXT, reviewed_by TEXT, reviewed_at TEXT)");
  client.run("CREATE TABLE attendance_calendar_weekday_rules (academic_year_id INTEGER, jenjang_id INTEGER, weekday INTEGER, expectation TEXT)");
  client.run("CREATE TABLE attendance_calendar_exceptions (academic_year_id INTEGER, jenjang_id INTEGER, date TEXT, expectation TEXT, reason TEXT)");
  client.run("CREATE TABLE jenjang_config (id INTEGER PRIMARY KEY, jenjang TEXT, cutoff_time TEXT, updated_at TEXT)");
  client.run("INSERT INTO academic_years VALUES (1,'2026/2027','2026-07-01','2027-06-30')");
  client.run("INSERT INTO academic_term_configs VALUES (11,1,1,'Configured Term 1','2026-08-03','2026-08-09')");
  client.run("INSERT INTO jenjangs VALUES (1,'Primary')");
  client.run("INSERT INTO academic_programs VALUES (1,1,'Primary')");
  client.run("INSERT INTO academic_grades VALUES (1,1,1,'P1')");
  client.run("INSERT INTO academic_classes VALUES (10,1,1,'P1A'),(11,1,1,'P1B')");
  client.run("INSERT INTO student_enrollments VALUES (1,101,'synthetic-1',1,1,10,'P1A','2026-08-03',NULL)");
  client.run("INSERT INTO students VALUES (101,'Synthetic One','Primary','P1A')");
  client.run("INSERT INTO jenjang_config VALUES (1,'Primary','07:30','2026-08-01')");
  for (let weekday = 0; weekday < 7; weekday++) client.run("INSERT INTO attendance_calendar_weekday_rules VALUES (1,1,?,?)", [weekday, weekday === 0 || weekday === 6 ? "NOT_EXPECTED" : "EXPECTED"]);
  const context = { database: { client } } as any;
  const get = () => termLateness(context, { academic_year_id: "1", term_number: "1" });
  let id = 0;
  const attendance = (date: string, status: string, checkIn: string | null = null) => {
    id++;
    client.run("INSERT INTO attendance VALUES (?,?,?,?,?,?)", [id, 101, date, checkIn, "16:00", status]);
    return id;
  };
  const override = (attendanceId: string | number, status: string, checkIn: string | null = null) => {
    client.run("INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, override_check_out, note, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?,?,?)",
      [attendanceId, "late", status, checkIn, null, "test correction", "tester", "2026-08-06T10:00:00Z"]);
  };
  return { client, get, attendance, override, close: () => client.close() };
}

describe("canonical lateness classifier", () => {
  it("treats the configured cutoff as the exact boundary with no grace", () => {
    expect(classifyLateness({ checkIn: "07:29", useTimeAuthority: true, status: "on-time", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: "07:30", useTimeAuthority: true, status: "on-time", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: "07:31", useTimeAuthority: true, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: 1 });
    expect(classifyLateness({ checkIn: "07:45", useTimeAuthority: true, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: 15 });
    expect(classifyLateness({ checkIn: "08:30", useTimeAuthority: true, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: 60 });
  });

  it("never turns a missing scan or an explicit non-hadir status into late", () => {
    expect(classifyLateness({ checkIn: null, useTimeAuthority: true, status: "unrecorded", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: null, useTimeAuthority: true, status: "sakit", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: null, useTimeAuthority: true, status: "izin", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: null, useTimeAuthority: true, status: "alfa", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
  });

  it("exposes unavailable duration for explicit late without a usable time", () => {
    expect(classifyLateness({ checkIn: null, useTimeAuthority: true, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: null });
    expect(classifyLateness({ checkIn: null, useTimeAuthority: false, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: null });
  });

  it("lets a status-only override remove or keep the event without fabricating minutes", () => {
    expect(classifyLateness({ checkIn: "07:45", useTimeAuthority: false, status: "on-time", cutoff: "07:30" })).toEqual({ is_late: false, late_minutes: 0 });
    expect(classifyLateness({ checkIn: "07:45", useTimeAuthority: false, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: 15 });
    expect(classifyLateness({ checkIn: "07:20", useTimeAuthority: false, status: "late", cutoff: "07:30" })).toEqual({ is_late: true, late_minutes: null });
  });
});

describe("canonical term lateness aggregate", () => {
  it("classifies 07:29/07:30 on-time and 07:31+ late with exact minutes", () => {
    const value = fixture();
    try {
      value.attendance("2026-08-03", "on-time", "07:29");
      value.attendance("2026-08-04", "on-time", "07:30");
      value.attendance("2026-08-05", "late", "07:31");
      value.attendance("2026-08-06", "late", "07:45");
      value.attendance("2026-08-07", "late", "08:30");
      const result = value.get();
      expect(result.period).toMatchObject({ term_id: 11, start_date: "2026-08-03", end_date: "2026-08-09", source: "custom" });
      expect(result.cutoffs).toEqual([{ jenjang_id: 1, jenjang: "Primary", cutoff_time: "07:30" }]);
      expect(result.totals).toMatchObject({ expected_student_days: 5, late_events: 3, affected_students: 1,
        total_late_minutes: 76, average_late_minutes: 76 / 3, late_event_rate: 60 });
      expect(result.quality.report_data_ready).toBe(true);
      expect(Value.Check(TermLatenessResponseSchema, result)).toBe(true);
    } finally { value.close(); }
  });

  it("never counts missing scans or Sakit/Izin/Alfa as late", () => {
    const value = fixture();
    try {
      value.attendance("2026-08-05", "sakit");
      value.attendance("2026-08-06", "izin");
      value.attendance("2026-08-07", "alfa");
      const result = value.get();
      expect(result.totals).toMatchObject({ expected_student_days: 5, late_events: 0, affected_students: 0,
        total_late_minutes: 0, average_late_minutes: null, late_event_rate: 0 });
    } finally { value.close(); }
  });

  it("recomputes lateness from the corrected check-in", () => {
    const value = fixture();
    try {
      const late = value.attendance("2026-08-04", "late", "07:45");
      const early = value.attendance("2026-08-05", "on-time", "07:25");
      value.override(late, "on-time", "07:25");
      value.override(early, "late", "07:40");
      const result = value.get();
      expect(result.totals).toMatchObject({ late_events: 1, affected_students: 1, total_late_minutes: 10, average_late_minutes: 10 });
    } finally { value.close(); }
  });

  it("attributes each event to its historical class and normalizes rates by expected days", () => {
    const value = fixture();
    try {
      value.client.run("UPDATE student_enrollments SET academic_class_id = 11, class_name = 'P1B' WHERE id = 1");
      value.client.run("INSERT INTO student_enrollment_class_history VALUES (1,1,'P1A','2026-08-03','2026-08-06'),(2,1,'P1B','2026-08-06',NULL)");
      value.client.run("INSERT INTO student_enrollments VALUES (2,102,'synthetic-2',1,1,11,'P1B','2026-08-03','2026-08-07')");
      value.client.run("INSERT INTO students VALUES (102,'Synthetic Two','Primary','P1B')");
      value.attendance("2026-08-04", "late", "07:45");
      value.client.run("INSERT INTO attendance VALUES (100,102,'2026-08-07','07:50','16:00','late')");
      const result = value.get();
      const p1a = result.classes.find((row) => row.class_id === 10);
      const p1b = result.classes.find((row) => row.class_id === 11);
      expect(p1a?.totals).toMatchObject({ late_events: 1, total_late_minutes: 15 });
      expect(p1b?.totals).toMatchObject({ late_events: 1, total_late_minutes: 20 });
      // Same raw late events, different expected student-days: normalized rates differ.
      expect(p1a?.totals.expected_student_days).toBe(3);
      expect(p1b?.totals.expected_student_days).toBe(7);
      expect(p1a?.totals.late_event_rate).not.toBe(p1b?.totals.late_event_rate);
    } finally { value.close(); }
  });

  it("counts a recorded late arrival as an event even on a non-expected day", () => {
    const value = fixture();
    try {
      value.client.run("INSERT INTO attendance_calendar_exceptions VALUES (1,1,'2026-08-05','NOT_EXPECTED','SCHOOL_CLOSED')");
      value.attendance("2026-08-05", "late", "07:45");
      const result = value.get();
      expect(result.totals).toMatchObject({ expected_student_days: 4, late_events: 1, total_late_minutes: 15 });
    } finally { value.close(); }
  });

  it("reconciles class and student totals with the overall totals", () => {
    const value = fixture();
    try {
      value.attendance("2026-08-03", "late", "07:31");
      value.attendance("2026-08-05", "late", "07:45");
      const result = value.get();
      for (const field of ["expected_student_days", "late_events", "affected_students", "total_late_minutes"] as const) {
        const _field = field;
        if (_field === "affected_students") continue;
        expect(result.classes.reduce((sum, row) => sum + (row.totals[_field] as number), 0)).toBe(result.totals[_field] as number);
      }
      expect(result.students.reduce((sum, row) => sum + row.late_events, 0)).toBe(result.totals.late_events);
      expect(result.students.reduce((sum, row) => sum + row.total_late_minutes, 0)).toBe(result.totals.total_late_minutes);
      expect(new Set(result.students.map((row) => row.student_key)).size).toBe(result.totals.affected_students);
    } finally { value.close(); }
  });

  it("follows the configured cutoff instead of a hardcoded 07:30", () => {
    const value = fixture();
    try {
      value.client.run("UPDATE jenjang_config SET cutoff_time = '07:45' WHERE jenjang = 'Primary'");
      value.attendance("2026-08-04", "on-time", "07:40");
      value.attendance("2026-08-05", "late", "07:46");
      const result = value.get();
      expect(result.cutoffs).toEqual([{ jenjang_id: 1, jenjang: "Primary", cutoff_time: "07:45" }]);
      expect(result.totals).toMatchObject({ late_events: 1, total_late_minutes: 1 });
    } finally { value.close(); }
  });
});
