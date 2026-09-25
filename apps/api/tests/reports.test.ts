import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { calculateHeb, roundHalfEven, roundHalfUp } from "../src/domains/reports";
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
          attendance_summary: { total_records: 24, status_counts: { hadir: 18, sakit: 3, izin: 2, alfa: 1 } },
          thresholds: { kkm_edelweiss: 85, kkm_national: 75, legacy_fallback: 85 },
        });
        expect(managementJson.terms_breakdown).toEqual(expect.arrayContaining([expect.objectContaining({ term_number: 1, hadir: 18, sakit: 3, izin: 2, alfa: 1, total_records: 24, attendance_percentage: 75 })]));
        const canonicalOverview = await app.handle(new Request("http://local/api/analytics/overview?academic_year_id=2", { headers: { cookie } }));
        expect(canonicalOverview.status).toBe(200);
        expect(await canonicalOverview.json()).toMatchObject({
          contract_version: "analytics.v1",
          filters: { academic_year_id: 2, start_date: "2026-07-01", end_date: "2027-06-30" },
          summary: { attendance_rate: { value: 75, numerator: 18, denominator: 24 } },
        });
        const canonicalTrends = await app.handle(new Request("http://local/api/analytics/trends?academic_year_id=2", { headers: { cookie } }));
        expect(canonicalTrends.status).toBe(200);
        expect((await canonicalTrends.json() as any).series[0].points).toEqual(expect.arrayContaining([expect.objectContaining({ period: "2026-08", metric: expect.objectContaining({ value: 75 }) })]));
        const canonicalCohorts = await app.handle(new Request("http://local/api/analytics/cohorts?academic_year_id=2&dimension=class", { headers: { cookie } }));
        expect(canonicalCohorts.status).toBe(200);
        expect((await canonicalCohorts.json() as any).cohorts).toEqual(expect.arrayContaining([expect.objectContaining({ label: "7A" })]));
      }
      const monthly = await app.handle(new Request("http://local/api/reports/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie } }));
      expect(monthly.status).toBe(200);
      const monthlyJson = await monthly.json() as any;
      expect(monthlyJson.executive_summary).toMatchObject({ total_students: 8, attendance_rate: 75, late_rate: 27.8, late_minutes: 85, below_kkm_count: 1, data_completeness_rate: 85.7 });
      expect(monthlyJson.attendance_summary).toMatchObject({ present: 18, sakit: 3, izin: 2, alfa: 1, incomplete: 4, late_days: 5, late_minutes: 85 });
      expect(monthlyJson.student_distribution.by_class).toEqual([{ name: "1A", count: 2, percentage: 25 }, { name: "7A", count: 3, percentage: 37.5 }, { name: "7B", count: 2, percentage: 25 }, { name: "7C", count: 1, percentage: 12.5 }]);
      expect(monthlyJson.academic_summary).toMatchObject({ availability: true, sumatif_average: 80, formatif_average: null, below_kkm_count: 1 });

      const empty = await app.handle(new Request("http://local/api/reports/monthly?academic_year_id=2&month=2026-07&scope=combined", { headers: { cookie } }));
      expect(empty.status).toBe(200);
      expect((await empty.json() as any).attendance_summary).toMatchObject({ present: 0, sakit: 0, izin: 0, alfa: 0, incomplete: 0, attendance_rate: null });

      const management = await app.handle(new Request("http://local/api/reports/management/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie } }));
      expect(management.status).toBe(200);
      expect((await management.json() as any).executive_summary).toMatchObject({ total_students: 8, total_classes: 4, attendance_rate: 75, students_below_kkm: 1 });
      expect((await app.handle(new Request("http://local/api/reports/management/monthly?academic_year_id=2&month=2026-08&scope=combined", { headers: { cookie: staff } }))).status).toBe(403);

      const annual = await app.handle(new Request("http://local/api/reports/annual?academic_year_id=2&scope=combined", { headers: { cookie } }));
      expect(annual.status).toBe(200);
      const annualJson = await annual.json() as any;
      expect(annualJson.trends).toHaveLength(12);
      expect(annualJson.attendance_summary).toMatchObject({ present: 18, sakit: 3, izin: 2, alfa: 1, incomplete: 4, attendance_rate: 75 });

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
  });

  it("uses canonical jenjang levels for dynamically named report scopes", async () => {
    const path = `/tmp/operatoros-round2-report-scope-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-round2-report-scope-audit-${process.pid}` } });
    try {
      database.client.run("UPDATE jenjangs SET name = 'Round2 SD' WHERE name = 'SD'");
      const cookie = await adminCookie(app);
      const response = await app.handle(new Request("http://local/api/reports/monthly?academic_year_id=2&month=2026-08&scope=primary", { headers: { cookie } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.executive_summary.total_students).toBeGreaterThan(0);
      expect(body.data_quality.unmapped_levels).not.toContain("Round2 SD");
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
        "/api/reports/monthly/export?academic_year_id=2&month=2026-08&scope=combined&format=xlsx",
        "/api/reports/monthly/export?academic_year_id=2&month=2026-08&scope=combined&format=pdf",
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
      expect((await save("2026-10", classes([["P1A", 9, 8, 7]]))).status).toBe(200);
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
      const exportResponse = await request(`/api/analytics/v2/rekap-absensi/export-excel?academic_year_id=${academicYearId}&period_type=term&period=1`);
      expect(exportResponse.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exportResponse.arrayBuffer()));
      const exportSheet = workbook.getWorksheet("Rekap Manual")!;
      expect(exportSheet.getRow(14).getCell(4).value).toBe(15);
      expect(exportSheet.getRow(14).getCell(5).value).toBe(7);
      expect(exportSheet.getRow(14).getCell(6).value).toBe(3);

      const afterTerm = await request(`/api/analytics/attendance/term?academic_year_id=${academicYearId}&term_number=1`);
      const afterOverview = await request(`/api/analytics/overview?academic_year_id=${academicYearId}`);
      expect((await afterTerm.json() as any).totals).toEqual((await beforeTerm.json() as any).totals);
      expect((await afterOverview.json() as any).summary).toEqual((await beforeOverview.json() as any).summary);
      expect((database.client.query("SELECT COUNT(*) AS count FROM absence_reasons WHERE class_name LIKE 'P1%' OR class_name = 'P2'").get() as any).count).toBe(0);

      const invalidClass = await save("2026-10", [{ class_id: classIds.P1A!, sakit: 10, izin: 10, alfa: 10 }, { class_id: 999999, sakit: 1, izin: 1, alfa: 1 }]);
      expect(invalidClass.status).toBe(422);
      const decimal = await save("2026-10", [{ class_id: classIds.P1A!, sakit: 1.5, izin: 0, alfa: 0 }]);
      expect(decimal.status).toBe(400);
      const unauthorized = await app.handle(new Request("http://local/api/config/absence-reasons/bulk", { method: "POST", headers: { cookie: staff, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: academicYearId, month: "2026-10", classes: [{ class_id: classIds.P1A, sakit: 1, izin: 1, alfa: 1 }] }) }));
      expect(unauthorized.status).toBe(403);
      const savedValue = await request(query("2026-10"));
      expect((await savedValue.json() as any).classes.find((value: any) => value.class_name === "P1A")).toMatchObject({ sakit: 9, izin: 8, alfa: 7 });
      expect((database.client.query("SELECT actor_id, metadata FROM operations_audit_events WHERE operation = 'SAVE_MANUAL_MONTHLY_ABSENCE_TOTALS' ORDER BY rowid DESC LIMIT 1").get() as any).actor_id).toBe("golden-admin");
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
