import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";
import { calculateHeb, roundHalfEven, roundHalfUp } from "../src/domains/reports";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
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
    "master = str(uuid.uuid4()); db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", (master, 'Hana SMP7C', 'hana smp7c')); db.execute(\"INSERT INTO students (name, jenjang, class_name) VALUES ('Hana SMP7C', 'SMP', '7C')\"); hana_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, class_name, class_assigned, lifecycle_state) VALUES (?, ?, ?, ?, '7C', 1, 'ACTIVE')\", (hana_id, master, year_id, smp_id))",
    "db.execute(\"INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Matematika', ?, 1, 1)\", (smp_id,)); subject_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]; db.execute(\"INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('UH1', 'sumatif', ?), ('UH2', 'sumatif', ?)\", (subject_id, subject_id)); components = [row[0] for row in db.execute(\"SELECT id FROM assessment_components WHERE subject_id = ? ORDER BY id\", (subject_id,)).fetchall()]; enrollments = [row for row in db.execute(\"SELECT e.id, s.name FROM student_enrollments e JOIN students s ON s.id = e.student_id WHERE e.academic_year_id = ? AND e.jenjang_id = ? ORDER BY e.id\", (year_id, smp_id)).fetchall()]; db.execute(\"INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, score) VALUES (?, ?, ?, 80), (?, ?, ?, 90), (?, ?, ?, 70)\", (enrollments[0][0], subject_id, components[0], enrollments[0][0], subject_id, components[1], enrollments[1][0], subject_id, components[0])); db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
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
        const attendanceReport = await app.handle(new Request(`http://local${alias}/attendance-report?start_date=2026-08-01&end_date=2026-08-05`, { headers: { cookie } }));
        expect(attendanceReport.status).toBe(200);
        expect(await attendanceReport.json()).toMatchObject({
          summary: { avg_late_time_str: "17m", heb_days: 16 },
          results: expect.arrayContaining([
            expect.objectContaining({ name: "Alice SMP7A", present_count: 3, late_count: 1, absent_count: 0, incomplete_count: 0, sakit: 2, izin: 1, alfa: 0, total_late_time_str: "15m", total_days: 4, attendance_percentage: 100 }),
            expect.objectContaining({ name: "Dina SMP7B", present_count: 1, late_count: 0, absent_count: 0, incomplete_count: 1, total_days: 2, attendance_percentage: 100 }),
          ]),
        });
        const interventionImpact = await app.handle(new Request(`http://local${alias}/intervention-impact?academic_year_id=2`, { headers: { cookie } }));
        expect(interventionImpact.status).toBe(200);
        expect(await interventionImpact.json()).toMatchObject({
          filters: { academic_year_id: 2 },
          summary: { total_interventions: 0, open_interventions: 0, resolved_interventions: 0, average_score_delta: null },
          impact_rows: [],
          executive_insights: [expect.objectContaining({ title: "No intervention impact records found" })],
        });
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
      expect((await tardiness.json() as any).totals).toMatchObject({ total_late_duration_minutes: 85, total_days_late: 5, unique_late_days: 2, tracked_school_days: 4, school_impact_rate_pct: 50, average_lateness_density: 2.5 });

      const rekap = await app.handle(new Request("http://local/api/analytics/v2/rekap-absensi?month=8&year=2026", { headers: { cookie } }));
      expect(rekap.status).toBe(200);
      expect((await rekap.json() as any).global_summary).toMatchObject({ hadir: 131, sakit: 3, izin: 2, alfa: 2, lain2: 0, total: 138, percentages: { hadir_pct: 94.93, sakit_pct: 2.17, izin_pct: 1.45, alfa_pct: 1.45, total_pct: 100 } });
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
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
          expect(workbook.worksheets.length).toBeGreaterThan(0);
        }
      }
      expect((database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count).toBe(before.count);
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
});
