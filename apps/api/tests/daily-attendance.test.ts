import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createAttendanceViewFixture } from "./fixtures/attendance-views";

const secret = "astryx-daily-attendance-test-secret-32";

function seed(path: string): void {
  createAttendanceViewFixture(path, "daily");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-daily-attendance-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-daily-attendance-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return { app, database, admin: cookie(admin), staff: cookie(staff), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("daily attendance operations", () => {
  it("reports complete, none, empty, and effective status counts", async () => {
    const value = await setup("coverage");
    try {
      const response = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03", { headers: { cookie: value.admin } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.totals).toMatchObject({ classes: 3, expectedStudents: 3, recordedStudents: 2, unrecordedStudents: 1, completeClasses: 1, noRecordClasses: 1, emptyClasses: 1 });
      expect(body.scope).toMatchObject({ date: "2026-08-03", schoolDayAuthority: "AVAILABLE" });
      expect(body.totals).toMatchObject({ expectedClasses: 0, notExpectedClasses: 0, unknownClasses: 3 });
      expect(body.classes[0].attendanceExpectation).toEqual({ status: "UNKNOWN", reason: null, source: "NONE" });
      expect(body.classes[0]).toMatchObject({ className: "7A", coverageState: "COMPLETE", expectedStudentCount: 2, recordedStudentCount: 2, unrecordedStudentCount: 0, coveragePercent: 100, counts: { present: 2, late: 0 } });
      expect(body.classes[1]).toMatchObject({ className: "7B", coverageState: "NONE", expectedStudentCount: 1, recordedStudentCount: 0, unrecordedStudentCount: 1, counts: { alfa: 0 } });
      expect(body.classes[2]).toMatchObject({ className: "7C", coverageState: "EMPTY_CLASS", expectedStudentCount: 0, recordedStudentCount: 0, unrecordedStudentCount: 0, coveragePercent: null });
      expect(JSON.stringify(body)).not.toMatch(/overdue|risk|alert|intervention/i);
    } finally { value.cleanup(); }
  }, 30000);

  it("reports partial coverage and keeps unrecorded students out of Alfa", async () => {
    const value = await setup("partial");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count);
      const response = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-04&academic_year_id=1&jenjang_id=1&class_id=1", { headers: { cookie: value.admin } }));
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.totals).toMatchObject({ classes: 1, expectedStudents: 2, recordedStudents: 1, unrecordedStudents: 1, partialClasses: 1 });
      expect(body.classes[0]).toMatchObject({ coverageState: "PARTIAL", counts: { late: 1, alfa: 0 } });
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as any).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);

  it("applies server authorization before class filters", async () => {
    const value = await setup("auth");
    try {
      expect((await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03"))).status).toBe(401);
      const staff = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03", { headers: { cookie: value.staff } }));
      expect(staff.status).toBe(200);
      expect((await staff.json() as any).classes.map((item: any) => item.className)).toEqual(["7A"]);
      const forbidden = await value.app.handle(new Request("http://local/api/attendance/daily-status?date=2026-08-03&class_id=2", { headers: { cookie: value.staff } }));
      expect(forbidden.status).toBe(200);
      expect((await forbidden.json() as any).classes).toEqual([]);
    } finally { value.cleanup(); }
  }, 30000);
});
