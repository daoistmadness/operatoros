import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db()",
    "core_database.engine.dispose()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-teacher', ph.hash('golden-teacher-pass-1'), 'staff')])",
    "teacher_id = db.execute('SELECT id FROM users WHERE username = ?', ('golden-teacher',)).fetchone()[0]",
    "db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMP', 'SMP', 'junior', 1)\")",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (1, 'MAIN', 1)\").lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (1, 1, 'Grade 7', 1, 1)\").lastrowid",
    "class_id = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (1, 1, '7A', 'A', 1)\").lastrowid",
    "other_class_id = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (1, 1, '7B', 'B', 1)\").lastrowid",
    "db.execute(\"INSERT INTO teacher_class_assignments (user_id, academic_year_id, academic_class_id, class_role, active, assigned_by) VALUES (?, 1, ?, 'ATTENDANCE_TEACHER', 1, 'golden-admin')\", (teacher_id, class_id))",
    "db.executemany('INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, ?, ?)', [(9201, 'Class Student A', 'SMP', '7A'), (9202, 'Class Student B', 'SMP', '7A'), (9301, 'Other Class Student', 'SMP', '7B')])",
    "db.executemany(\"INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, 1, 1, ?, ?, 1, '2026-07-01', 'ACTIVE')\", [(9201, class_id, '7A'), (9202, class_id, '7A'), (9301, other_class_id, '7B')])",
    "db.executemany('INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [(9201, '2026-08-03', '07:10:00', '16:00:00', 0, 'test', 0, 'on-time'), (9201, '2026-08-04', '07:40:00', '16:00:00', 25, 'test', 0, 'late'), (9202, '2026-08-03', None, None, 0, 'test', 1, 'absent'), (9301, '2026-08-03', '07:05:00', '16:00:00', 0, 'test', 0, 'on-time')])",
    "override_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 9201 AND date = '2026-08-04'\").fetchone()[0]",
    "db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'on-time', 'Device missed scan', 'golden-admin', '2026-08-04T10:00:00Z')\", (override_id,))",
    "class_jenjang = db.execute(\"SELECT j.name FROM academic_classes c JOIN academic_grades g ON g.id = c.grade_id JOIN jenjangs j ON j.id = g.jenjang_id WHERE c.id = ?\", (class_id,)).fetchone()[0]",
    "db.execute(\"INSERT INTO heb_overrides (jenjang, month, year, heb_value, set_by, set_at) VALUES (?, 8, 2026, 20, 'golden-admin', '2026-08-01T00:00:00Z')\", (class_jenjang,))",
    "db.execute(\"INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, entered_by, entered_at, updated_at) VALUES (9201, '7A', 8, 2026, 1, 2, 0, 'golden-admin', '2026-08-29T09:00:00', '2026-08-29T09:00:00')\")",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-class-export-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-export-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-teacher", password: "golden-teacher-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin) },
    staff: { cookie: cookie(staff) },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

const exportUrl = (classId: number | string, query = "?month=8&year=2026") =>
  `http://local/api/attendance/classes/${classId}/attendance/export-excel${query}`;

describe("assigned class attendance export", () => {
  it("exports an override-corrected workbook scoped to the class", async () => {
    const value = await setup("admin");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      const response = await value.app.handle(new Request(exportUrl(1), { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("spreadsheetml");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
      const workbook = await loadXlsxWorkbook(bytes);
      expect(workbook.getWorksheet("Rekap Siswa")).toBeTruthy();
      expect(workbook.getWorksheet("Rincian Harian")).toBeTruthy();
      const recap = workbook.getWorksheet("Rekap Siswa")!;
      expect(recap.rowCount).toBe(3); // two enrolled students, other class excluded
      expect(recap.getRow(2).getCell(1).value).toBe("Class Student A");
      expect(recap.getRow(2).getCell(2).value).toBe(2); // late corrected to on-time
      expect(recap.getRow(2).getCell(3).value).toBe(0);
      expect(recap.getRow(2).getCell(6).value).toBe(1); // sakit
      expect(recap.getRow(2).getCell(9).value).toBe(20); // HEB override
      const detail = workbook.getWorksheet("Rincian Harian")!;
      const notes = [2, 3, 4].map((row) => detail.getRow(row).getCell(8).value).filter(Boolean);
      expect(notes).toEqual(["Device missed scan"]);
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("allows assigned staff and rejects unassigned staff", async () => {
    const value = await setup("staff");
    try {
      const assigned = await value.app.handle(new Request(exportUrl(1), { headers: { cookie: value.staff.cookie } }));
      expect(assigned.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await assigned.arrayBuffer()));
      const recap = workbook.getWorksheet("Rekap Siswa")!;
      expect(recap.rowCount).toBe(3);
      const unassigned = await value.app.handle(new Request(exportUrl(2), { headers: { cookie: value.staff.cookie } }));
      expect(unassigned.status).toBe(403);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("rejects anonymous users, invalid periods, and unknown classes", async () => {
    const value = await setup("negative");
    try {
      const anon = await value.app.handle(new Request(exportUrl(1)));
      expect(anon.status).toBe(401);
      const badMonth = await value.app.handle(new Request(exportUrl(1, "?month=13&year=2026"), { headers: { cookie: value.admin.cookie } }));
      expect(badMonth.status).toBe(400);
      const badYear = await value.app.handle(new Request(exportUrl(1, "?month=8&year=2019"), { headers: { cookie: value.admin.cookie } }));
      expect(badYear.status).toBe(400);
      const unknown = await value.app.handle(new Request(exportUrl(999), { headers: { cookie: value.admin.cookie } }));
      expect(unknown.status).toBe(404);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("writes an audit event per export", async () => {
    const value = await setup("audit");
    try {
      await value.app.handle(new Request(exportUrl(1), { headers: { cookie: value.staff.cookie } }));
      const events = value.database.client.query("SELECT capability, success FROM operations_audit_events WHERE operation = 'EXPORT_ASSIGNED_CLASS_ATTENDANCE'").all() as { capability: string; success: number }[];
      expect(events.length).toBe(1);
      expect(events[0]?.capability).toBe("export_assigned_class_attendance");
      expect(events[0]?.success).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);
});
