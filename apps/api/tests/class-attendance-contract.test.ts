import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ClassAttendanceEntriesResponseSchema, ClassAttendanceResponseSchema } from "@operatoros/contracts/attendance";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const localPython = `${repoRoot}/backend/.venv/bin/python`;
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(localPython) ? localPython : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "astryx-class-attendance-contract-secret";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from argon2 import PasswordHasher; db = sqlite3.connect(path); ph = PasswordHasher()",
    "db.executemany(\"INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)\", [('contract-admin', ph.hash('contract-admin-pass-1'), 'admin'), ('contract-staff', ph.hash('contract-staff-pass-1'), 'staff')])",
    "db.execute(\"INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Synthetic 2026/2027', '2026-07-01', '2027-06-30', 'active', 1)\")",
    "db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('Synthetic SMP', 'SYN-SMP', 'junior', 1)\")",
    "db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (1, 'Synthetic Program', 1)\")",
    "db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (1, 1, 'Synthetic Grade', 1, 1)\")",
    "db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (1, 1, 'Synthetic 7A', 'SYN-A', 1)\")",
    "db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (9001, 'Synthetic Attendance Student', 'Synthetic SMP', 'Synthetic 7A')\")",
    "db.execute(\"INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (9001, 1, 1, 1, 'Synthetic 7A', 1, '2026-07-01', 'ACTIVE')\")",
    "db.execute(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (9001, '2026-08-03', '07:40:00', '16:00:00', 25, 'calculated', 0, 'late')\")",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("class attendance response contract", () => {
  it("validates the actual route payload and preserves the public field shape", async () => {
    const path = `/tmp/operatoros-class-attendance-contract-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-attendance-contract-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-admin", password: "contract-admin-pass-1" }) }));
      const response = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-03", { headers: { cookie: sessionCookie(login) } }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, any>;
      expect(Value.Check(ClassAttendanceResponseSchema, body)).toBe(true);
      expect(body.items[0]).toMatchObject({ student_name: "Synthetic Attendance Student", effective_status: "late", scan_in: "07:40", scan_out: "16:00" });
      expect(body.items[0]).not.toHaveProperty("full_name");

      const submit = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-04/entries", { method: "POST", headers: { cookie: sessionCookie(login), "content-type": "application/json" }, body: JSON.stringify({ entries: [{ student_id: 9001, status: "on-time" }] }) }));
      expect(submit.status).toBe(200);
      const submitBody = await submit.json() as Record<string, unknown>;
      expect(Value.Check(ClassAttendanceEntriesResponseSchema, submitBody)).toBe(true);
      expect(submitBody).toMatchObject({ class_id: 1, date: "2026-08-04", total_submitted: 1, created: 1, updated: 0, submitted_by: "contract-admin" });
      expect(submitBody).not.toHaveProperty("success");

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-staff", password: "contract-staff-pass-1" }) }));
      const unassigned = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-03", { headers: { cookie: sessionCookie(staffLogin) } }));
      expect(unassigned.status).toBe(403);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  }, 30000);

  it("rejects missing, renamed, and mistyped required fields", () => {
    const item = {
      student_id: 1,
      student_name: "Synthetic Student",
      attendance_id: null,
      raw_status: "unrecorded",
      effective_status: "unrecorded",
      is_overridden: false,
      scan_in: null,
      scan_out: null,
      is_absent: false,
      pending_correction: false,
      correction_request_id: null,
    };
    const response = { class_id: 1, class_name: "Synthetic 7A", date: "2026-08-03", is_finalized: false, total_enrolled: 1, items: [item] };
    expect(Value.Check(ClassAttendanceResponseSchema, response)).toBe(true);

    const missing = { ...response, items: [{ ...item, student_name: undefined }] };
    const renamed = { ...response, items: [{ ...item, student_name: undefined, full_name: "Synthetic Student" }] };
    const mistyped = { ...response, items: [{ ...item, student_id: "1" }] };
    expect(Value.Check(ClassAttendanceResponseSchema, missing)).toBe(false);
    expect(Value.Check(ClassAttendanceResponseSchema, renamed)).toBe(false);
    expect(Value.Check(ClassAttendanceResponseSchema, mistyped)).toBe(false);
  });
});
