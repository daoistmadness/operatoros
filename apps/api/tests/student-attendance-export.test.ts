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
    "import sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db()",
    "core_database.engine.dispose()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "master = str(uuid.uuid4()); empty_master = str(uuid.uuid4())",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'E2E Export Student', 'e2e export student', 'active')\", (master,))",
    "db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'E2E Empty Student', 'e2e empty student', 'active')\", (empty_master,))",
    "db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (9101, 'E2E Export Student', 'SMP', '7A')\")",
    "db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (9102, 'E2E Empty Student', 'SMP', '7B')\")",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active) VALUES (?, 9102, 'EXP-DEV-2', 'TEST', '2026-07-01', 1)\", (empty_master,))",
    "db.execute(\"INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active) VALUES (?, 9101, 'EXP-DEV-1', 'TEST', '2026-07-01', 1)\", (master,))",
    "db.executemany('INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [(9101, '2026-08-03', '07:10:00', '16:00:00', 0, 'test', 0, 'on-time'), (9101, '2026-08-04', '07:40:00', '16:00:00', 25, 'test', 0, 'late'), (9101, '2026-08-05', None, None, 0, 'test', 1, 'absent')])",
    "override_id = db.execute(\"SELECT id FROM attendance WHERE student_id = 9101 AND date = '2026-08-04'\").fetchone()[0]",
    "db.execute(\"INSERT INTO attendance_overrides (attendance_id, original_status, override_status, note, reviewed_by, reviewed_at) VALUES (?, 'late', 'on-time', 'Device missed scan', 'golden-admin', '2026-08-04T10:00:00Z')\", (override_id,))",
    "db.execute(\"INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, entered_by, entered_at, updated_at) VALUES (9101, '7A', 8, 2026, 1, 2, 0, 'golden-admin', '2026-08-29T09:00:00', '2026-08-29T09:00:00')\")",
    "db.execute(\"INSERT INTO heb_overrides (jenjang, month, year, heb_value, set_by, set_at) VALUES ('SMP', 8, 2026, 20, 'golden-admin', '2026-08-29T09:00:00')\")",
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
  const path = `/tmp/operatoros-student-export-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-student-export-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin) },
    staff: { cookie: cookie(staff) },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

function exportUrl(masterId: string, query = ""): string {
  return `http://local/api/student-masters/${masterId}/attendance-history/export-excel${query}`;
}

async function masterId(value: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const students = await value.app.handle(new Request("http://local/api/student-masters?search=E2E%20Export%20Student", { headers: { cookie: value.admin.cookie } }));
  const body = await students.json() as { items?: { id: string }[] };
  return body.items?.[0]?.id ?? "";
}

describe("student attendance history export", () => {
  it("exports a workbook with override-corrected recap and daily detail", async () => {
    const value = await setup("positive");
    try {
      const id = await masterId(value);
      expect(id).not.toBe("");
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      const response = await value.app.handle(new Request(exportUrl(id, "?month=8&year=2026"), { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("spreadsheetml");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b); // PK zip magic
      const workbook = await loadXlsxWorkbook(bytes);
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toContain("Rekap Bulanan");
      expect(names).toContain("Rincian Harian");
      const recap = workbook.getWorksheet("Rekap Bulanan")!;
      expect(recap.getRow(2).getCell(2).value).toBe(2); // both rows effectively on-time (late corrected)
      expect(recap.getRow(2).getCell(3).value).toBe(0); // no late rows after override
      expect(recap.getRow(2).getCell(6).value).toBe(1); // sakit from absence_reasons
      const detail = workbook.getWorksheet("Rincian Harian")!;
      const lateRow = [2, 3, 4].map((r) => detail.getRow(r).getCell(7).value).filter(Boolean).length;
      expect(lateRow).toBe(1); // exactly one override note
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("exports only the monthly recap without a month filter", async () => {
    const value = await setup("no-month");
    try {
      const id = await masterId(value);
      const response = await value.app.handle(new Request(exportUrl(id), { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await response.arrayBuffer()));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Rekap Bulanan"]);
      const recap = workbook.getWorksheet("Rekap Bulanan")!;
      expect(recap.rowCount).toBe(2); // header + one month
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("rejects anonymous, insufficient-role, invalid-period, and unknown students", async () => {
    const value = await setup("negative");
    try {
      const id = await masterId(value);
      const anon = await value.app.handle(new Request(exportUrl(id, "?month=8&year=2026")));
      expect(anon.status).toBe(401);
      const staff = await value.app.handle(new Request(exportUrl(id, "?month=8&year=2026"), { headers: { cookie: value.staff.cookie } }));
      expect(staff.status).toBe(403);
      const badMonth = await value.app.handle(new Request(exportUrl(id, "?month=13&year=2026"), { headers: { cookie: value.admin.cookie } }));
      expect(badMonth.status).toBe(400);
      const monthOnly = await value.app.handle(new Request(exportUrl(id, "?month=8"), { headers: { cookie: value.admin.cookie } }));
      expect(monthOnly.status).toBe(400);
      const unknown = await value.app.handle(new Request(exportUrl("00000000-0000-4000-8000-999999999999"), { headers: { cookie: value.admin.cookie } }));
      expect(unknown.status).toBe(404);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("produces an empty workbook for a student without attendance", async () => {
    const value = await setup("empty");
    try {
      const empty = await value.app.handle(new Request("http://local/api/student-masters?search=E2E%20Empty%20Student", { headers: { cookie: value.admin.cookie } }));
      const body = await empty.json() as { items?: { id: string }[] };
      const id = body.items?.[0]?.id ?? "";
      const response = await value.app.handle(new Request(exportUrl(id), { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      const workbook = await loadXlsxWorkbook(new Uint8Array(await response.arrayBuffer()));
      const recap = workbook.getWorksheet("Rekap Bulanan")!;
      expect(recap.rowCount).toBe(1); // header only
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("audits the export", async () => {
    const value = await setup("audit");
    try {
      const id = await masterId(value);
      await value.app.handle(new Request(exportUrl(id), { headers: { cookie: value.admin.cookie } }));
      const events = value.database.client.query("SELECT operation, success FROM operations_audit_events WHERE operation = 'EXPORT_STUDENT_ATTENDANCE_HISTORY'").all() as { operation: string; success: number }[];
      expect(events.length).toBe(1);
      expect(events[0]?.success).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);
});
