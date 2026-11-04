import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function setup(label: string, clock?: Date) {
  const tempDir = mkdtempSync(join(tmpdir(), `operatoros-class-overview-${label}-${process.pid}-`));
  const path = join(tempDir, "operatoros.sqlite");
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, clock: clock ? () => clock : undefined, auth: { authCookieSecret: secret, auditDir: join(tempDir, "audit") } });
  const adminResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staffResponse = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  const year = database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as { id: number };
  const classValue = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id LIMIT 1").get(year.id) as { id: number };
  const otherClass = database.client.query("SELECT id FROM academic_classes WHERE academic_year_id = ? ORDER BY id DESC LIMIT 1").get(year.id) as { id: number };
  return { app, database, yearId: year.id, classId: classValue.id, otherClassId: otherClass.id, admin: cookie(adminResponse), staff: cookie(staffResponse), cleanup: () => { database.close(); rmSync(tempDir, { recursive: true, force: true }); } };
}

describe("class overview", () => {
  it("checks teacher assignment effectiveness against the Jakarta school date", async () => {
    const value = await setup("jakarta-midnight", new Date("2099-12-31T17:00:00.000Z"));
    try {
      value.database.client.run("UPDATE teacher_class_assignments SET effective_from = '2100-01-01', effective_to = NULL WHERE user_id = (SELECT id FROM users WHERE username = 'golden-staff') AND academic_class_id = ?", [value.classId]);
      const response = await value.app.handle(new Request(`http://local/api/classes/${value.classId}/overview`, { headers: { cookie: value.staff } }));
      expect(response.status).toBe(200);
    } finally { value.cleanup(); }
  }, 30000);

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
