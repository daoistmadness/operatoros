import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { StudentOverviewResponseSchema } from "@operatoros/contracts/students";
import type { AuthContext } from "../src/auth/service";
import { attendanceStudentSummary } from "../src/domains/attendance-analytics";
import { studentIndicatorInsights } from "../src/domains/student-indicators";
import { studentOverview } from "../src/domains/student-overview";
import { studentTrendInsights } from "../src/domains/student-trends";

function fixture(): AuthContext {
  const client = new Database(":memory:");
  client.run(`
    CREATE TABLE academic_years (id INTEGER PRIMARY KEY, label TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE jenjangs (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE academic_programs (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE academic_grades (id INTEGER PRIMARY KEY, jenjang_id INTEGER, program_id INTEGER, name TEXT);
    CREATE TABLE academic_classes (id INTEGER PRIMARY KEY, academic_year_id INTEGER, grade_id INTEGER, class_name TEXT);
    CREATE TABLE student_masters (id TEXT PRIMARY KEY, full_name TEXT, preferred_name TEXT, nipd TEXT, nisn TEXT, nik TEXT, birth_place TEXT, birth_date TEXT, gender TEXT, religion TEXT, citizenship TEXT, blood_type TEXT, student_status TEXT, admission_date TEXT, admission_type TEXT, previous_school TEXT, updated_at TEXT);
    CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, class_name TEXT, jenjang TEXT);
    CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, student_master_id TEXT, academic_year_id INTEGER, jenjang_id INTEGER, academic_class_id INTEGER, class_name TEXT, effective_from TEXT, effective_to TEXT, lifecycle_state TEXT, class_assigned INTEGER);
    CREATE TABLE student_addresses (student_master_id TEXT, address TEXT, kelurahan TEXT, kecamatan TEXT, city_regency TEXT, province TEXT, postal_code TEXT);
    CREATE TABLE student_contacts (student_master_id TEXT, student_phone TEXT, student_email TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT);
    CREATE TABLE student_parent_guardians (id INTEGER, student_master_id TEXT, guardian_type TEXT, name TEXT, phone TEXT, email TEXT, occupation TEXT, education TEXT, address TEXT);
    CREATE TABLE student_health_profiles (student_master_id TEXT, allergy TEXT, medical_condition TEXT, special_needs TEXT);
    CREATE TABLE student_document_statuses (student_master_id TEXT, family_card_received INTEGER, birth_certificate_received INTEGER, parent_id_received INTEGER, school_agreement_received INTEGER, publication_consent_received INTEGER);
    CREATE TABLE student_device_identities (id INTEGER PRIMARY KEY, student_master_id TEXT, legacy_student_id INTEGER, device_identifier TEXT, device_source TEXT, effective_from TEXT, effective_to TEXT, is_active INTEGER);
    CREATE TABLE attendance (id INTEGER PRIMARY KEY, student_id INTEGER, date TEXT, check_in TEXT, check_out TEXT, late_duration INTEGER, status TEXT);
    CREATE TABLE attendance_overrides (id INTEGER PRIMARY KEY, attendance_id INTEGER, original_status TEXT, override_status TEXT, override_check_in TEXT, override_check_out TEXT, note TEXT, reviewed_by TEXT);
    CREATE TABLE academic_term_configs (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, label TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT, jenjang_id INTEGER);
    CREATE TABLE assessment_components (id INTEGER PRIMARY KEY, name TEXT, assessment_type TEXT, subject_id INTEGER);
    CREATE TABLE student_subject_grades (id INTEGER PRIMARY KEY, enrollment_id INTEGER, subject_id INTEGER, component_id INTEGER, score REAL);
    CREATE TABLE kkm_thresholds (id INTEGER PRIMARY KEY, academic_year_id INTEGER, jenjang_id INTEGER, subject_id INTEGER, assessment_type TEXT, threshold REAL);
  `);
  client.run("INSERT INTO academic_years VALUES (1, '2026/2027', '2026-01-01', '2026-03-31')");
  client.run("INSERT INTO jenjangs VALUES (1, 'SMP'); INSERT INTO academic_programs VALUES (1, 'Regular'); INSERT INTO academic_grades VALUES (1, 1, 1, '7'); INSERT INTO academic_classes VALUES (1, 1, 1, '7A')");
  client.run("INSERT INTO student_masters VALUES ('student-a', 'Alya', NULL, NULL, NULL, NULL, NULL, '2013-01-01', 'F', NULL, NULL, NULL, 'active', NULL, NULL, NULL, '2026-01-01'), ('student-b', 'Alya', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'active', NULL, NULL, NULL, '2026-01-01')");
  client.run("INSERT INTO students VALUES (1, 'Alya device', '7A', 'SMP'), (2, 'Other Alya device', '7A', 'SMP')");
  client.run("INSERT INTO student_enrollments VALUES (1, 1, 'student-a', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE', 1), (2, 2, 'student-b', 1, 1, 1, '7A', '2026-01-01', NULL, 'ACTIVE', 1)");
  client.run("INSERT INTO student_device_identities VALUES (1, 'student-a', 1, 'device-a', 'test', '2026-01-01', NULL, 1), (2, 'student-b', 2, 'device-b', 'test', '2026-01-01', NULL, 1)");
  client.run("INSERT INTO attendance VALUES (1, 1, '2026-01-30', '07:00', '14:00', 10, 'late'), (2, 1, '2026-03-10', '07:00', '14:00', 0, 'on-time'), (3, 1, '2026-03-11', NULL, NULL, 0, 'alfa'), (4, 2, '2026-03-12', '07:00', '14:00', 0, 'on-time')");
  client.run("INSERT INTO attendance_overrides VALUES (1, 1, 'late', 'on-time', NULL, NULL, NULL, 'reviewer')");
  client.run("INSERT INTO academic_term_configs VALUES (1, 1, 1, 'Term 1', '2026-01-01', '2026-02-15'), (2, 1, 2, 'Term 2', '2026-02-16', '2026-03-31')");
  client.run("INSERT INTO subjects VALUES (1, 'Mathematics', 1); INSERT INTO assessment_components VALUES (1, 'Quiz', 'formatif', 1), (2, 'Exam', 'sumatif', 1); INSERT INTO student_subject_grades VALUES (1, 1, 1, 1, 80), (2, 1, 1, 2, 70)");
  return { database: { client } } as AuthContext;
}

describe("student 360 overview", () => {
  it("composes exact canonical student measurements without writes or classification semantics", () => {
    const context = fixture();
    const originalClient = context.database.client;
    try {
      const before = Number((context.database.client.query("SELECT COUNT(*) count FROM attendance").get() as { count: number }).count);
      const overview = studentOverview(context, "student-a", "admin", "2026-03-31")!;
      const query = { academic_year_id: "1", class_id: "1", student_id: "student-a", page_size: "1" };
      const attendance = attendanceStudentSummary(context, { academic_year_id: "1", class_id: "1", date_from: "2026-01-01", date_to: "2026-03-31" }, 1)!;
      const indicators = studentIndicatorInsights(context, query).rows[0]!;
      const trends = studentTrendInsights(context, query).rows[0]!;

      expect(overview.student.fullName).toBe("Alya");
      expect(Value.Check(StudentOverviewResponseSchema, overview)).toBe(true);
      expect(overview.enrollment).toMatchObject({ academicYear: "2026/2027", jenjang: "SMP", className: "7A" });
      expect(overview.attendance).toMatchObject({ counts: attendance.counts, attendanceRate: attendance.attendanceRate, tardinessRate: attendance.tardinessRate, alfaRate: attendance.unexcusedAbsenceRate });
      expect(overview.attendance.recent[2]).toMatchObject({ date: "2026-01-30", status: "on-time", corrected: true });
      expect(overview.academic).toMatchObject({ average: indicators.academicAverage.current, participation: indicators.academicParticipation.current, temporalTrend: "unavailable_no_time_axis" });
      expect(overview.trends).toMatchObject({ attendance: trends.attendance, tardiness: trends.tardiness, alfa: trends.alfa });
      expect(overview.dataCompleteness.issues.map((issue) => issue.field)).toEqual(["religion"]);
      expect(Number((context.database.client.query("SELECT COUNT(*) count FROM attendance").get() as { count: number }).count)).toBe(before);
      expect(JSON.stringify(overview)).not.toMatch(/riskScore|at_risk|threshold|alert|intervention|prediction/i);
    } finally { originalClient.close(); }
  });

  it("omits attendance for roles without attendance access and preserves no-grade nulls", () => {
    const context = fixture();
    try {
      const hidden = studentOverview(context, "student-a", "unknown", "2026-03-31")!;
      const noGrades = studentOverview(context, "student-b", "staff", "2026-03-31")!;
      expect(hidden.attendance).toMatchObject({ status: "unauthorized", counts: null, recent: [] });
      expect(hidden.trends).toMatchObject({ status: "unauthorized", window: null, attendance: null });
      expect(hidden.links.attendanceDetails).toBeNull();
      expect(hidden.links.attendanceAnalytics).toBeNull();
      expect(hidden.links.trends).toBeNull();
      expect(noGrades.academic).toMatchObject({ status: "available", average: null, participation: 0, scoredResults: 0, expectedResults: 2 });
      expect(studentOverview(context, "missing", "admin")).toBeNull();
    } finally { context.database.client.close(); }
  });

  it("keeps the composed profile query bounded for a typical student", () => {
    const context = fixture();
    const originalClient = context.database.client;
    try {
      let queryCount = 0;
      const client = context.database.client;
      (context as any).database.client = new Proxy(client, { get(target, property) {
        if (property === "query") return (...args: any[]) => { queryCount++; return (target.query as any)(...args); };
        return Reflect.get(target, property);
      } }) as typeof client;
      const started = performance.now();
      studentOverview(context, "student-a", "admin", "2026-03-31");
      const elapsedMs = performance.now() - started;
      expect(queryCount).toBeLessThan(40);
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
    } finally { originalClient.close(); }
  });
});
