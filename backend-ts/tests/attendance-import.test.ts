import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";
import { calculateLateMinutes } from "../src/domains/attendance-rules";
import { parseDuration, parseExcelDate, parseExcelTime } from "../src/import/normalization";
import { readAttendanceWorkbook } from "../src/import/excel-reader";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";
const headers = ["No. ID", "Nama", "Tanggal", "Scan Masuk", "Scan Pulang", "Terlambat", "Lembur", "Pengecualian", "week"];

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys, uuid",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "from argon2 import PasswordHasher",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path); db = sqlite3.connect(path); ph = PasswordHasher()",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "students = [(9001, 'Andi', 'SMP', 'SMP7A'), (9002, 'Beta', 'SMP', 'SMP7A'), (9003, 'Citra', 'SMP', 'SMP7B'), (9101, 'Diana', 'SMA', 'SMA2C')]",
    "for sid, name, jenjang, class_name in students:",
    "    master = str(uuid.uuid4())",
    "    db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')\", (master, name, name.lower()))",
    "    db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, ?, ?)\", (sid, name, jenjang, class_name))",
    "    db.execute(\"INSERT INTO student_device_identities (student_master_id, legacy_student_id, device_identifier, device_source, effective_from, is_active) VALUES (?, ?, ?, 'attendance_device', '2026-01-01', 1)\", (master, sid, str(sid)))",
    "db.executemany('INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [('SMP', '07:15'), ('SMA', '07:00')])",
    "db.executemany('INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, overtime, exception, week, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [(9001, '2026-06-15', '07:00:00', '16:00:00', 0, 'none', 0, None, None, '25', 'on-time'), (9002, '2026-06-16', '08:00:00', '16:00:00', 45, 'calculated', 0, None, None, '25', 'late')])",
    "db.commit(); db.close()",
  ].join("\n");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function workbook(rows: unknown[][], customHeaders = headers): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Attendance Export");
  sheet.addRow(customHeaders);
  for (const values of rows) sheet.addRow(values);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

function authCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-phase6-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-phase6-audit-${process.pid}` } });
  const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  return { path, database, app, cookie: authCookie(login) };
}

function cleanup(value: Awaited<ReturnType<typeof setup>>): void {
  value.database.close();
  rmSync(value.path, { force: true });
}

async function preview(app: ReturnType<typeof createApp>, cookie: string, bytes: Uint8Array, filename = "test.xlsx") {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return app.handle(new Request("http://local/api/uploads/preview", { method: "POST", headers: { cookie }, body: form }));
}

describe("Excel attendance import", () => {
  it("keeps normalization and lateness truth tables explicit", () => {
    expect(parseExcelDate("15/06/2026")).toBe("2026-06-15");
    expect(parseExcelDate("31/02/2026")).toBeNull();
    expect(parseExcelDate(46188)).toBe("2026-06-15");
    expect(parseExcelTime("07:30")).toBe("07:30");
    expect(parseExcelTime(0.3125)).toBe("07:30");
    expect(parseExcelTime("bad")).toBeNull();
    expect(parseDuration("00:25")).toBe(1500);
    expect(parseDuration("0:30:00")).toBe(1800);
    expect(parseDuration(25)).toBeNull();
    expect(calculateLateMinutes("07:40", "00:25", "SMP", { SMP: "07:15" })).toEqual([25, "excel"]);
    expect(calculateLateMinutes("07:40", 25, "SMP", { SMP: "07:15" })).toEqual([25, "calculated"]);
    expect(calculateLateMinutes("07:40", "00:00", "SMP", { SMP: "07:15" })).toEqual([25, "calculated"]);
  });

  it("matches the Phase 0 workbook rows and keeps preview non-mutating", async () => {
    const value = await setup("preview");
    try {
      const bytes = new Uint8Array(await Bun.file(`${repoRoot}/docs/migration/ts-backend/golden/attendance-import/normal-preview.xlsx`).arrayBuffer());
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any)?.count);
      const response = await preview(value.app, value.cookie, bytes, "normal-preview.xlsx");
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.summary).toEqual({ total_rows: 15, logical_rows: 11, new_rows: 6, update_rows: 2, unchanged_rows: 0, conflicts: 3, invalid_rows: 1, new_students: 0 });
      expect(body.rows.map((item: any) => item.classification)).toEqual(["DIFFERENCE", "DIFFERENCE", "NEW", "NEW", "NEW", "NEW", "CONFLICT", "CONFLICT", "CONFLICT", "NEW", "NEW", "INVALID"]);
      expect(body.rows[3].proposed_record).toMatchObject({ late_duration: 25, late_source: "excel" });
      expect(body.rows[9].proposed_record).toMatchObject({ check_in: "00:00:00", late_duration: 0, late_source: "calculated" });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any)?.count)).toBe(before);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance_import_rows").get() as any)?.count)).toBe(12);
    } finally { cleanup(value); }
  }, 30000);

  it("matches missing-header behavior and applies atomically and idempotently", async () => {
    const value = await setup("commit");
    try {
      const missing = await preview(value.app, value.cookie, await workbook([[9001, "Andi", "15/06/2026", "07:00", "16:00", "", "", "25"]], headers.filter((header) => header !== "Terlambat") as string[]), "missing-header.xlsx");
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ detail: "Missing required column: Terlambat" });

      const bytes = await workbook([[9003, "Citra", "01/07/2026", "07:30", "16:00", "", "", "", "Wednesday"]]);
      const response = await preview(value.app, value.cookie, bytes);
      const body = await response.json() as any;
      const rowId = body.rows[0].id as number;
      const committed = await value.app.handle(new Request(`http://local/api/uploads/preview/${body.batch_id}/commit`, { method: "POST", headers: { cookie: value.cookie, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [rowId], confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: body.checksum }) }));
      expect(committed.status).toBe(200);
      const result = await committed.json();
      expect(result).toMatchObject({ rows_inserted: 1, rows_updated: 0, rows_unchanged: 0 });
      const duplicate = await value.app.handle(new Request(`http://local/api/uploads/preview/${body.batch_id}/commit`, { method: "POST", headers: { cookie: value.cookie, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [rowId], confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: body.checksum }) }));
      expect(await duplicate.json()).toEqual(result);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 9003 AND date = '2026-07-01'").get() as any)?.count)).toBe(1);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM upload_logs").get() as any)?.count)).toBe(1);
    } finally { cleanup(value); }
  }, 30000);

  it("exposes unresolved attendance conflicts with retry-safe provenance", async () => {
    const value = await setup("conflicts");
    try {
      const bytes = await workbook([[9999, "Andi", "01/07/2026", "07:30", "16:00", "", "", "", "Wednesday"]]);
      const previewResponse = await preview(value.app, value.cookie, bytes, "conflict.xlsx");
      const previewBody = await previewResponse.json() as any;
      const reference = `attendance:${previewBody.rows[0].id}`;
      const queue = await value.app.handle(new Request("http://local/api/upload-conflicts?workflow_type=ATTENDANCE", { headers: { cookie: value.cookie } }));
      expect(queue.status).toBe(200);
      expect((await queue.json() as any).items[0]).toMatchObject({ resolution_item_id: reference, technical_code: "DEVICE_IDENTITY_UNMATCHED", retry_eligible: false });
      const detail = await value.app.handle(new Request(`http://local/api/upload-conflicts/${reference}`, { headers: { cookie: value.cookie } }));
      expect(detail.status).toBe(200);
      const candidates = await value.app.handle(new Request(`http://local/api/upload-conflicts/${reference}/student-candidates?query=Andi`, { headers: { cookie: value.cookie } }));
      expect(candidates.status).toBe(200);
      expect((await candidates.json() as any).items[0]).toMatchObject({ full_name: "Andi", student_status: "active" });
      const retry = await value.app.handle(new Request("http://local/api/upload-conflicts/retry-preview", { method: "POST", headers: { cookie: value.cookie, "content-type": "application/json" }, body: JSON.stringify({ source_session_id: previewBody.batch_id, source_checksum: previewBody.checksum, resolution_item_ids: [reference], expected_classification: "CONFLICT", retry_mode: "PREVIEW_ONLY" }) }));
      expect(retry.status).toBe(200);
      expect((await retry.json() as any).outcomes[0]).toMatchObject({ resolution_item_id: reference, outcome: "STILL_UNMATCHED", classification: "CONFLICT" });
    } finally { cleanup(value); }
  }, 30000);

  it("rolls back earlier writes when a later selected row is stale", async () => {
    const value = await setup("rollback");
    try {
      const bytes = await workbook([
        [9003, "Citra", "01/07/2026", "07:30", "16:00", "", "", "", "Wednesday"],
        [9101, "Diana", "01/07/2026", "07:30", "16:00", "", "", "", "Wednesday"],
      ]);
      const body = await (await preview(value.app, value.cookie, bytes)).json() as any;
      const rows = body.rows as any[];
      value.database.client.run("INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (9101, '2026-07-01', '07:00:00', '16:00:00', 0, 'none', 0, 'on-time')");
      const response = await value.app.handle(new Request(`http://local/api/uploads/preview/${body.batch_id}/commit`, { method: "POST", headers: { cookie: value.cookie, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: rows.map((item) => item.id), confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: body.checksum }) }));
      expect(response.status).toBe(409);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance WHERE student_id = 9003 AND date = '2026-07-01'").get() as any)?.count)).toBe(0);
      expect((value.database.client.query("SELECT status FROM attendance_import_batches WHERE id = ?").get(body.batch_id) as any)?.status).toBe("preview");
    } finally { cleanup(value); }
  }, 30000);

  it("exposes upload history and sanitized evidence for an attendance preview", async () => {
    const value = await setup("history");
    try {
      const bytes = await workbook([[9003, "Citra", "01/07/2026", "07:30", "16:00", "", "", "", "Wednesday"]]);
      const previewResponse = await preview(value.app, value.cookie, bytes, "history.xlsx");
      const previewBody = await previewResponse.json() as any;
      const commitResponse = await value.app.handle(new Request(`http://local/api/uploads/preview/${previewBody.batch_id}/commit`, { method: "POST", headers: { cookie: value.cookie, "content-type": "application/json" }, body: JSON.stringify({ selected_row_ids: [previewBody.rows[0].id], confirmation: "COMMIT_ATTENDANCE_IMPORT", preview_checksum: previewBody.checksum }) }));
      expect(commitResponse.status).toBe(200);

      const uploadId = `attendance:${previewBody.batch_id}`;
      const history = await value.app.handle(new Request("http://local/api/uploads/history?page=1&page_size=20", { headers: { cookie: value.cookie } }));
      expect(history.status).toBe(200);
      expect((await history.json() as any).items).toHaveLength(1);
      const detail = await value.app.handle(new Request(`http://local/api/uploads/history/${uploadId}`, { headers: { cookie: value.cookie } }));
      expect(await detail.json()).toMatchObject({ upload_id: uploadId, status: "COMMITTED", committed_total: 1, unresolved_total: 0 });
      const timeline = await value.app.handle(new Request(`http://local/api/uploads/history/${uploadId}/timeline`, { headers: { cookie: value.cookie } }));
      expect((await timeline.json() as any).items.map((item: any) => item.event)).toContain("COMMIT_COMPLETED");
      const rowsResponse = await value.app.handle(new Request(`http://local/api/uploads/history/${uploadId}/rows?page=1&page_size=25`, { headers: { cookie: value.cookie } }));
      expect((await rowsResponse.json() as any).items[0]).toMatchObject({ stable_row_reference: expect.stringContaining("attendance:"), commit_outcome: "COMMITTED" });
      const csvResponse = await value.app.handle(new Request(`http://local/api/uploads/history/${uploadId}/export.csv`, { headers: { cookie: value.cookie } }));
      expect(csvResponse.status).toBe(200);
      expect(await csvResponse.text()).toContain("reconciliation");
      const jsonResponse = await value.app.handle(new Request(`http://local/api/uploads/history/${uploadId}/export.json`, { headers: { cookie: value.cookie } }));
      expect((await jsonResponse.json() as any).manifest.included_sections).toEqual(["reconciliation", "timeline", "row_outcomes"]);
    } finally { cleanup(value); }
  }, 30000);

  it("reads date and time cells from ExcelJS without leaking workbook types", async () => {
    const bytes = await workbook([[9001, "Andi", new Date(Date.UTC(2026, 5, 15)), 0.3125, new Date(Date.UTC(1899, 11, 30, 16)), "00:25", 0.0208333333, "", "25"]]);
    const result = await readAttendanceWorkbook(bytes.buffer as ArrayBuffer, "typed.xlsx");
    expect(result.rows[0]).toMatchObject({ date: "2026-06-15", checkIn: "07:30", checkOut: "16:00", overtimeSeconds: null });
  });
});
