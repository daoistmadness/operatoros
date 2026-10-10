import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createAttendanceViewFixture } from "./fixtures/attendance-views";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createAttendanceViewFixture(path, "assigned-export");
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
      expect(recap.getRow(2).getCell(6).value).toBe(0); // verified daily Sakit
      expect(recap.getRow(2).getCell(9).value).toBe(1); // separate reported ledger Sakit
      expect(recap.getRow(2).getCell(12).value).toBe(20); // HEB override
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
