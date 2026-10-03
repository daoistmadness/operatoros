import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createOverviewFixture } from "./fixtures/overview";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createOverviewFixture(path, "management");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-management-overview-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-management-overview-audit-${process.pid}` } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  return { app, database, yearId: year.id, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); } };
}

describe("management analytics overview", () => {
  it("matches the canonical analytics authorities", async () => {
    const value = await setup("canonical");
    try {
      const query = `?academic_year_id=${value.yearId}&attendance_date_from=2026-08-01&attendance_date_to=2026-08-31`;
      const headers = { cookie: value.admin };
      const overview = await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`, { headers }));
      expect(overview.status).toBe(200);
      const body = await overview.json() as any;
      const recap = await value.app.handle(new Request(`http://local/api/analytics/recapitulation/students?academic_year_id=${value.yearId}&dimension=jenjang&status=ACTIVE`, { headers }));
      const attendance = await value.app.handle(new Request(`http://local/api/analytics/attendance/overview?academic_year_id=${value.yearId}&date_from=2026-08-01&date_to=2026-08-31`, { headers }));
      const academic = await value.app.handle(new Request(`http://local/api/analytics/academic/overview?academic_year_id=${value.yearId}`, { headers }));
      const quality = await value.app.handle(new Request(`http://local/api/analytics/data-quality/students?academic_year_id=${value.yearId}&status=ACTIVE`, { headers }));
      expect(body.school.students.activeStudents).toBe((await recap.json() as any).total);
      expect(body.attendance).toMatchObject({ attendanceRate: (await attendance.clone().json() as any).attendanceRate, present: 2, late: 0, overriddenRecords: 1 });
      expect(body.academic).toMatchObject({ average: (await academic.json() as any).summary.score.average, students: 1 });
      const qualityBody = await quality.json() as any;
      expect(body.dataQuality.students).toMatchObject({ total: qualityBody.totalStudents, issueCount: qualityBody.recordsWithRequiredIssues });
      expect(body.scope).toMatchObject({ academicYearId: value.yearId, attendanceDateFrom: "2026-08-01", attendanceDateTo: "2026-08-31" });
    } finally { value.cleanup(); }
  }, 30000);

  it("enforces authentication and returns unavailable staff data", async () => {
    const value = await setup("authorization");
    try {
      const query = `?academic_year_id=${value.yearId}`;
      expect((await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`))).status).toBe(401);
      const response = await value.app.handle(new Request(`http://local/api/analytics/management-overview${query}`, { headers: { cookie: value.staff } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.school.staff).toEqual({ status: "unavailable", reason: "unauthorized" });
      expect(body.dataQuality.staff).toEqual({ status: "unavailable", reason: "unauthorized" });
      expect(body.school.students.status).toBe("available");
      expect(body.attendance.status).toBe("available");
    } finally { value.cleanup(); }
  }, 30000);

  it("rejects invalid scope without touching business data", async () => {
    const value = await setup("validation");
    try {
      const before = Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count);
      const response = await value.app.handle(new Request("http://local/api/analytics/management-overview?academic_year_id=999999", { headers: { cookie: value.admin } }));
      expect(response.status).toBe(400);
      expect(Number((value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number }).count)).toBe(before);
    } finally { value.cleanup(); }
  }, 30000);
});
