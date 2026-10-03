import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createAttendanceReadFixture } from "./fixtures/attendance-reads";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createAttendanceReadFixture(path, "corrections");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-attendance-correction-review-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-correction-review-audit-${process.pid}` } });
  const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app, admin: cookie(adminLogin), staff: cookie(staffLogin),
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("attendance correction review", () => {
  it("projects only canonical current overrides with original/effective parity and links", async () => {
    const value = await setup("projection");
    try {
      const response = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31", { headers: { cookie: value.admin } }));
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body.summary).toEqual({ corrections: 2 });
      expect(body.items.map((item: any) => [item.studentName, item.baseStatus, item.effectiveStatus])).toEqual([["Beta Student", "absent", "sakit"], ["Alpha Student", "late", "on-time"]]);
      expect(body.items[0].correction).toMatchObject({ note: "Medical note received", reviewedBy: "golden-admin", active: true });
      expect(body.items[0].links.student360).toMatch(/^\/students\//);
      expect(body.items[0].links.class360).toBe("/classes/2?attendance_date_from=2026-08-05&attendance_date_to=2026-08-05");
      expect(body.items[0].links.dailyAttendance).toContain("/attendance/daily");
      expect(body.items[0].canEdit).toBe(true);
      expect(body.items[0].links.editCorrection).toContain("/attendance-review");
    } finally { value.cleanup(); }
  }, 30000);

  it("applies filters, stable pagination, and assignment scope before counting", async () => {
    const value = await setup("scope");
    try {
      const staff = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&page=1&page_size=1", { headers: { cookie: value.staff } }));
      const staffBody = await staff.json() as any;
      expect(staff.status).toBe(200);
      expect(staffBody.total).toBe(1);
      expect(staffBody.summary.corrections).toBe(1);
      expect(staffBody.items[0]).toMatchObject({ studentName: "Alpha Student", canEdit: false, links: { editCorrection: null } });
      const filtered = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&effective_status=sakit", { headers: { cookie: value.admin } }));
      expect((await filtered.json() as any).total).toBe(1);
      const search = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31&student_search=alpha", { headers: { cookie: value.admin } }));
      expect((await search.json() as any).items[0].studentName).toBe("Alpha Student");
    } finally { value.cleanup(); }
  }, 30000);

  it("denies anonymous access and leaves business rows unchanged on GET", async () => {
    const value = await setup("auth");
    try {
      const anonymous = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1"));
      expect(anonymous.status).toBe(401);
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count);
      const response = await value.app.handle(new Request("http://local/api/attendance/override-review?academic_year_id=1", { headers: { cookie: value.admin } }));
      const after = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count);
      expect(response.status).toBe(200);
      expect(after).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
