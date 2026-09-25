import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "operatoros-test-cookie-secret-32-chars";
const exportPath = "/api/analytics/management-review/attendance/export.xlsx";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
    "db = sqlite3.connect(path)",
    "year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-academic'\").fetchone()[0]",
    "jenjang_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]",
    "program_id = db.execute(\"SELECT id FROM academic_programs WHERE jenjang_id = ?\", (jenjang_id,)).fetchone()[0]",
    "grade_id = db.execute(\"SELECT id FROM academic_grades WHERE program_id = ?\", (program_id,)).fetchone()[0]",
    "class_a = db.execute(\"SELECT id FROM academic_classes WHERE academic_year_id = ?\", (year_id,)).fetchone()[0]",
    "db.execute(\"UPDATE academic_classes SET class_name = '7A' WHERE id = ?\", (class_a,))",
    "class_b = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7B', '7B', 1)\", (year_id, grade_id)).lastrowid",
    "term_id = db.execute(\"INSERT INTO academic_term_configs (academic_year_id, term_number, label, start_date, end_date) VALUES (?, 1, 'Term 1', '2026-08-03', '2026-08-13')\", (year_id,)).lastrowid",
    "enrollment_id = db.execute(\"SELECT id FROM student_enrollments WHERE academic_year_id = ? AND student_master_id = '11111111-1111-1111-1111-111111111111'\", (year_id,)).fetchone()[0]",
    "db.execute(\"UPDATE student_enrollments SET student_id = 701, academic_class_id = ?, class_name = '7B' WHERE id = ?\", (class_b, enrollment_id))",
    "db.execute(\"UPDATE student_masters SET nipd = '000123' WHERE id = '11111111-1111-1111-1111-111111111111'\")",
    "late_only_id = '33333333-3333-3333-3333-333333333333'",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, nipd, student_status, created_by, updated_by) VALUES (?, 'Late-only Synthetic', 'late-only synthetic', 'E2E-LATE-ONLY', 'active', 'synthetic-test', 'synthetic-test')\", (late_only_id,))",
    "late_only_student_id = db.execute(\"INSERT INTO students (name, jenjang, class_name) VALUES ('Late-only Synthetic', 'SMP', '7B')\").lastrowid",
    "db.execute(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, '7B', 1, '2026-08-09', '2026-08-09')\", (late_only_student_id, late_only_id, year_id, jenjang_id, class_b))",
    "db.executemany(\"INSERT INTO student_enrollment_class_history (enrollment_id, class_name, effective_from, effective_to, changed_by, source) VALUES (?, ?, ?, ?, 'synthetic-test', 'synthetic-test')\", [(enrollment_id, '7A', '2026-08-03', '2026-08-05'), (enrollment_id, '7B', '2026-08-06', None)])",
    "db.execute(\"INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES ('SMP', '07:30', '2026-08-01')\")",
    "db.executemany(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation) VALUES (?, ?, ?, ?)\", [(year_id, jenjang_id, day, 'NOT_EXPECTED' if day in (0, 6) else 'EXPECTED') for day in range(7)])",
    "attendance = [(701, '2026-08-03', '07:20', 'on-time'), (701, '2026-08-04', None, 'sakit'), (701, '2026-08-05', '08:00', 'late'), (701, '2026-08-06', '07:40', 'late'), (701, '2026-08-07', None, 'sakit'), (701, '2026-08-10', None, 'late'), (701, '2026-08-11', None, 'izin'), (701, '2026-08-12', None, 'alfa')]",
    "db.executemany(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, '16:00', 0, 'synthetic-test', 0, ?)\", attendance)",
    "db.execute(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, '2026-08-09', '08:00', '16:00', 0, 'synthetic-test', 0, 'late')\", (late_only_student_id,))",
    "corrected_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 701 AND date = '2026-08-04'\").fetchone()[0]",
    "db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, note, reviewed_by, reviewed_at) VALUES (?, 'sakit', 'on-time', '07:25', 'Synthetic correction', 'golden-admin', '2026-08-04T10:00:00Z')\", (corrected_id,))",
    "checkin_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 701 AND date = '2026-08-06'\").fetchone()[0]",
    "db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, override_check_in, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'late', '07:25', 'Synthetic check-in correction', 'golden-admin', '2026-08-06T10:00:00Z')\", (checkin_id,))",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: {
    ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret,
    OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true",
  } });
  if (result.exitCode !== 0) {
    rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
    throw new Error(result.stderr.toString());
  }
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup() {
  const path = `/tmp/operatoros-management-review-attendance-${process.pid}-${Date.now()}.db`;
  const auditDir = `/tmp/operatoros-management-review-attendance-audit-${process.pid}`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const scope = database.client.query(`SELECT ay.id AS year_id, tc.id AS term_id, j.id AS jenjang_id, p.id AS program_id
    FROM academic_years ay JOIN academic_term_configs tc ON tc.academic_year_id = ay.id
    JOIN jenjangs j ON j.name = 'SMP' JOIN academic_programs p ON p.jenjang_id = j.id
    WHERE ay.label = '2026/2027-academic'`).get() as { year_id: number; term_id: number; jenjang_id: number; program_id: number };
  return {
    app, database, scope, admin: cookie(adminResponse), staff: cookie(staffResponse),
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); rmSync(auditDir, { recursive: true, force: true }); },
  };
}

describe("Management Review attendance Excel export", () => {
  it("uses canonical Term APIs, reconciles totals, and exports all six analysis sheets", async () => {
    const value = await setup();
    try {
      const { year_id, term_id, jenjang_id, program_id } = value.scope;
      const canonicalQuery = `academic_year_id=${year_id}&term_number=1&jenjang_id=${jenjang_id}&program_id=${program_id}`;
      const headers = { cookie: value.admin };
      const attendanceResponse = await value.app.handle(new Request(`http://local/api/analytics/attendance/term?${canonicalQuery}`, { headers }));
      const latenessResponse = await value.app.handle(new Request(`http://local/api/analytics/attendance/term-lateness?${canonicalQuery}`, { headers }));
      expect(attendanceResponse.status).toBe(200);
      expect(latenessResponse.status).toBe(200);
      const attendance = await attendanceResponse.json() as any;
      const lateness = await latenessResponse.json() as any;
      const query = new URLSearchParams({ academic_year_id: String(year_id), term_id: String(term_id), jenjang_id: String(jenjang_id), program_id: String(program_id) });
      const first = await value.app.handle(new Request(`http://local${exportPath}?${query}`, { headers }));
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("spreadsheetml.sheet");
      expect(first.headers.get("content-disposition")).toBe('attachment; filename="operatoros-management-review-attendance-2026-2027-academic-term-1-smp-smp-program.xlsx"');
      const workbook = await loadXlsxWorkbook(new Uint8Array(await first.arrayBuffer()));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        "Management Summary", "Attendance by Class", "Lateness by Class", "Student Attendance", "Data Quality", "Definitions",
      ]);
      const summary = workbook.getWorksheet("Management Summary")!;
      expect(summary.getCell("B3").value).toBe("2026/2027-academic");
      expect(summary.getCell("D3").value).toBe("Term 1");
      expect(summary.getCell("B4").value).toBeInstanceOf(Date);
      expect((summary.getCell("B4").value as Date).toISOString().slice(0, 10)).toBe("2026-08-03");
      expect(summary.getCell("B4").numFmt).toBe("yyyy-mm-dd");
      expect(summary.getCell("D4").value).toBeInstanceOf(Date);
      expect((summary.getCell("D4").value as Date).toISOString().slice(0, 10)).toBe("2026-08-13");
      expect(summary.getCell("D4").numFmt).toBe("yyyy-mm-dd");
      expect(summary.getCell("D5").value).toBe("SMP Program");
      expect(summary.getCell("B10").value).toBe(attendance.totals.expected_student_days);
      expect(summary.getCell("B11").value).toBe(attendance.totals.recorded_student_days);
      expect(summary.getCell("B12").value).toBe(attendance.totals.unrecorded_student_days);
      expect(summary.getCell("C13").value).toBe(attendance.totals.coverage_rate);
      expect(summary.getCell("B14").value).toBe(attendance.totals.hadir_count);
      expect(summary.getCell("C14").value).toBe(attendance.totals.hadir_rate);
      expect(summary.getCell("C15").value).toBe(attendance.totals.sakit_rate);
      expect(summary.getCell("C16").value).toBe(attendance.totals.izin_rate);
      expect(summary.getCell("C17").value).toBe(attendance.totals.alfa_rate);
      expect(summary.getCell("C18").value).toBe(attendance.totals.attendance_rate);
      expect(summary.getCell("B22").value).toBe("07:30");
      expect(summary.getCell("B23").value).toBe(lateness.totals.late_events);
      expect(summary.getCell("B24").value).toBe(lateness.totals.affected_students);
      expect(summary.getCell("B25").value).toBe(lateness.totals.total_late_minutes);
      expect(summary.getCell("B27").value).toBe(lateness.totals.average_late_minutes);
      expect(summary.getCell("B28").value).toBe(lateness.totals.late_event_rate);

      const attendanceByClass = workbook.getWorksheet("Attendance by Class")!;
      expect(attendanceByClass.getCell("B6").value).toBe("7A");
      expect(attendanceByClass.getCell("B7").value).toBe("7B");
      expect(attendanceByClass.getCell("C8").value).toBe(attendance.totals.expected_student_days);
      expect(attendanceByClass.getCell("D8").value).toBe(attendance.totals.recorded_student_days);
      expect(attendanceByClass.getCell("E8").value).toBe(attendance.totals.unrecorded_student_days);
      expect(attendanceByClass.autoFilter).toBeTruthy();
      expect(attendanceByClass.views[0]?.state).toBe("frozen");

      const latenessByClass = workbook.getWorksheet("Lateness by Class")!;
      expect(latenessByClass.getCell("C6").value).toBe("07:30");
      expect(latenessByClass.getCell("C7").value).toBe("07:30");
      expect(latenessByClass.getCell("E8").value).toBe(lateness.totals.late_events);
      expect(latenessByClass.getCell("F8").value).toBe(lateness.totals.affected_students);
      expect(latenessByClass.getCell("F8").value).not.toBe(lateness.classes.reduce((sum: number, row: any) => sum + row.totals.affected_students, 0));
      expect(latenessByClass.getCell("G8").value).toBe(lateness.totals.total_late_minutes);
      expect(latenessByClass.getCell("J6").value).toBe(lateness.classes.find((row: any) => row.class_name === "7A")?.totals.late_event_rate);

      const students = workbook.getWorksheet("Student Attendance")!;
      expect(students.getCell("A6").value).toBe("Academic Master 1111");
      expect(students.getCell("B6").value).toBe("000123");
      expect(students.getCell("B6").numFmt).toBe("@");
      expect(students.getCell("C6").value).toBe("Grade 7 7A → Grade 7 7B");
      expect(students.getCell("D6").value).toBe(attendance.students[0].totals.expected_student_days);
      expect(students.getCell("M6").value).toBe(lateness.students[0].late_events);
      expect(students.getCell("N6").value).toBe(lateness.students[0].total_late_minutes);
      expect(students.getCell("O6").value).toBe(lateness.students[0].average_late_minutes);
      expect(students.autoFilter).toBeTruthy();
      const lateOnly = students.getRows(6, students.rowCount - 5)!.find((row) => row.getCell(1).value === "Late-only Synthetic")!;
      expect(lateOnly.getCell(2).value).toBe("E2E-LATE-ONLY");
      expect(lateOnly.getCell(3).value).toBe("Grade 7 7B");
      expect(lateOnly.getCell(4).value).toBeNull();
      expect(lateOnly.getCell(13).value).toBe(1);
      expect(lateOnly.getCell(14).value).toBe(30);

      const quality = workbook.getWorksheet("Data Quality")!;
      expect(quality.getCell("B9").value).toBe(1);
      expect(quality.getCell("B15").value).toBe(lateness.quality.late_events_without_duration);
      const definitions = workbook.getWorksheet("Definitions")!;
      expect(String(definitions.getCell("B8").value)).toContain("No Scan does not automatically mean Alfa");
      expect(attendance.totals).toMatchObject({ expected_student_days: 9, recorded_student_days: 8, unrecorded_student_days: 1,
        hadir_count: 5, sakit_count: 1, izin_count: 1, alfa_count: 1 });
      expect(lateness.totals).toMatchObject({ late_events: 3, affected_students: 2, total_late_minutes: 60, average_late_minutes: 30 });
      expect(lateness.students.find((row: any) => row.student_key === "11111111-1111-1111-1111-111111111111").class_representations.map((value: any) => value.class_name)).toEqual(["7A", "7B"]);

      const repeated = await value.app.handle(new Request(`http://local${exportPath}?${query}`, { headers }));
      expect(repeated.headers.get("content-disposition")).toBe(first.headers.get("content-disposition"));
      const staffResponse = await value.app.handle(new Request(`http://local${exportPath}?${query}`, { headers: { cookie: value.staff } }));
      expect(staffResponse.status).toBe(403);
    } finally { value.cleanup(); }
  }, 30000);
});
