import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { calendarWeekday, resolveAttendanceExpectation } from "../src/domains/attendance-calendar";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-attendance-calendar-test-secret-32";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('calendar-admin', ph.hash('calendar-admin-pass-1'), 'admin'), ('calendar-staff', ph.hash('calendar-staff-pass-1'), 'staff')])",
    "year_id = db.execute(\"INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-calendar','2026-07-01','2027-06-30','active',1)\").lastrowid",
    "jenjang_id = db.execute(\"INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','SMP','junior',1)\").lastrowid",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id,name,active) VALUES (?, 'MAIN', 1)\", (jenjang_id,)).lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (?, ?, 'Grade 7', 1, 1)\", (jenjang_id,program_id)).lastrowid",
    "class_id = db.execute(\"INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (?, ?, '7A','A',1)\", (year_id,grade_id)).lastrowid",
    "master = str(uuid.uuid4()); db.execute(\"INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?, 'Calendar Student', 'calendar student', 'active')\", (master,)); db.execute(\"INSERT INTO students (id,name,jenjang,class_name) VALUES (1001,'Calendar Student','SMP','7A')\")",
    "db.execute(\"INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (?,?,?,?,?,?,1,'2026-07-01','ACTIVE')\", (1001,master,year_id,jenjang_id,class_id,'7A'))",
    "db.execute(\"INSERT INTO attendance (student_id,date,check_in,late_duration,late_source,is_absent,status) VALUES (1001,'2026-08-03','07:30:00',0,'test',0,'on-time')\")",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-calendar-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-calendar-audit-${process.pid}` } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "calendar-admin", password: "calendar-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "calendar-staff", password: "calendar-staff-pass-1" }) }));
  return { app, database, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("attendance calendar authority", () => {
  it("resolves date exceptions before weekday rules and fails closed when unconfigured", () => {
    expect(calendarWeekday("2026-08-03")).toBe(1);
    expect(resolveAttendanceExpectation("2026-08-03", "2026-07-01", "2027-06-30", null, null)).toEqual({ status: "UNKNOWN", reason: null, source: "NONE" });
    expect(resolveAttendanceExpectation("2026-08-03", "2026-07-01", "2027-06-30", null, { expectation: "EXPECTED" })).toEqual({ status: "EXPECTED", reason: null, source: "WEEKDAY_RULE" });
    expect(resolveAttendanceExpectation("2026-08-03", "2026-07-01", "2027-06-30", { expectation: "NOT_EXPECTED", reason: "HOLIDAY" }, { expectation: "EXPECTED" })).toEqual({ status: "NOT_EXPECTED", reason: "HOLIDAY", source: "DATE_EXCEPTION" });
    expect(resolveAttendanceExpectation("2026-06-30", "2026-07-01", "2027-06-30", null, { expectation: "EXPECTED" }).status).toBe("UNKNOWN");
  });

  it("keeps calendar administration server-authorized and exposes configured scope", async () => {
    const value = await setup("admin");
    try {
      expect((await value.app.handle(new Request("http://local/api/attendance/calendar?academic_year_id=1"))).status).toBe(401);
      expect((await value.app.handle(new Request("http://local/api/attendance/calendar?academic_year_id=1", { headers: { cookie: value.staff } }))).status).toBe(200);
      const staffWrite = await value.app.handle(new Request("http://local/api/attendance/calendar/weekday", { method: "PUT", headers: { cookie: value.staff, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: 1, jenjang_id: 1, weekday: 1, expectation: "EXPECTED" }) }));
      expect(staffWrite.status).toBe(403);
      const initial = await value.app.handle(new Request("http://local/api/attendance/calendar?academic_year_id=1", { headers: { cookie: value.admin } }));
      expect(initial.status).toBe(200);
      expect((await initial.json() as any).jenjangs[0].weekdays).toHaveLength(7);

      const weekday = await value.app.handle(new Request("http://local/api/attendance/calendar/weekday", { method: "PUT", headers: { cookie: value.admin, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: 1, jenjang_id: 1, weekday: 1, expectation: "EXPECTED" }) }));
      expect(weekday.status).toBe(200);
      const exception = await value.app.handle(new Request("http://local/api/attendance/calendar/exception", { method: "PUT", headers: { cookie: value.admin, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: 1, jenjang_id: 1, date: "2026-08-03", expectation: "NOT_EXPECTED", reason: "HOLIDAY" }) }));
      expect(exception.status).toBe(200);
      const configured = await value.app.handle(new Request("http://local/api/attendance/calendar?academic_year_id=1", { headers: { cookie: value.admin } }));
      const body = await configured.json() as any;
      expect(body.jenjangs[0].weekdays[1]).toMatchObject({ weekday: 1, expectation: "EXPECTED" });
      expect(body.jenjangs[0].exceptions).toMatchObject([{ date: "2026-08-03", expectation: "NOT_EXPECTED", reason: "HOLIDAY" }]);
    } finally { value.cleanup(); }
  }, 30000);

  it("integrates expectation without changing recording coverage semantics", async () => {
    const value = await setup("daily");
    try {
      await value.app.handle(new Request("http://local/api/attendance/calendar/weekday", { method: "PUT", headers: { cookie: value.admin, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: 1, jenjang_id: 1, weekday: 1, expectation: "EXPECTED" }) }));
      await value.app.handle(new Request("http://local/api/attendance/calendar/exception", { method: "PUT", headers: { cookie: value.admin, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: 1, jenjang_id: 1, date: "2026-08-03", expectation: "NOT_EXPECTED", reason: "HOLIDAY" }) }));
      const daily = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03", { headers: { cookie: value.admin } }));
      const body = await daily.json() as any;
      expect(daily.status).toBe(200);
      expect(body.classes[0].attendanceExpectation).toEqual({ status: "NOT_EXPECTED", reason: "HOLIDAY", source: "DATE_EXCEPTION" });
      expect(body.classes[0]).toMatchObject({ coverageState: "COMPLETE", recordedStudentCount: 1, counts: { alfa: 0 } });
      expect(body.totals).toMatchObject({ expectedClasses: 0, notExpectedClasses: 1, unknownClasses: 0 });
      expect(JSON.stringify(body)).not.toMatch(/overdue|risk|alert|intervention/i);
    } finally { value.cleanup(); }
  }, 30000);
});
