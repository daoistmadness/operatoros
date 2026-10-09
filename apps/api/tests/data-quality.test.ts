import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createDemographicsFixture } from "./fixtures/demographics";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createDemographicsFixture(path, "quality");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-quality-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-quality-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin), origin: "http://localhost:5173" },
    staff: { cookie: cookie(staff), origin: "http://localhost:5173" },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("data quality analytics", () => {
  it("computes student field completeness with distinct missing semantics", async () => {
    const value = await setup("students");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.totalStudents).toBe(3);
      const gender = body.fieldCompleteness.find((field: any) => field.field === "gender");
      expect(gender.applicable).toBe(3);
      expect(gender.complete).toBe(2);
      expect(gender.missing).toBe(1);
      expect(gender.completenessPercentage).toBeCloseTo(66.67, 1);
      const classField = body.fieldCompleteness.find((field: any) => field.field === "class_assignment");
      expect(classField.applicability).toBe("CONDITIONALLY_REQUIRED");
      expect(classField.applicable).toBe(3);
      expect(classField.missing).toBe(1);
      expect(body.classBreakdown.length).toBe(2); // 7A + Unknown for the classless student
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("summarizes required vs optional issues and missing enrollment", async () => {
    const value = await setup("overview");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const body = await response.json() as any;
      expect(body.recordsWithRequiredIssues).toBe(1); // no-class student
      expect(body.recordsWithOptionalIssues).toBeGreaterThan(0);
      expect(body.missingEnrollmentCount).toBe(1); // active master seeded without enrollment
      const classless = body.classBreakdown.find((entry: any) => entry.class === "Unknown");
      expect(classless.withRequiredIssues).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("drills down into student issues with field/type filters and pagination", async () => {
    const value = await setup("issues");
    try {
      const all = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?page=1&page_size=2", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const allBody = await all.json() as any;
      expect(allBody.total).toBeGreaterThanOrEqual(3);
      expect(allBody.items.length).toBe(2);
      expect(allBody.page).toBe(1);
      const page2 = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?page=2&page_size=2", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect((await page2.json() as any).items.length).toBeGreaterThanOrEqual(1);
      const byField = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?field=birth_date", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const byFieldBody = await byField.json() as any;
      for (const item of byFieldBody.items) {
        expect(item.issues.every((issue: any) => issue.field === "birth_date")).toBe(true);
      }
      const byType = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?type=MISSING_CLASS_ASSIGNMENT", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const byTypeBody = await byType.json() as any;
      expect(byTypeBody.total).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("computes staff quality with unmapped job titles and duplicate protection", async () => {
    const value = await setup("staff");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const body = await response.json() as any;
      expect(body.totalStaff).toBe(2); // only ACTIVE staff in default scope (UNKNOWN status is a separate scope)
      const jobTitle = body.fieldCompleteness.find((field: any) => field.field === "job_title");
      expect(jobTitle.unmapped).toBe(2); // 'Guru' is raw-only too: no normalization mapping exists in the fixture
      expect(jobTitle.missing).toBe(0);
      const education = body.fieldCompleteness.find((field: any) => field.field === "education");
      expect(education.missing).toBe(1); // only staff-002 lacks education in ACTIVE scope
      const jenjang = body.fieldCompleteness.find((field: any) => field.field === "jenjang_assignment");
      expect(jenjang.missing).toBe(1); // only staff-002 lacks jenjang assignment in ACTIVE scope
      expect(body.cleanRecords).toBe(0); // staff-001 has an unmapped raw job title (no normalization mapping exists in this fixture)
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("drills down into staff issues with unmapped distinction", async () => {
    const value = await setup("staff-issues");
    try {
      const unmapped = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?type=UNMAPPED_JOB_TITLE", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const unmappedBody = await unmapped.json() as any;
      expect(unmappedBody.total).toBe(2); // unmapped raw title (staff-002) and normalized-null raw title (staff-003)
      expect(unmappedBody.items.map((item: any) => item.entityName).sort()).toEqual(["Complete Staff", "Unmapped Staff"]);
      const missing = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?type=MISSING_STAFF_EDUCATION", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const missingBody = await missing.json() as any;
      expect(missingBody.total).toBe(1); // ACTIVE scope only
      const unknownStatus = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff?employment_status=UNKNOWN", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const unknownBody = await unknownStatus.json() as any;
      expect(unknownBody.totalStaff).toBe(1);
      expect(unknownBody.fieldCompleteness.find((field: any) => field.field === "job_title").unknown).toBe(0);
      const issues = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?employment_status=UNKNOWN", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const issuesBody = await issues.json() as any;
      expect(issuesBody.items.some((item: any) => item.issues.some((issue: any) => issue.type === "UNKNOWN_CATEGORY_VALUE"))).toBe(true);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("projects derived findings to controlled correction authorities", async () => {
    const value = await setup("resolution");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution?page_size=100", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.summary.totalIssues).toBe(body.total);
      const profile = body.items.find((item: any) => item.entityLabel === "Partial Student" && item.field === "gender");
      expect(profile).toMatchObject({ entityType: "STUDENT", qualityState: "MISSING", resolutionClass: "EDITABLE_IN_OPERATOROS", resolutionTarget: { type: "STUDENT_PROFILE", capability: "edit_student" } });
      const enrollment = body.items.find((item: any) => item.entityLabel === "No Class Student" && item.field === "class_assignment");
      expect(enrollment.resolutionTarget).toMatchObject({ type: "STUDENT_ENROLLMENT", capability: "manage_enrollment" });
      const external = body.items.find((item: any) => item.entityLabel === "Unmapped Staff" && item.field === "job_title");
      expect(external).toMatchObject({ entityType: "STAFF", qualityState: "UNMAPPED", resolutionClass: "EXTERNAL_SOURCE_REQUIRED", resolutionTarget: null });
      const filtered = await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution?quality_state=UNMAPPED&entity_type=STAFF&page_size=100", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const filteredBody = await filtered.json() as any;
      expect(filteredBody.items.every((item: any) => item.entityType === "STAFF" && item.qualityState === "UNMAPPED")).toBe(true);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("applies view and write authorization without leaking another entity scope", async () => {
    const value = await setup("resolution-auth");
    try {
      const anonymous = await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution"));
      expect(anonymous.status).toBe(401);
      const staffView = await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution?page_size=100", { headers: { cookie: value.staff.cookie, origin: "http://localhost:5173" } }));
      expect(staffView.status).toBe(200);
      const staffBody = await staffView.json() as any;
      expect(staffBody.items.every((item: any) => item.entityType === "STUDENT")).toBe(true);
      expect(staffBody.items.filter((item: any) => item.resolutionClass === "EDITABLE_IN_OPERATOROS").every((item: any) => item.resolutionTarget === null)).toBe(true);
      const deniedStaffScope = await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution?entity_type=STAFF", { headers: { cookie: value.staff.cookie, origin: "http://localhost:5173" } }));
      expect(deniedStaffScope.status).toBe(403);
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      await value.app.handle(new Request("http://local/api/analytics/data-quality/resolution", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("recomputes findings after the canonical student editor changes source data", async () => {
    const value = await setup("resolution-disappearance");
    try {
      const student = value.database.client.query("SELECT id, full_name FROM student_masters WHERE full_name = 'Partial Student'").get() as { id: string; full_name: string };
      const before = await value.app.handle(new Request(`http://local/api/analytics/data-quality/resolution?search=Partial%20Student&field=gender&page_size=100`, { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect((await before.json() as any).items).toHaveLength(1);
      const update = await value.app.handle(new Request(`http://local/api/student-masters/${student.id}/profile`, { method: "PATCH", headers: { cookie: value.admin.cookie, "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ identity: { full_name: student.full_name, gender: "L" } }) }));
      expect(update.status).toBe(200);
      const after = await value.app.handle(new Request(`http://local/api/analytics/data-quality/resolution?search=Partial%20Student&field=gender&page_size=100`, { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect((await after.json() as any).items).toHaveLength(0);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("enforces server-side authorization and read-only behavior", async () => {
    const value = await setup("auth");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      const anon = await value.app.handle(new Request("http://local/api/analytics/data-quality/students"));
      expect(anon.status).toBe(401);
      const staffStudent = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.staff.cookie, origin: "http://localhost:5173" } }));
      expect(staffStudent.status).toBe(200);
      const staffStaff = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff", { headers: { cookie: value.staff.cookie, origin: "http://localhost:5173" } }));
      expect(staffStaff.status).toBe(403);
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("exports student and staff quality workbooks in filtered scope", async () => {
    const value = await setup("export");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      const studentExport = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/export-excel", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect(studentExport.status).toBe(200);
      const bytes = new Uint8Array(await studentExport.arrayBuffer());
      expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
      const workbook = await loadXlsxWorkbook(bytes);
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toContain("Summary");
      expect(names).toContain("Field Completeness");
      expect(names).toContain("Class Breakdown");
      expect(names).toContain("Issues");
      const staffExport = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/export-excel", { headers: { cookie: value.admin.cookie, origin: "http://localhost:5173" } }));
      expect(staffExport.status).toBe(200);
      const staffWorkbook = await loadXlsxWorkbook(new Uint8Array(await staffExport.arrayBuffer()));
      expect(staffWorkbook.worksheets.map((sheet) => sheet.name)).toContain("Issues");
      const denied = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/export-excel", { headers: { cookie: value.staff.cookie, origin: "http://localhost:5173" } }));
      expect(denied.status).toBe(403);
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);
});
