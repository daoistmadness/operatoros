import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createOverviewFixture } from "./fixtures/overview";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createOverviewFixture(path, "class");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-class-overview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-overview-audit-${process.pid}` } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  const classValue = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id LIMIT 1").get(year.id) as { id: number };
  const otherClass = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id DESC LIMIT 1").get(year.id) as { id: number };
  return { app, database, yearId: year.id, classId: classValue.id, otherClassId: otherClass.id, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("class overview", () => {
  it("composes canonical class, roster, attendance, academic, and quality data", async () => {
    const value = await setup("canonical");
    try {
      const query = "?attendance_date_from=2026-08-01&attendance_date_to=2026-08-31";
      const headers = { cookie: value.admin };
      const response = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview${query}`, { headers }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.class).toMatchObject({ id: value.classId, name: "7A", jenjang: "SMP", academicYearId: value.yearId });
      expect(body.roster.total).toBe(1);
      expect(body.roster.rows[0]).toMatchObject({ studentName: "Academic Master 1111", enrollmentStatus: "ACTIVE", dataQualityIssueCount: 3 });
      expect(body.roster.rows[0].student360Link).toBe("/students/11111111-1111-1111-1111-111111111111?academic_year_id=2&class_id=1");
      expect(body.attendance).toMatchObject({ totalRecords: 2, attendanceRate: 100, overriddenRecords: 1 });
      expect(body.academic).toMatchObject({ average: 88, students: 1, periodStatus: "mixed" });
      expect(body.dataQuality).toMatchObject({ totalStudents: 1, recordsWithRequiredIssues: 0 });
      expect(JSON.stringify(body)).not.toMatch(/risk|alert|intervention|classification/i);
    } finally { value.cleanup(); }
  }, 30000);

  it("enforces assignment scope and preserves term context", async () => {
    const value = await setup("authorization");
    try {
      const staffResponse = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview?term=term_1`, { headers: { cookie: value.staff } }));
      expect(staffResponse.status).toBe(200);
      expect((await staffResponse.json() as any).academic).toMatchObject({ term: 1, periodStatus: "known" });
      const forbidden = await value.app.handle(new Request(`http://local/api/classes/${value.otherClassId}/overview`, { headers: { cookie: value.staff } }));
      expect(forbidden.status).toBe(403);
      expect((await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview`))).status).toBe(401);
    } finally { value.cleanup(); }
  }, 30000);

  it("rejects invalid dates without mutating business data", async () => {
    const value = await setup("readonly");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview?attendance_date_from=2026-09-01&attendance_date_to=2026-08-01`, { headers: { cookie: value.admin } }));
      expect(response.status).toBe(400);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
