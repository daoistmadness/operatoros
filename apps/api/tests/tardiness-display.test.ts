import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";

function bootstrap(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "bootstrap_fresh_sqlite_database(Path(sys.argv[1]))",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function seed(withCutoff: boolean): Promise<{ path: string; cleanup: () => void }> {
  const path = `/tmp/operatoros-tardiness-display-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
  bootstrap(path);
  const seedClient = new Database(path);
  const run = (sql: string, ...params: any[]) => (seedClient as any).run(sql, ...params);
  const get = (sql: string, ...params: any[]) => (seedClient as any).query(sql).get(...params);
  const hash = await Bun.password.hash("display-admin-pass-1", "argon2id");
  run("INSERT INTO users (username, password_hash, role, is_active) VALUES (?,?,?,1)", ["display-admin", hash, "admin"]);
  run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('2026/2027-display','2026-07-01','2027-06-30','active',1)");
  const yearId = Number(get("SELECT id FROM academic_years WHERE label='2026/2027-display'").id);
  run("INSERT INTO jenjangs (name) VALUES ('Primary')");
  const jenjangId = Number(get("SELECT id FROM jenjangs WHERE name='Primary'").id);
  if (withCutoff) run("INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES ('Primary','07:30',CURRENT_TIMESTAMP)");
  run("INSERT INTO academic_programs (jenjang_id, name) VALUES (?, 'Primary')", [jenjangId]);
  const programId = Number(get("SELECT id FROM academic_programs WHERE name='Primary'").id);
  run("INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number) VALUES (?,?, 'P1', 1)", [jenjangId, programId]);
  const gradeId = Number(get("SELECT id FROM academic_grades WHERE name='P1'").id);
  run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code) VALUES (?,?, 'P1A', 'A')", [yearId, gradeId]);
  run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code) VALUES (?,?, 'P1B', 'B')", [yearId, gradeId]);
  const p1a = Number(get("SELECT id FROM academic_classes WHERE class_name='P1A'").id);
  const p1b = Number(get("SELECT id FROM academic_classes WHERE class_name='P1B'").id);
  run("INSERT INTO students (name, jenjang, class_name) VALUES ('Display A','Primary','P1A')");
  run("INSERT INTO students (name, jenjang, class_name) VALUES ('Display B','Primary','P1A')");
  run("INSERT INTO students (name, jenjang, class_name) VALUES ('Display C','Primary','P1B')");
  const a = Number(get("SELECT id FROM students WHERE name='Display A'").id);
  const b = Number(get("SELECT id FROM students WHERE name='Display B'").id);
  const c = Number(get("SELECT id FROM students WHERE name='Display C'").id);
  for (const [sid, cid, cname] of [[a, p1a, "P1A"], [b, p1a, "P1A"], [c, p1b, "P1B"]] as const)
    run("INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, lifecycle_state, effective_from) VALUES (?,?,?,?,?,1,'ACTIVE','2026-08-01')", [sid, yearId, jenjangId, cid, cname]);
  for (let w = 0; w < 7; w++)
    run("INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation) VALUES (?,?,?,?)", [yearId, jenjangId, w, w === 0 || w === 6 ? "NOT_EXPECTED" : "EXPECTED"]);
  run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, '2026-08-03', '07:31', '16:00', 60, 'calculated', 0, 'late')", [a]);
  run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, '2026-08-03', '07:45', '16:00', 900, 'calculated', 0, 'late')", [b]);
  run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, '2026-08-04', '08:30', '16:00', 3600, 'calculated', 0, 'late')", [c]);
  seedClient.close();
  return { path, cleanup: () => { try { rmSync(path, { force: true }); } catch { /* disposable */ } } };
}

async function fetchReport(path: string): Promise<any> {
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-tardiness-display-audit-${process.pid}` } });
  try {
    const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "display-admin", password: "display-admin-pass-1" }) }));
    const cookieValue = login.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
    if (!cookieValue) throw new Error("login failed");
    const response = await app.handle(new Request("http://local/api/analytics/tardiness-report?month=8&year=2026", { headers: { cookie: `astyx_session=${cookieValue}` } }));
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    database.close();
  }
}

describe("tardiness report total late minutes display", () => {
  it("accumulates canonical class and overall minutes with duration provenance", async () => {
    const { path, cleanup } = await seed(true);
    try {
      const json = await fetchReport(path);
      const p1a = (json.breakdown_by_class as any[]).find((row) => row.class_name === "P1A");
      const p1b = (json.breakdown_by_class as any[]).find((row) => row.class_name === "P1B");
      expect(p1a).toMatchObject({ late_events: 2, total_late_minutes: 16, total_late_minutes_str: "00:16", known_duration_events: 2, unknown_duration_events: 0 });
      expect(p1b).toMatchObject({ late_events: 1, total_late_minutes: 60, total_late_minutes_str: "01:00", known_duration_events: 1, unknown_duration_events: 0 });
      expect(json.totals).toMatchObject({ late_events: 3, total_late_minutes: 76, total_late_minutes_str: "01:16", known_duration_events: 3, unknown_duration_events: 0 });
      expect(json.management_summary).toMatchObject({ late_events: 3, total_late_minutes: 76, known_duration_events: 3, unknown_duration_events: 0 });
      const classSum = (json.breakdown_by_class as any[]).reduce((sum, row) => sum + row.total_late_minutes, 0);
      expect(classSum).toBe(json.totals.total_late_minutes);
    } finally {
      cleanup();
    }
  }, 120000);

  it("exposes unknown durations instead of a false zero", async () => {
    const { path, cleanup } = await seed(false);
    try {
      const json = await fetchReport(path);
      expect(json.totals).toMatchObject({ late_events: 3, total_late_minutes: 0, known_duration_events: 0, unknown_duration_events: 3 });
      for (const row of json.breakdown_by_class as any[]) {
        expect(row.total_late_minutes).toBe(0);
        expect(row.unknown_duration_events).toBe(row.late_events);
      }
    } finally {
      cleanup();
    }
  }, 120000);
});
