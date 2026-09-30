import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { AttendanceBasisResponseSchema } from "@operatoros/contracts/analytics";
import { MonthlyReportResponseSchema, ReportFiltersResponseSchema } from "@operatoros/contracts/reports";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { calculateHeb, lateAmongPresentRate, roundHalfEven, roundHalfUp } from "../src/domains/reports";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "from core import database as core_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); core_database.run_grade_ledger_patches(core_database.engine); core_database._seed_grade_ledger_minimum(core_database.engine)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_reports(path)",
    "db = sqlite3.connect(path); year_id = db.execute(\"SELECT id FROM academic_years WHERE label = '2026/2027-reports'\").fetchone()[0]; smp_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SMP'\").fetchone()[0]; sd_id = db.execute(\"SELECT id FROM jenjangs WHERE name = 'SD'\").fetchone()[0]",
    "db.executemany(\"INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)\", [('SMP', '07:30'), ('SD', '07:25')])",
    "db.executemany(\"INSERT INTO jenjang_lateness_policy (jenjang_id,effective_from,cutoff_time,source,created_by,created_at,reason) VALUES (?, '2026-08-01', ?, 'BACKFILL_ASSUMED', 'TEST_SEED', CURRENT_TIMESTAMP, 'Synthetic test cutoff backfill')\", [(smp_id, '07:30'), (sd_id, '07:25')])",
    "db.executemany(\"INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation) VALUES (?, ?, ?, ?)\", [(year_id, j, w, 'EXPECTED' if 1 <= w <= 5 else 'NOT_EXPECTED') for j in (smp_id, sd_id) for w in range(7)])",
    "master = str(uuid.uuid4()); db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", (master, 'Hana SMP7C', 'hana smp7c')); db.execute(\"INSERT INTO students (name, jenjang, class_name) VALUES ('Hana SMP7C', 'SMP', '7C')\"); hana_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, class_name, class_assigned, lifecycle_state) VALUES (?, ?, ?, ?, '7C', 1, 'ACTIVE')\", (hana_id, master, year_id, smp_id))",
    "db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Matematika', ?, 1, 1)\", (smp_id,)); subject_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('UH1', 'sumatif', ?), ('UH2', 'sumatif', ?)\", (subject_id, subject_id)); components = [row[0] for row in db.execute(\"SELECT id FROM assessment_components WHERE subject_id = ? ORDER BY id\", (subject_id,)).fetchall()]; enrollments = [row for row in db.execute(\"SELECT e.id, s.name FROM student_enrollments e JOIN students s ON s.id = e.student_id WHERE e.academic_year_id = ? AND e.jenjang_id = ? ORDER BY e.id\", (year_id, smp_id)).fetchall()]; db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, 80), (?, ?, ?, 90), (?, ?, ?, 70)\", (enrollments[0][0], subject_id, components[0], enrollments[0][0], subject_id, components[1], enrollments[1][0], subject_id, components[0])); db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function seedManualClassInventory(client: any): { academicYearId: number; previousAcademicYearId: number; classIds: Record<string, number> } {
  const academicYearId = Number((client.query("SELECT id FROM academic_years WHERE label = '2026/2027-reports'").get() as any).id);
  const jenjangId = Number((client.query("SELECT id FROM jenjangs WHERE name = 'SD'").get() as any).id);
  const programId = Number(client.run("INSERT INTO academic_programs (jenjang_id, name) VALUES (?, 'Manual Primary')", [jenjangId]).lastInsertRowid);
  const grade1 = Number(client.run("INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number) VALUES (?, ?, 'Grade One', 1)", [jenjangId, programId]).lastInsertRowid);
  const grade2 = Number(client.run("INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number) VALUES (?, ?, 'Grade Two', 2)", [jenjangId, programId]).lastInsertRowid);
  for (const [className, gradeId, section] of [["P1A", grade1, "A"], ["P1B", grade1, "B"], ["P2", grade2, "A"]] as const)
    client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, ?, ?, 1)", [academicYearId, gradeId, className, section]);
  const previousAcademicYearId = Number(client.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('2025/2026-manual', '2025-07-01', '2026-06-30', 'closed', 0)").lastInsertRowid);
  client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, 'OLD', 'OLD', 1)", [previousAcademicYearId, grade1]);
  const classIds = Object.fromEntries((client.query("SELECT c.class_name, c.id FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id WHERE c.academic_year_id = ? AND c.class_name IN ('P1A', 'P1B', 'P2')").all(academicYearId) as any[]).map((value) => [value.class_name, Number(value.id)]));
  for (const [className, classId] of Object.entries(classIds)) for (let index = 0; index < 3; index++) {
    const masterId = `manual-${className}-${index}`;
    client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [masterId, masterId, masterId]);
    client.run(`INSERT INTO student_enrollments
      (student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state)
      VALUES (?,?,?,?,?,1,'2026-07-01','ACTIVE')`, [masterId, academicYearId, jenjangId, classId, className]);
  }
  return { academicYearId, previousAcademicYearId, classIds };
}

async function adminCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function staffCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("analytics and report parity", () => {
  it("matches the report service corpus on a disposable database", async () => {
    const path = `/tmp/operatoros-phase8-reports-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-phase8-reports-audit-${process.pid}` } });
    try {
      const cookie = await adminCookie(app);
      const staff = await staffCookie(app);
      for (const path of ["/api/analytics/filters?academic_year_id=2&jenjang_id=2", "/analytics/filters?academic_year_id=2&jenjang_id=2"]) {
        const filters = await app.handle(new Request(`http://local${path}`, { headers: { cookie } }));
        expect(filters.status).toBe(200);
        expect(await filters.json()).toEqual({
          academic_years: expect.arrayContaining([expect.objectContaining({ id: 2, label: "2026/2027-reports" })]),
          jenjangs: expect.arrayContaining([expect.objectContaining({ id: 2, name: "SMP" })]),
          class_names: ["7A", "7B", "7C"],
          subjects: expect.arrayContaining([expect.objectContaining({ name: "Matematika", jenjang_id: 2 })]),
        });
      }
      const invalidFilters = await app.handle(new Request("http://local/api/analytics/filters?academic_year_id=2.5", { headers: { cookie } }));
      expect(invalidFilters.status).toBe(422);
      for (const alias of ["/api/analytics", "/analytics"]) {
        const byClass = await app.handle(new Request(`http://local${alias}/late-by-class`, { headers: { cookie } }));
        expect(byClass.status).toBe(200);
        expect(await byClass.json()).toEqual(expect.arrayContaining([
          { class_name: "7A", late_count: 3 },
          { class_name: "1A", late_count: 2 },
        ]));
        const byJenjang = await app.handle(new Request(`http://local${alias}/late-by-jenjang`, { headers: { cookie } }));
        expect(byJenjang.status).toBe(200);
        expect(await byJenjang.json()).toEqual(expect.arrayContaining([
          { jenjang: "SMP", late_count: 3 },
          { jenjang: "SD", late_count: 2 },
        ]));
        const byStudent = await app.handle(new Request(`http://local${alias}/late-by-student`, { headers: { cookie } }));
        expect(byStudent.status).toBe(200);
        expect(await byStudent.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({ nama: "Alice SMP7A", class_name: "7A", jenjang: "SMP", late_count: 1 }),
          expect.objectContaining({ nama: "Fajar SD1A", class_name: "1A", jenjang: "SD", late_count: 1 }),
        ]));
        const byStudentRate = await app.handle(new Request(`http://local${alias}/attendance-rate/students`, { headers: { cookie } }));
        expect(byStudentRate.status).toBe(200);
        expect(await byStudentRate.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({ nama: "Alice SMP7A", jenjang: "SMP", total: { present_days: 4, heb: 18, rate: 0.222 } }),
          expect.objectContaining({ nama: "Fajar SD1A", jenjang: "SD", total: { present_days: 3, heb: 15, rate: 0.2 } }),
        ]));
        const byJenjangRate = await app.handle(new Request(`http://local${alias}/attendance-rate/jenjang`, { headers: { cookie } }));
        expect(byJenjangRate.status).toBe(200);
        expect(await byJenjangRate.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({ jenjang: "SMP", total: { avg_present_days: 2.667, heb: 18, rate: 0.148 } }),
          expect.objectContaining({ jenjang: "SD", total: { avg_present_days: 3, heb: 15, rate: 0.2 } }),
        ]));
        const byClassMonth = await app.handle(new Request(`http://local${alias}/monthly-by-class`, { headers: { cookie } }));
        expect(byClassMonth.status).toBe(200);
        expect(await byClassMonth.json()).toEqual(expect.arrayContaining([
          { class_name: "7A", month: "2026-08", late_count: 3 },
          { class_name: "1A", month: "2026-08", late_count: 2 },
        ]));
        const attendanceReport = await app.handle(new Request(`http://local${alias}/attendance-report?academic_year_id=2&period_type=date_range&period=2026-08-01..2026-08-05&start_date=2026-08-01&end_date=2026-08-05`, { headers: { cookie } }));
        expect(attendanceReport.status).toBe(200);
        expect(await attendanceReport.json()).toMatchObject({
          scope: { academic_year_id: 2, period_type: "date_range", start_date: "2026-08-01", end_date: "2026-08-05" },
          canonical_attendance: { source: "student_attendance_records", totals: expect.objectContaining({ recorded_student_days: expect.any(Number), hadir_count: expect.any(Number) }) },
          manual_absence: { source: "manual_monthly_class_totals", period_policy: "include_full_intersecting_months" },
          attendance_basis: [], attendance_basis_unavailable_reason: "CANONICAL_CLASS_UNRESOLVED",
          students: expect.arrayContaining([expect.objectContaining({ name: "Alice SMP7A", hadir: expect.any(Number), recorded: expect.any(Number) })]),
        });
        const interventionImpact = await app.handle(new Request(`http://local${alias}/intervention-impact?academic_year_id=2`, { headers: { cookie } }));
        expect(interventionImpact.status).toBe(200);
        expect(await interventionImpact.json()).toMatchObject({
          filters: { academic_year_id: 2 },
          summary: { total_interventions: 0, open_interventions: 0, resolved_interventions: 0, average_score_delta: null },
          impact_rows: [],
          executive_insights: [expect.objectContaining({ title: "No intervention impact records found" })],
        });
      const managementSummary = await app.handle(new Request(`http://local${alias}/management-summary?academic_year_id=2`, { headers: { cookie } }));
        expect(managementSummary.status).toBe(200);
        const managementJson = await managementSummary.json() as any;
        expect(managementJson).toMatchObject({
          filters: { academic_year_id: 2, academic_year_label: "2026/2027-reports", jenjang_id: null, subject_id: null },
          attendance_summary: { total_records: null, status_counts: { hadir: 18, sakit: 3, izin: 2, alfa: 1 }, status_percentages: { hadir: null, sakit: null, izin: null, alfa: null } },
          thresholds: { kkm_edelweiss: 85, kkm_national: 75, legacy_fallback: 85 },
        });
        expect(managementJson.terms_breakdown).toEqual(expect.arrayContaining([expect.objectContaining({ term_number: 1, hadir: 18, sakit: 3, izin: 2, alfa: 1, total_records: null, attendance_percentage: null })]));
        const canonicalOverview = await app.handle(new Request("http://local/api/analytics/overview?academic_year_id=2", { headers: { cookie } }));
        expect(canonicalOverview.status).toBe(200);
        expect(await canonicalOverview.json()).toMatchObject({
          contract_version: "analytics.v1",
          filters: { academic_year_id: 2, start_date: "2026-07-01", end_date: "2027-06-30" },
          summary: { attendance_rate: { value: null, numerator: null, denominator: null, status: "unavailable" } },
        });
        const canonicalTrends = await app.handle(new Request("http://local/api/analytics/trends?academic_year_id=2", { headers: { cookie } }));
        expect(canonicalTrends.status).toBe(200);
        expect((await canonicalTrends.json() as any).series[0].points).toEqual(expect.arrayContaining([expect.objectContaining({ period: "2026-08", metric: expect.objectContaining({ value: null, status: "unavailable" }) })]));
        const canonicalCohorts = await app.handle(new Request("http://local/api/analytics/cohorts?academic_year_id=2&dimension=class", { headers: { cookie } }));
        expect(canonicalCohorts.status).toBe(200);
        expect((await canonicalCohorts.json() as any).cohorts).toEqual(expect.arrayContaining([expect.objectContaining({ label: "7A" })]));
      }
      const monthly = await app.handle(new Request("http://local/api/reports/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie } }));
      expect(monthly.status).toBe(409);
      expect(await monthly.json()).toMatchObject({ detail: expect.stringContaining("historical class cannot be resolved") });

      const management = await app.handle(new Request("http://local/api/reports/management/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie } }));
      expect(management.status).toBe(409);
      expect((await app.handle(new Request("http://local/api/reports/management/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie: staff } }))).status).toBe(403);

      const annual = await app.handle(new Request("http://local/api/reports/annual?academic_year_id=2&scope=combined", { headers: { cookie } }));
      expect(annual.status).toBe(409);

      const heb = await app.handle(new Request("http://local/api/analytics/heb?month=8&year=2026", { headers: { cookie } }));
      expect(heb.status).toBe(200);
      expect((await heb.json() as any).heb_by_jenjang).toEqual(expect.arrayContaining([
        expect.objectContaining({ jenjang: "SD", heb: 15, source: "manual", auto_heb: 3, override_heb: 15 }),
        expect.objectContaining({ jenjang: "SMP", heb: 18, source: "manual", auto_heb: 4, override_heb: 18 }),
      ]));

      const tardiness = await app.handle(new Request("http://local/api/analytics/tardiness-report?month=8&year=2026", { headers: { cookie } }));
      expect(tardiness.status).toBe(200);
      const tardinessJson = await tardiness.json() as any;
      // Canonical lateness: 07:45 arrivals against SMP 07:30 / SD 07:25 cutoffs.
      // The two SD 07:30 arrivals on Saturday 08-01 are stored on-time but are
      // canonically late (07:30 > 07:25); incidents are facts, so they count as
      // late events while Saturday stays out of the expected-day denominator.
      expect(tardinessJson.totals).toMatchObject({ expected_student_days: 168, late_events: 7, affected_students: 5, total_late_minutes: 95, average_late_minutes: 95 / 7, unique_late_days: 3, tracked_school_days: 4, school_impact_rate_pct: 75 });
      expect(tardinessJson.totals.arrival_evidence_records).toBeGreaterThan(0);
      const noRecordedDays = await app.handle(new Request("http://local/api/analytics/tardiness-report?date_from=2027-01-03&date_to=2027-01-03", { headers: { cookie } }));
      expect(noRecordedDays.status).toBe(200);
      expect((await noRecordedDays.json() as any).totals).toMatchObject({ expected_student_days: 0, arrival_evidence_records: 0, late_events: 0, tracked_school_days: 0, school_impact_rate_pct: null, late_event_rate: null });
      const absentStudentId = Number((database.client.query("SELECT id FROM students WHERE name = 'Alice SMP7A'").get() as any).id);
      database.client.run("INSERT INTO attendance (student_id, date, late_duration, late_source, status, is_absent) VALUES (?, '2026-08-31', 0, 'test', 'sakit', 1)", [absentStudentId]);
      const absenceOnly = await app.handle(new Request("http://local/api/analytics/tardiness-report?date_from=2026-08-31&date_to=2026-08-31", { headers: { cookie } }));
      expect(absenceOnly.status).toBe(200);
      const absenceOnlyTotals = (await absenceOnly.json() as any).totals;
      expect(absenceOnlyTotals).toMatchObject({ arrival_evidence_records: 0, late_events: 0 });
      expect(absenceOnlyTotals.expected_student_days).toBeGreaterThan(0);
      for (const exportPath of ["export-excel", "export-management-excel"]) {
        const unavailableExport = await app.handle(new Request(`http://local/api/analytics/tardiness-report/${exportPath}?date_from=2026-08-31&date_to=2026-08-31`, { headers: { cookie } }));
        expect(unavailableExport.status).toBe(422);
      }
      expect(tardinessJson.management_summary).toMatchObject({ late_events: 7, affected_students: 5, total_late_minutes: 95, average_late_minutes: 95 / 7 });
      expect(tardinessJson.breakdown_by_class).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_name: "7A", jenjang: "SMP", late_events: 3, affected_students: 3, total_late_minutes: 45 }),
        expect.objectContaining({ class_name: "1A", jenjang: "SD", late_events: 4, affected_students: 2, total_late_minutes: 50 }),
      ]));
      expect(tardinessJson.breakdown_by_class.reduce((sum: number, row: any) => sum + row.late_events, 0)).toBe(tardinessJson.totals.late_events);
      expect(tardinessJson.breakdown_by_class.reduce((sum: number, row: any) => sum + row.total_late_minutes, 0)).toBe(tardinessJson.totals.total_late_minutes);

      const rekap = await app.handle(new Request("http://local/api/analytics/v2/rekap-absensi?month=8&year=2026", { headers: { cookie } }));
      expect(rekap.status).toBe(200);
      expect((await rekap.json() as any).manual_absence).toMatchObject({
        source: "manual_monthly_class_totals", totals: { sakit: null, izin: null, alfa: null },
        completeness: { expected_class_month_entries: 0, completed_class_month_entries: 0, missing_class_month_entries: 0 }, classes: [],
      });
      const term = await app.handle(new Request("http://local/api/analytics/attendance/term?academic_year_id=2&term_number=1", { headers: { cookie } }));
      expect(term.status).toBe(200);
      expect((await term.json() as any).period).toMatchObject({ academic_year_id: 2, term_number: 1 });

      const termLateness = await app.handle(new Request("http://local/api/analytics/attendance/term-lateness?academic_year_id=2&term_number=1", { headers: { cookie } }));
      expect(termLateness.status).toBe(200);
      const latenessJson = await termLateness.json() as any;
      expect(latenessJson.period).toMatchObject({ academic_year_id: 2, term_number: 1, start_date: "2026-07-01", end_date: "2026-09-30" });
      expect(latenessJson.cutoffs).toEqual(expect.arrayContaining([
        expect.objectContaining({ jenjang: "SMP", cutoff_time: "07:30" }),
        expect.objectContaining({ jenjang: "SD", cutoff_time: "07:25" }),
      ]));
      expect(latenessJson.totals).toMatchObject({ late_events: 7, affected_students: 5, total_late_minutes: 95, average_late_minutes: 95 / 7 });
      expect(latenessJson.classes.reduce((sum: number, row: any) => sum + row.totals.late_events, 0)).toBe(latenessJson.totals.late_events);
      expect(latenessJson.classes.reduce((sum: number, row: any) => sum + row.totals.total_late_minutes, 0)).toBe(latenessJson.totals.total_late_minutes);
      expect(latenessJson.classes.reduce((sum: number, row: any) => sum + row.totals.expected_student_days, 0)).toBe(latenessJson.totals.expected_student_days);
      expect(latenessJson.students.reduce((sum: number, row: any) => sum + row.late_events, 0)).toBe(latenessJson.totals.late_events);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("keeps report rounding and HEB fallback semantics explicit", () => {
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(lateAmongPresentRate(10, 90)).toBe(11.11);
    expect(lateAmongPresentRate(10, 0)).toBeNull();
  });

  it("uses canonical jenjang levels for dynamically named report scopes", async () => {
    const path = `/tmp/operatoros-round2-report-scope-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-round2-report-scope-audit-${process.pid}` } });
    try {
      database.client.run("UPDATE student_enrollments SET effective_from='2027-01-01' WHERE academic_year_id=2");
      seedManualClassInventory(database.client);
      database.client.run("UPDATE jenjangs SET name = 'Round2 SD' WHERE name = 'SD'");
      const cookie = await adminCookie(app);
      const response = await app.handle(new Request("http://local/api/reports/monthly?academic_year_id=2&month=2026-08&scope=primary", { headers: { cookie } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.population.total_students).toBeGreaterThan(0);
      expect(body.data_quality.unmapped_levels).not.toContain("Round2 SD");
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("filters reports by class ID when display names repeat and keeps legacy names at the boundary", async () => {
    const path = `/tmp/operatoros-report-class-id-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-report-class-id-audit-${process.pid}` } });
    try {
      database.client.run("UPDATE student_enrollments SET effective_from='2027-01-01' WHERE academic_year_id=2");
      const { academicYearId, classIds } = seedManualClassInventory(database.client);
      const duplicateId = Number(database.client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, (SELECT id FROM academic_grades WHERE name = 'Grade Two' LIMIT 1), 'P1A', 'A2', 1)", [academicYearId]).lastInsertRowid);
      const enrollmentIds = (database.client.query("SELECT id FROM student_enrollments WHERE academic_year_id = ? AND class_name = '1A' ORDER BY id LIMIT 2").all(academicYearId) as any[]).map((value) => Number(value.id));
      expect(enrollmentIds).toHaveLength(2);
      database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = 'P1A' WHERE id = ?", [classIds.P1A!, enrollmentIds[0]!]);
      database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = 'P1A' WHERE id = ?", [duplicateId, enrollmentIds[1]!]);
      const cookie = await adminCookie(app);
      const filtersResponse = await app.handle(new Request(`http://local/api/reports/filters?academic_year_id=${academicYearId}&scope=primary`, { headers: { cookie } }));
      const filters = await filtersResponse.json() as any;
      expect(Value.Check(ReportFiltersResponseSchema, filters)).toBe(true);
      expect(filters.class_options.filter((value: any) => value.name === "P1A").map((value: any) => value.id).sort()).toEqual([classIds.P1A, duplicateId].sort());

      for (const classId of [classIds.P1A, duplicateId]) {
        const result = await app.handle(new Request(`http://local/api/reports/monthly?academic_year_id=${academicYearId}&month=2026-08&scope=primary&class_id=${classId}&class_name=1A`, { headers: { cookie } }));
        expect(result.status).toBe(200);
        const body = await result.json() as any;
        expect(body.population.total_students).toBe(classId === classIds.P1A ? 4 : 1);
        expect(body.attendance.classes).toEqual([expect.objectContaining({ class_id: classId, class_name: "P1A" })]);
      }
      const management = await app.handle(new Request(`http://local/api/reports/management/monthly?academic_year_id=${academicYearId}&month=2026-08&scope=primary&class_id=${duplicateId}`, { headers: { cookie } }));
      expect((await management.json() as any).population.total_students).toBe(1);
      const legacy = await app.handle(new Request(`http://local/api/reports/monthly?academic_year_id=${academicYearId}&month=2026-08&scope=primary&class_name=P1A`, { headers: { cookie } }));
      expect((await legacy.json() as any).population.total_students).toBe(5);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("serves historical trends and management export aliases", async () => {
    const path = `/tmp/operatoros-phase10-analytics-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-phase10-analytics-audit-${process.pid}` } });
    try {
      const cookie = await adminCookie(app);
      const trends = await app.handle(new Request("http://local/api/analytics/historical-trends?academic_year_id=2&include_forecast=true", { headers: { cookie } }));
      expect(trends.status).toBe(200);
      expect(await trends.json()).toMatchObject({ filters: { academic_year_id: 2, granularity: "term" }, trend_series: { attendance: { by_month: expect.any(Array), by_term: expect.any(Array) }, grades: { by_term: expect.any(Array) } }, forecast_series: expect.any(Array) });
      const invalid = await app.handle(new Request("http://local/analytics/historical-trends?academic_year_id=2&granularity=bad", { headers: { cookie } }));
      expect(invalid.status).toBe(400);
      for (const path of ["/api/analytics", "/analytics"]) {
        const excel = await app.handle(new Request(`http://local${path}/management-summary/export/excel?academic_year_id=2&mode=editable`, { headers: { cookie } }));
        expect(excel.status).toBe(200);
        expect(excel.headers.get("content-type")).toContain("spreadsheetml");
        expect(new TextDecoder().decode((await excel.arrayBuffer()).slice(0, 2))).toBe("PK");
        const pdf = await app.handle(new Request(`http://local${path}/management-summary/export/pdf?academic_year_id=2`, { headers: { cookie } }));
        expect(pdf.status).toBe(200);
        expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 4))).toBe("%PDF");
      }
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("exports report, tardiness, and rekap workbooks without mutation", async () => {
    const path = `/tmp/operatoros-phase8-exports-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-phase8-exports-audit-${process.pid}` } });
    try {
      const cookie = await adminCookie(app);
      const before = database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      for (const path of [
        "/api/analytics/tardiness-report/export-excel?month=8&year=2026",
        "/api/analytics/v2/rekap-absensi/export-excel?month=8&year=2026",
      ]) {
        const response = await app.handle(new Request(`http://local${path}`, { headers: { cookie } }));
        expect(response.status).toBe(200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(100);
        if (path.endsWith("format=pdf")) expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
        else {
          expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe("PK");
          const workbook = await loadXlsxWorkbook(bytes);
          expect(workbook.worksheets.length).toBeGreaterThan(0);
        }
      }
      expect((database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count).toBe(before.count);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("keeps tardiness table, chart source, and export values on the same canonical DTO", async () => {
    const path = `/tmp/operatoros-phase8-lateness-parity-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-phase8-lateness-parity-audit-${process.pid}` } });
    try {
      const cookie = await adminCookie(app);
      const report = await app.handle(new Request("http://local/api/analytics/tardiness-report?month=8&year=2026", { headers: { cookie } }));
      expect(report.status).toBe(200);
      const json = await report.json() as any;
      // Chart source (summary endpoint) reconciles with the report table totals.
      const summary = await app.handle(new Request("http://local/api/analytics/tardiness-report/summary-by-jenjang?month=8&year=2026", { headers: { cookie } }));
      expect(summary.status).toBe(200);
      const summaryJson = await summary.json() as any;
      expect(summaryJson.rows.reduce((sum: number, row: any) => sum + row.total_kejadian, 0)).toBe(json.totals.late_events);
      expect(summaryJson.rows.reduce((sum: number, row: any) => sum + row.hari_efektif_terlambat, 0)).toBeGreaterThanOrEqual(json.totals.unique_late_days);
      // Export workbook carries the same canonical values as the JSON report.
      const exported = await app.handle(new Request("http://local/api/analytics/tardiness-report/export-excel?month=8&year=2026", { headers: { cookie } }));
      expect(exported.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exported.arrayBuffer()));
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toEqual(expect.arrayContaining(["Management Summary", "Summary by Jenjang", "Class Breakdown", "Student Details"]));
      const classes = workbook.getWorksheet("Class Breakdown")!;
      expect(classes.getRow(1).getCell(8).value).toBe("Late Event Rate %");
      const exportedRows = [2, 3, 4, 5, 6].map((rowNumber) => ({
        class_name: String(classes.getRow(rowNumber).getCell(1).value ?? ""),
        late_events: Number(classes.getRow(rowNumber).getCell(4).value ?? 0),
        total_late_minutes_str: String(classes.getRow(rowNumber).getCell(6).value ?? ""),
      })).filter((row) => row.class_name);
      for (const row of json.breakdown_by_class as any[]) {
        expect(exportedRows).toContainEqual({ class_name: row.class_name, late_events: row.late_events, total_late_minutes_str: row.total_late_minutes_str });
      }
      const management = workbook.getWorksheet("Management Summary")!;
      const metrics = new Map<string, unknown>();
      management.eachRow((row, rowNumber) => { if (rowNumber > 1) metrics.set(String(row.getCell(1).value ?? ""), row.getCell(2).value); });
      expect(metrics.get("late_events")).toBe(json.management_summary.late_events);
      expect(metrics.get("total_late_minutes")).toBe(json.management_summary.total_late_minutes);
      expect(metrics.get("affected_students")).toBe(json.management_summary.affected_students);
      expect(metrics.get("late_event_rate")).toBe(json.management_summary.late_event_rate);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("returns no HEB for an empty auto case", () => {
    const path = `/tmp/operatoros-phase8-heb-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    try {
      expect(calculateHeb({ database } as any, "SMP", 7, 2026)).toMatchObject({ heb: 0, source: "auto", derived_from: [] });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("keeps monthly class absence entry separate and reconciles reports, Term, and export", async () => {
    const path = `/tmp/operatoros-manual-absence-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-manual-absence-audit-${process.pid}` } });
    try {
      const { academicYearId, previousAcademicYearId, classIds } = seedManualClassInventory(database.client);
      const cookie = await adminCookie(app);
      const staff = await staffCookie(app);
      const request = (path: string, init: RequestInit = {}) => app.handle(new Request(`http://local${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }));
      const query = (month: string) => `/api/config/absence-reasons?academic_year_id=${academicYearId}&month=${month}`;
      const save = async (month: string, classes: Array<{ class_id: number; sakit: number; izin: number; alfa: number }>) => request("/api/config/absence-reasons/bulk", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month, classes }),
      });
      const submit = (month: string, class_id: number) => request("/api/config/absence-reasons/submit", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month, class_id }),
      });
      const classes = (values: Array<[string, number, number, number]>) => values.map(([name, sakit, izin, alfa]) => ({ class_id: classIds[name]!, sakit, izin, alfa }));
      const beforeTerm = await request(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`);
      const beforeOverview = await request(`/api/analytics/overview?academic_year_id=${academicYearId}`);
      expect(beforeTerm.status).toBe(200);
      expect(beforeOverview.status).toBe(200);

      const entryList = await request(query("2026-09"));
      expect(entryList.status).toBe(200);
      const emptyMonth = await entryList.json() as any;
      expect(emptyMonth.classes).toHaveLength(3);
      expect(emptyMonth.classes).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_name: "P1A", sakit: 0, izin: 0, alfa: 0, has_data: false }),
        expect.objectContaining({ class_name: "P1B", has_data: false }),
        expect.objectContaining({ class_name: "P2", has_data: false }),
      ]));
      expect((await (await request(`/api/config/absence-reasons?academic_year_id=${previousAcademicYearId}&month=2025-09`)).json() as any).classes.map((value: any) => value.class_name)).toEqual(["OLD"]);
      expect((await request(query("2027-07"))).status).toBe(422);

      expect((await save("2026-07", classes([["P1A", 2, 1, 0], ["P1B", 1, 0, 1], ["P2", 0, 1, 0]]))).status).toBe(200);
      expect((await save("2026-08", classes([["P1A", 1, 1, 0], ["P1B", 0, 1, 0], ["P2", 3, 0, 1]]))).status).toBe(200);
      expect((await save("2026-09", classes([["P1A", 5, 2, 1], ["P1B", 3, 1, 0]]))).status).toBe(200);
      expect((await (await request(query("2026-09"))).json() as any).classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ state: "OPEN", has_data: true });
      const draftReport = await request(`/api/analytics/attendance-report?academic_year_id=${academicYearId}&period_type=month&period=2026-09`);
      expect((await draftReport.json() as any).manual_absence.completeness).toMatchObject({ completed_class_month_entries: 0, missing_class_month_entries: 3 });
      expect((await request("/api/config/absence-reasons/summary?month=9&year=2026")).status).toBe(200);
      for (const month of ["2026-07", "2026-08"]) for (const class_id of Object.values(classIds)) {
        expect((await submit(month, class_id)).status).toBe(200);
      }
      for (const name of ["P1A", "P1B"]) expect((await submit("2026-09", classIds[name]!)).status).toBe(200);
      const dashboardSummary = await app.handle(new Request("http://local/api/config/absence-reasons/summary?month=9&year=2026", { headers: { cookie: staff } }));
      expect(dashboardSummary.status).toBe(200);
      expect(await dashboardSummary.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ jenjang: "SD", total_sakit: 8, total_izin: 3, total_alfa: 1, classes_entered: 2 }),
      ]));
      expect((await save("2026-10", classes([["P1A", 9, 8, 7]]))).status).toBe(200);
      expect((await submit("2026-10", classIds.P1A!)).status).toBe(200);
      expect((await save("2026-10", classes([["P1A", 9, 8, 7]]))).status).toBe(409);
      const reopened = await request("/api/config/absence-reasons/reopen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month: "2026-10", class_id: classIds.P1A, reason: "Correcting the saved totals" }) });
      expect(reopened.status, JSON.stringify(await reopened.clone().json())).toBe(200);
      const duplicateMonthSave = await save("2026-10", classes([["P1A", 9, 8, 7]]));
      expect(duplicateMonthSave.status).toBe(200);
      expect(await duplicateMonthSave.json()).toMatchObject({ inserted: 0, updated: 1, total: 1 });

      const september = await request(query("2026-09"));
      const septemberBody = await september.json() as any;
      expect(septemberBody.classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 5, izin: 2, alfa: 1, has_data: true });
      expect(septemberBody.classes.find((value: any) => value.class_name === "P2")).toMatchObject({ sakit: 0, izin: 0, alfa: 0, has_data: false });
      const october = await request(query("2026-10"));
      expect((await october.json() as any).classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 9, izin: 8, alfa: 7, has_data: true });
      const septemberAgain = await request(query("2026-09"));
      expect((await septemberAgain.json() as any).classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 5, izin: 2, alfa: 1, has_data: true });

      const reportPath = `/api/analytics/attendance-report?academic_year_id=${academicYearId}&period_type=term&period=1`;
      const reportResponse = await request(reportPath);
      expect(reportResponse.status).toBe(200);
      const report = await reportResponse.json() as any;
      expect(report.manual_absence).toMatchObject({
        source: "manual_monthly_class_totals",
        totals: { sakit: 15, izin: 7, alfa: 3 },
        completeness: { complete: false, expected_class_month_entries: 9, completed_class_month_entries: 8, missing_class_month_entries: 1, missing: [{ class_id: classIds.P2, class_name: "P2", month: "2026-09" }] },
      });
      expect(report.manual_absence.classes.reduce((total: number, value: any) => total + (value.sakit ?? 0), 0)).toBe(report.manual_absence.totals.sakit);
      expect(report.manual_absence.classes.reduce((total: number, value: any) => total + (value.izin ?? 0), 0)).toBe(report.manual_absence.totals.izin);
      expect(report.manual_absence.classes.reduce((total: number, value: any) => total + (value.alfa ?? 0), 0)).toBe(report.manual_absence.totals.alfa);
      expect(report.manual_absence.classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 8, izin: 4, alfa: 1 });
      expect(report.students.every((value: any) => value.sakit !== 5 && value.izin !== 2 && value.alfa !== 1)).toBe(true);

      const monthlyReport = await request(`${reportPath.replace("period_type=term&period=1", "period_type=month&period=2026-09")}`);
      const monthlyBody = await monthlyReport.json() as any;
      expect(monthlyBody.manual_absence.totals).toEqual({ sakit: 8, izin: 3, alfa: 1 });
      expect(monthlyBody.manual_absence.classes.find((value: any) => value.class_name === "P2")).toMatchObject({ sakit: null, izin: null, alfa: null, missing_months: ["2026-09"] });

      const rekapResponse = await request(`/api/analytics/v2/rekap-absensi?academic_year_id=${academicYearId}&period_type=term&period=1`);
      expect(rekapResponse.status).toBe(200);
      const rekap = await rekapResponse.json() as any;
      expect(rekap.manual_absence).toEqual(report.manual_absence);
      expect(rekap.attendance_basis).toEqual(report.attendance_basis);
      const exportResponse = await request(`/api/analytics/v2/rekap-absensi/export-excel?academic_year_id=${academicYearId}&period_type=term&period=1`);
      expect(exportResponse.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exportResponse.arrayBuffer()));
      const exportSheet = workbook.getWorksheet("Rekap Manual")!;
      expect(exportSheet.getRow(15).getCell(4).value).toBe(15);
      expect(exportSheet.getRow(15).getCell(5).value).toBe(7);
      expect(exportSheet.getRow(15).getCell(6).value).toBe(3);
      const reconciliation = workbook.getWorksheet("Basis & Rekonsiliasi")!;
      expect(reconciliation.getRow(2).getCell(3).value).toBe("Basis");

      const afterTerm = await request(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`);
      const afterOverview = await request(`/api/analytics/overview?academic_year_id=${academicYearId}`);
      expect((await afterTerm.json() as any).totals).toEqual((await beforeTerm.json() as any).totals);
      expect((await afterOverview.json() as any).summary).toEqual((await beforeOverview.json() as any).summary);
      expect((database.client.query("SELECT COUNT(*) AS count FROM absence_reasons WHERE class_name LIKE 'P1%' OR class_name = 'P2'").get() as any).count).toBe(0);

      const enrollmentId = Number((database.client.query("SELECT id FROM student_enrollments WHERE academic_class_id = ? ORDER BY id LIMIT 1").get(classIds.P1B!) as any).id);
      const perStudentSave = await request("/api/config/absence-reasons/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month: "2026-10", classes: [{ class_id: classIds.P1B!, entry_mode: "PER_STUDENT", student_totals: [{ enrollment_id: enrollmentId, sakit: 1, izin: 0, alfa: 0 }] }] }) });
      expect(perStudentSave.status).toBe(200);
      expect((await submit("2026-10", classIds.P1B!)).status).toBe(200);
      const perStudent = (await (await request(query("2026-10"))).json() as any).classes.find((value: any) => value.class_name === "P1B");
      expect(perStudent).toMatchObject({ sakit: 1, izin: 0, alfa: 0, state: "SUBMITTED", entry_mode: "PER_STUDENT" });
      const studentTotalsResponse = await request(`/api/config/absence-reasons/students?academic_year_id=${academicYearId}&month=2026-10&class_id=${classIds.P1B}`);
      expect(studentTotalsResponse.status).toBe(200);
      expect(await studentTotalsResponse.json()).toMatchObject({
        academic_year_id: academicYearId, month: "2026-10", class_id: classIds.P1B,
        students: expect.arrayContaining([expect.objectContaining({ enrollment_id: enrollmentId, sakit: 1, izin: 0, alfa: 0 })]),
      });
      expect(database.client.query(`SELECT r.sakit,r.izin,r.alfa FROM attendance_ledger_revisions r
        JOIN attendance_ledger_class_months cm ON cm.id=r.class_month_id
        WHERE cm.academic_year_id=? AND cm.class_id=? AND cm.month='2026-10' ORDER BY r.revision_no DESC LIMIT 1`).get(academicYearId, classIds.P1B!)).toEqual({ sakit: null, izin: null, alfa: null });

      const legacyStudentId = Number(database.client.run("INSERT INTO students (name,jenjang,class_name) VALUES ('Legacy Recap Student','SD','P1B')").lastInsertRowid);
      database.client.run(`INSERT INTO absence_reasons (student_id,class_name,month,year,sakit,izin,alfa,note,entered_by,entered_at,updated_at)
        VALUES (?,'P1B',10,2026,2,1,0,'synthetic legacy row','golden-admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [legacyStudentId]);
      const legacyCount = Number((database.client.query("SELECT COUNT(*) AS count FROM absence_reasons").get() as any).count);
      const legacyResponse = await request("/api/config/absence-reasons/legacy?month=2026-10");
      expect(legacyResponse.status).toBe(200);
      expect(await legacyResponse.json()).toMatchObject({
        month: "2026-10", rows: expect.arrayContaining([expect.objectContaining({ student_name: "Legacy Recap Student", class_name: "P1B", sakit: 2, izin: 1, alfa: 0 })]),
      });
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM absence_reasons").get() as any).count)).toBe(legacyCount);
      expect((await app.handle(new Request("http://local/api/config/absence-reasons/legacy?month=2026-10", { headers: { cookie: staff } }))).status).toBe(403);

      const invalidClass = await save("2026-10", [{ class_id: classIds.P1A!, sakit: 10, izin: 10, alfa: 10 }, { class_id: 999999, sakit: 1, izin: 1, alfa: 1 }]);
      expect(invalidClass.status).toBe(422);
      const decimal = await save("2026-10", [{ class_id: classIds.P1A!, sakit: 1.5, izin: 0, alfa: 0 }]);
      expect(decimal.status).toBe(400);
      const unauthorized = await app.handle(new Request("http://local/api/config/absence-reasons/bulk", { method: "POST", headers: { cookie: staff, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month: "2026-10", classes: [{ class_id: classIds.P1A, sakit: 1, izin: 1, alfa: 1 }] }) }));
      expect(unauthorized.status).toBe(403);
      const savedValue = await request(query("2026-10"));
      expect((await savedValue.json() as any).classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 9, izin: 8, alfa: 7, state: "OPEN" });
      expect((database.client.query("SELECT actor_id, metadata FROM operations_audit_events WHERE operation = 'SAVE_MANUAL_MONTHLY_ABSENCE_TOTALS' ORDER BY rowid DESC LIMIT 1").get() as any).actor_id).toBe("golden-admin");

    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});

describe("attendance basis resolver", () => {
  it("resolves canonical, declared, partial, transfer, override, and unreported class-months", async () => {
    const path = `/tmp/operatoros-c2-basis-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-c2-basis-audit-${process.pid}-${Date.now()}`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const cookie = await adminCookie(app);
      const request = (route: string, init: RequestInit = {}) => app.handle(new Request(`http://local${route}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }));
      database.client.run("UPDATE student_enrollments SET effective_from='2027-01-01' WHERE academic_year_id=?", [Number((database.client.query("SELECT id FROM academic_years WHERE label='2026/2027-reports'").get() as any).id)]);
      const inventory = seedManualClassInventory(database.client);
      const yearId = inventory.academicYearId;
      const classIds: Record<string, number> = { ...inventory.classIds };
      const gradeId = Number((database.client.query("SELECT grade_id FROM academic_classes WHERE id=?").get(classIds.P1A!) as any).grade_id);
      for (const [name, section] of [["PARTIAL", "C"], ["ZERO", "Z"], ["OPEN", "O"], ["MISSING", "M"], ["NONEXPECTED", "N"]] as const) {
        classIds[name] = Number(database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?,?,?,?,1)", [yearId, gradeId, name, section]).lastInsertRowid);
      }
      const jenjangId = Number((database.client.query("SELECT id FROM jenjangs WHERE name='SD'").get() as any).id);
      const addStudent = (name: string) => {
        const masterId = `c2-${name.toLowerCase().replaceAll(" ", "-")}`;
        database.client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,?,?,'active')", [masterId, name, name.toLowerCase()]);
        const studentId = Number(database.client.run("INSERT INTO students (name,jenjang,class_name) VALUES (?,'SD','P1A')", [name]).lastInsertRowid);
        return { masterId, studentId };
      };
      const addEnrollment = (name: string, className: string, classId: number, start: string, end: string | null) => {
        const student = addStudent(name);
        const enrollmentId = Number(database.client.run(`INSERT INTO student_enrollments
          (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,effective_to,lifecycle_state)
          VALUES (?,?,?,?,?,?,1,?,?,'ACTIVE')`, [student.studentId, student.masterId, yearId, jenjangId, classId, className, start, end]).lastInsertRowid);
        return { ...student, enrollmentId };
      };
      const addAttendance = (studentId: number, date: string, status: string, checkIn: string | null = "07:20:00") => Number(database.client.run(`INSERT INTO attendance
        (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status)
        VALUES (?,?,?,NULL,0,'calculated',0,?)`, [studentId, date, checkIn, status]).lastInsertRowid);

      const p1aEnrollments = database.client.query("SELECT id FROM student_enrollments WHERE academic_class_id=? ORDER BY id").all(classIds.P1A!) as any[];
      const p1aStudents = p1aEnrollments.map((enrollment, index) => {
        const student = addStudent(`C2 P1A ${index}`);
        database.client.run("UPDATE student_enrollments SET student_id=?,effective_from='2026-08-03',effective_to='2026-08-04' WHERE id=?", [student.studentId, enrollment.id]);
        return student;
      });
      const p1aSickAttendance = p1aStudents.map((student, index) => addAttendance(student.studentId, "2026-08-04", "sakit"));
      const p1aOnTimeAttendance = p1aStudents.map((student, index) => addAttendance(student.studentId, "2026-08-03", "on-time", index === 0 ? "07:40:00" : "07:20:00"));

      database.client.run("UPDATE student_enrollments SET effective_from='2027-01-01' WHERE academic_class_id=?", [classIds.P1B!]);
      database.client.run("UPDATE student_enrollments SET effective_from='2026-08-03',effective_to='2026-08-04' WHERE academic_class_id=?", [classIds.P2!]);
      const partial = addEnrollment("C2 Partial Student", "PARTIAL", classIds.PARTIAL!, "2026-08-03", "2026-08-04");
      addAttendance(partial.studentId, "2026-08-03", "on-time");
      const transfer = addEnrollment("C2 Transfer Student", "P1B", classIds.P1B!, "2026-08-03", "2026-08-06");
      database.client.run(`INSERT INTO student_enrollment_class_history (enrollment_id,class_name,effective_from,effective_to,changed_by,source)
        VALUES (?, 'P1A','2026-08-03','2026-08-04','synthetic-test','synthetic-test'),
          (?, 'P1B','2026-08-05','2026-08-06','synthetic-test','synthetic-test')`, [transfer.enrollmentId, transfer.enrollmentId]);
      for (const date of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]) addAttendance(transfer.studentId, date, "on-time");
      const rosterFor = async (classId: number) => {
        const response = await request(`/api/config/absence-reasons/students?academic_year_id=${yearId}&month=2026-08&class_id=${classId}`);
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        return (await response.json() as any).students;
      };
      expect(await rosterFor(classIds.P1A!)).toEqual(expect.arrayContaining([
        expect.objectContaining({ enrollment_id: transfer.enrollmentId, student_name: "C2 Transfer Student", expected_student_days: 2 }),
      ]));
      expect(await rosterFor(classIds.P1B!)).toEqual(expect.arrayContaining([
        expect.objectContaining({ enrollment_id: transfer.enrollmentId, student_name: "C2 Transfer Student", expected_student_days: 2 }),
      ]));
      const nonExpected = addEnrollment("C2 Nonexpected Student", "NONEXPECTED", classIds.NONEXPECTED!, "2026-08-01", "2026-08-01");
      addAttendance(nonExpected.studentId, "2026-08-01", "on-time");
      database.client.run("UPDATE heb_overrides SET heb_value=99,note='Synthetic cutoff-independent override',set_by='golden-admin' WHERE jenjang='SD' AND month=8 AND year=2026");

      const override = await request(`/api/review/attendance/${p1aSickAttendance[0]}/override`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ override_status: "on-time", note: "Synthetic approved attendance correction" }) });
      expect(override.status).toBe(200);
      const save = (classId: number, body: Record<string, unknown>) => request("/api/config/absence-reasons/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ academic_year_id: yearId, month: "2026-08", classes: [{ class_id: classId, ...body }] }),
      });
      const submit = (classId: number) => request("/api/config/absence-reasons/submit", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, month: "2026-08", class_id: classId }),
      });
      const basisFor = async (classId: number) => {
        const response = await request(`/api/analytics/attendance/basis?academic_year_id=${yearId}&month=2026-08&class_id=${classId}`);
        expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
        const result = await response.json() as any;
        expect(Value.Check(AttendanceBasisResponseSchema, result)).toBe(true);
        return result.classes[0];
      };

      expect((await save(classIds.P1A!, { sakit: 2, izin: 0, alfa: 0 })).status).toBe(200);
      expect((await submit(classIds.P1A!)).status).toBe(200);
      const matching = await basisFor(classIds.P1A!);
      expect(matching).toMatchObject({
        basis: "OBSERVED", canonical_evidence_records: 8,
        canonical: { expected_student_days: 8, recorded_student_days: 8, hadir_count: 6, sakit_count: 2, unrecorded_student_days: 0, coverage_rate: 100 },
        ledger: { state: "SUBMITTED", entry_mode: "TOTALS_ONLY" },
        resolved: { hadir_student_days: 6, sakit_student_days: 2 },
        lateness: { availability: "AVAILABLE", late_events: 1 },
        reconciliation: { status: "MATCH", reason_code: null }, conflict: null,
      });
      expect(matching).toHaveProperty("month", "2026-08");

      const reopen = await request("/api/config/absence-reasons/reopen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, month: "2026-08", class_id: classIds.P1A, reason: "Synthetic conflict case" }) });
      expect(reopen.status).toBe(200);
      expect((await save(classIds.P1A!, { sakit: 3, izin: 0, alfa: 0 })).status).toBe(200);
      expect(await basisFor(classIds.P1A!)).toMatchObject({
        basis: "OBSERVED", ledger: { state: "OPEN" },
        declared: { sakit_student_days: null, izin_student_days: null, alfa_student_days: null },
        draft: { sakit_student_days: 3, izin_student_days: 0, alfa_student_days: 0 },
        draft_reconciliation: { status: "CONFLICT", reason_code: "ABSENCE_TOTAL_MISMATCH" },
        draft_conflict: { canonical_non_hadir_student_days: 2, declared_absence_student_days: 3, delta_student_days: 1 },
        conflict: null,
      });
      expect((await submit(classIds.P1A!)).status).toBe(200);
      expect(await basisFor(classIds.P1A!)).toMatchObject({
        basis: "OBSERVED", reconciliation: { status: "CONFLICT", reason_code: "ABSENCE_TOTAL_MISMATCH" },
        conflict: { class_id: classIds.P1A, month: "2026-08", canonical_non_hadir_student_days: 2, declared_absence_student_days: 3, delta_student_days: 1, reason_code: "ABSENCE_TOTAL_MISMATCH" },
      });
      database.client.run("UPDATE attendance SET status='unknown' WHERE id=?", [p1aOnTimeAttendance[1]!]);
      expect(await basisFor(classIds.P1A!)).toMatchObject({
        basis: "OBSERVED", canonical: { recorded_student_days: 8, other_status_count: 1 },
        reconciliation: { status: "NOT_COMPARABLE", reason_code: "CANONICAL_STATUS_UNRESOLVED" }, conflict: null,
      });

      expect((await save(classIds.PARTIAL!, { sakit: 1, izin: 0, alfa: 0 })).status).toBe(200);
      expect((await submit(classIds.PARTIAL!)).status).toBe(200);
      expect(await basisFor(classIds.PARTIAL!)).toMatchObject({
        basis: "OBSERVED", canonical: { expected_student_days: 2, recorded_student_days: 1, unrecorded_student_days: 1, coverage_rate: 50 },
        reconciliation: { status: "NOT_COMPARABLE", reason_code: "CANONICAL_COVERAGE_INCOMPLETE" }, conflict: null,
      });
      expect(await basisFor(classIds.P1B!)).toMatchObject({ basis: "OBSERVED", canonical: { expected_student_days: 2, recorded_student_days: 2 }, ledger: { state: "MISSING" } });

      const perStudent = database.client.query("SELECT id FROM student_enrollments WHERE academic_class_id=? ORDER BY id LIMIT 1").get(classIds.P2!) as any;
      expect((await save(classIds.P2!, { entry_mode: "PER_STUDENT", student_totals: [{ enrollment_id: Number(perStudent.id), sakit: 1, izin: 0, alfa: 0 }] })).status).toBe(200);
      expect((await submit(classIds.P2!)).status).toBe(200);
      expect(await basisFor(classIds.P2!)).toMatchObject({
        basis: "DECLARED", canonical: { expected_student_days: 6, recorded_student_days: 0, unrecorded_student_days: 6 },
        ledger: { state: "SUBMITTED", entry_mode: "PER_STUDENT" },
        declared: { sakit_student_days: 1, izin_student_days: 0, alfa_student_days: 0 },
        resolved: { hadir_student_days: 5, sakit_student_days: 1 }, presumed_hadir_student_days: 5,
        lateness: { availability: "UNAVAILABLE", reason_code: "NO_CANONICAL_EVIDENCE", late_events: null },
      });

      expect((await save(classIds.ZERO!, { sakit: 0, izin: 0, alfa: 0 })).status).toBe(200);
      expect((await submit(classIds.ZERO!)).status).toBe(200);
      expect(await basisFor(classIds.ZERO!)).toMatchObject({
        basis: "DECLARED", canonical: { expected_student_days: 0, coverage_rate: null },
        resolved: { hadir_student_days: 0, sakit_student_days: 0 }, presumed_hadir_student_days: 0,
      });
      expect((await save(classIds.OPEN!, { sakit: 0, izin: 0, alfa: 0 })).status).toBe(200);
      expect(await basisFor(classIds.OPEN!)).toMatchObject({ basis: "NOT_REPORTED", ledger: { state: "OPEN" }, resolved: { hadir_student_days: null, sakit_student_days: null } });
      expect(await basisFor(classIds.MISSING!)).toMatchObject({ basis: "NOT_REPORTED", ledger: { state: "MISSING" }, resolved: { hadir_student_days: null, sakit_student_days: null } });
      expect(await basisFor(classIds.NONEXPECTED!)).toMatchObject({
        basis: "OBSERVED", canonical_evidence_records: 1, canonical: { expected_student_days: 0, recorded_student_days: 0, coverage_rate: null },
        lateness: { availability: "AVAILABLE", late_events: 0 },
      });
      expect(matching.canonical.expected_student_days).toBe(8); // The HEB override does not replace the calendar denominator.
      expect(matching).toHaveProperty("month", "2026-08");
      expect(matching.lateness).toHaveProperty("availability", "AVAILABLE");
      expect((await basisFor(classIds.P1A!)).canonical.expected_student_days).toBe(8);

      expect((await save(classIds.P1B!, { sakit: 1, izin: 0, alfa: 0 })).status).toBe(200);
      expect((await submit(classIds.P1B!)).status).toBe(200);
      const monthlyResponse = await request(`/api/reports/monthly?academic_year_id=${yearId}&month=2026-08&scope=primary`);
      expect(monthlyResponse.status, JSON.stringify(await monthlyResponse.clone().json())).toBe(200);
      const monthly = await monthlyResponse.json() as any;
      expect(Value.Check(MonthlyReportResponseSchema, monthly)).toBe(true);
      expect(monthly.attendance.classes).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_id: classIds.P1A, basis: "OBSERVED", coverage_rate: 100, unrecorded_student_days: 0 }),
        expect.objectContaining({ class_id: classIds.P1B, basis: "OBSERVED", conflict: expect.objectContaining({ reason_code: "ABSENCE_TOTAL_MISMATCH" }) }),
        expect.objectContaining({ class_id: classIds.PARTIAL, basis: "OBSERVED", coverage_rate: 50, unrecorded_student_days: 1 }),
        expect.objectContaining({ class_id: classIds.P2, basis: "DECLARED", lateness: { availability: "UNAVAILABLE", late_events: null, late_event_rate: null, late_minutes: null, unknown_duration_events: null } }),
        expect.objectContaining({ class_id: classIds.OPEN, basis: "NOT_REPORTED", hadir_student_days: null, attendance_rate: null, lateness: expect.objectContaining({ availability: "UNAVAILABLE", late_events: null }) }),
      ]));
      expect(monthly.attendance.summary.lateness).toMatchObject({ availability: "PARTIAL", late_event_rate: null, coverage_rate: 66.7 });
      const monthlyXlsx = await request(`/api/reports/monthly/export?academic_year_id=${yearId}&month=2026-08&scope=primary&format=xlsx`);
      expect(monthlyXlsx.status).toBe(200);
      const monthlyWorkbook = await loadXlsxWorkbook(new Uint8Array(await monthlyXlsx.arrayBuffer()));
      const attendanceSheet = monthlyWorkbook.getWorksheet("Attendance by Class")!;
      const classRow = (name: string) => (attendanceSheet.getRows(2, attendanceSheet.rowCount - 1) ?? []).find((value) => value.getCell(1).value === name)!;
      expect(classRow("P2").getCell(3).value).toBe("DECLARED");
      expect(classRow("P2").getCell(14).value).toBe("UNAVAILABLE");
      expect(classRow("P2").getCell(15).value).toBeNull();
      const monthlyPdf = await request(`/api/reports/management/monthly/export?academic_year_id=${yearId}&month=2026-08&scope=primary&format=pdf`);
      expect(monthlyPdf.status).toBe(200);
      expect(new TextDecoder().decode(new Uint8Array(await monthlyPdf.arrayBuffer()).slice(0, 4))).toBe("%PDF");

      const annual = await request(`/api/reports/annual?academic_year_id=${yearId}&scope=primary&class_id=${classIds.P1B}`);
      expect(annual.status).toBe(200);
      expect((await annual.json() as any).trends).toHaveLength(12);

      const report = await request(`/api/analytics/attendance-report?academic_year_id=${yearId}&period_type=month&period=2026-08`);
      expect(report.status).toBe(200);
      expect((await report.json() as any).attendance_basis).toEqual(expect.arrayContaining([
        expect.objectContaining({ class_id: classIds.P1A, month: "2026-08", basis: "OBSERVED" }),
        expect.objectContaining({ class_id: classIds.P2, month: "2026-08", basis: "DECLARED" }),
      ]));
      const basisExport = await request(`/api/analytics/v2/rekap-absensi/export-excel?academic_year_id=${yearId}&period_type=month&period=2026-08&class_id=${classIds.P1A}`);
      expect(basisExport.status).toBe(200);
      const basisWorkbook = await loadXlsxWorkbook(new Uint8Array(await basisExport.arrayBuffer()));
      const basisSheet = basisWorkbook.getWorksheet("Basis & Rekonsiliasi")!;
      expect(basisSheet.getRow(2).getCell(3).value).toBe("Basis");
      expect(basisSheet.getRow(3).getCell(3).value).toBe("Tercatat");
      for (const date of ["2026-08-03", "2026-08-04"]) database.client.run(`INSERT INTO attendance_calendar_exceptions
        (academic_year_id,jenjang_id,date,expectation,reason,created_by) VALUES (?,?,?,'NOT_EXPECTED','SCHOOL_CLOSED','synthetic-test')`, [yearId, jenjangId, date]);
      const invalidatedDeclaration = await request(`/api/analytics/attendance/basis?academic_year_id=${yearId}&month=2026-08&class_id=${classIds.P2}`);
      expect(invalidatedDeclaration.status).toBe(409);
      expect(await invalidatedDeclaration.json()).toMatchObject({ detail: { code: "DECLARED_ABSENCE_EXCEEDS_EXPECTED_DAYS" } });

      const unresolved = addEnrollment("C2 Unresolved Student", "NO MATCHING CLASS", classIds.P2!, "2026-08-03", "2026-08-03");
      database.client.run(`INSERT INTO student_enrollment_class_history (enrollment_id,class_name,effective_from,effective_to,changed_by,source)
        VALUES (?, 'NO SUCH CLASS','2026-08-03','2026-08-03','synthetic-test','synthetic-test')`, [unresolved.enrollmentId]);
      addAttendance(unresolved.studentId, "2026-08-03", "on-time");
      const unresolvedBasis = await request(`/api/analytics/attendance/basis?academic_year_id=${yearId}&month=2026-08&class_id=${classIds.MISSING}`);
      expect(unresolvedBasis.status).toBe(409);
      expect(await unresolvedBasis.json()).toMatchObject({ detail: { code: "CANONICAL_CLASS_UNRESOLVED" } });
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 60000);
});
