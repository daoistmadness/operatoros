import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
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
    "year_id = db.execute('SELECT id FROM academic_years WHERE is_default = 1').fetchone()[0]",
    "jenjang_id = db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMP', 'SMP', 'junior', 1)\").lastrowid",
    "program_id = db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, 'MAIN', 1)\", (jenjang_id,)).lastrowid",
    "grade_id = db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (?, ?, 'Grade 7', 1, 1)\", (jenjang_id, program_id)).lastrowid",
    "class_id = db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7A', 'A', 1)\", (year_id, grade_id)).lastrowid",
    "db.executemany('INSERT INTO students (id, name, jenjang, class_name) VALUES (?, ?, ?, ?)', [(9401, 'Complete Student', 'SMP', '7A'), (9402, 'Partial Student', 'SMP', '7A'), (9403, 'No Class Student', 'SMP', None)])",
    "student_defs = [(9401, 'Complete Student', 'L', 'Islam', '2013-05-01'), (9402, 'Partial Student', None, None, None), (9403, 'No Class Student', 'P', 'Kristen', '2013-03-03')]",
    "master_rows = [(str(uuid.uuid4()), name, name.lower(), g, r, b) for (sid, name, g, r, b) in student_defs]",
    "db.executemany(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status, gender, religion, birth_date) VALUES (?, ?, ?, 'active', ?, ?, ?)\", master_rows)",
    "db.executemany(\"INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, ?, '7A', 1, '2026-07-01', 'ACTIVE')\", [(legacy_id, m, year_id, jenjang_id, None if legacy_id == 9403 else class_id) for ((legacy_id, name, g, r, b), (m, n2, n3, g2, r2, b2)) in zip(student_defs, master_rows)])",
"db.execute(\"INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES ('no-enrollment-master', 'Orphan Active Student', 'orphan active student', 'active')\")",
    "db.executemany(\"INSERT INTO staff_members (id, full_name, normalized_name, employment_status, job_title_raw) VALUES (?, ?, ?, ?, ?)\", [('staff-001', 'Complete Staff', 'complete staff', 'ACTIVE', 'Guru'), ('staff-002', 'Unmapped Staff', 'unmapped staff', 'ACTIVE', 'Koordinator Ekstrakurikuler'), ('staff-003', 'Unknown Status', 'unknown status', 'UNKNOWN', 'Guru'), ('staff-004', 'Former Staff', 'former staff', 'FORMER', 'Guru')])",
    "db.execute(\"INSERT INTO staff_education (staff_member_id, education_level, institution_name) VALUES ('staff-001', 'S1', 'Universitas A')\")",
    "db.execute(\"INSERT INTO staff_jenjang_assignments (staff_member_id, jenjang_id) VALUES ('staff-001', ?)\", (jenjang_id,))",
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
  const path = `/tmp/operatoros-quality-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-quality-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin) },
    staff: { cookie: cookie(staff) },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("data quality analytics", () => {
  it("computes student field completeness with distinct missing semantics", async () => {
    const value = await setup("students");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.admin.cookie } }));
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
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.admin.cookie } }));
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
      const all = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?page=1&page_size=2", { headers: { cookie: value.admin.cookie } }));
      const allBody = await all.json() as any;
      expect(allBody.total).toBeGreaterThanOrEqual(3);
      expect(allBody.items.length).toBe(2);
      expect(allBody.page).toBe(1);
      const page2 = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?page=2&page_size=2", { headers: { cookie: value.admin.cookie } }));
      expect((await page2.json() as any).items.length).toBeGreaterThanOrEqual(1);
      const byField = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?field=birth_date", { headers: { cookie: value.admin.cookie } }));
      const byFieldBody = await byField.json() as any;
      for (const item of byFieldBody.items) {
        expect(item.issues.every((issue: any) => issue.field === "birth_date")).toBe(true);
      }
      const byType = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/issues?type=MISSING_CLASS_ASSIGNMENT", { headers: { cookie: value.admin.cookie } }));
      const byTypeBody = await byType.json() as any;
      expect(byTypeBody.total).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("computes staff quality with unmapped job titles and duplicate protection", async () => {
    const value = await setup("staff");
    try {
      const response = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff", { headers: { cookie: value.admin.cookie } }));
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
      const unmapped = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?type=UNMAPPED_JOB_TITLE", { headers: { cookie: value.admin.cookie } }));
      const unmappedBody = await unmapped.json() as any;
      expect(unmappedBody.total).toBe(2); // unmapped raw title (staff-002) and normalized-null raw title (staff-003)
      expect(unmappedBody.items.map((item: any) => item.entityName).sort()).toEqual(["Complete Staff", "Unmapped Staff"]);
      const missing = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?type=MISSING_STAFF_EDUCATION", { headers: { cookie: value.admin.cookie } }));
      const missingBody = await missing.json() as any;
      expect(missingBody.total).toBe(1); // ACTIVE scope only
      const unknownStatus = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff?employment_status=UNKNOWN", { headers: { cookie: value.admin.cookie } }));
      const unknownBody = await unknownStatus.json() as any;
      expect(unknownBody.totalStaff).toBe(1);
      expect(unknownBody.fieldCompleteness.find((field: any) => field.field === "job_title").unknown).toBe(0);
      const issues = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/issues?employment_status=UNKNOWN", { headers: { cookie: value.admin.cookie } }));
      const issuesBody = await issues.json() as any;
      expect(issuesBody.items.some((item: any) => item.issues.some((issue: any) => issue.type === "UNKNOWN_CATEGORY_VALUE"))).toBe(true);
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
      const staffStudent = await value.app.handle(new Request("http://local/api/analytics/data-quality/students", { headers: { cookie: value.staff.cookie } }));
      expect(staffStudent.status).toBe(200);
      const staffStaff = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff", { headers: { cookie: value.staff.cookie } }));
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
      const studentExport = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/export-excel", { headers: { cookie: value.admin.cookie } }));
      expect(studentExport.status).toBe(200);
      const bytes = new Uint8Array(await studentExport.arrayBuffer());
      expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
      const workbook = await loadXlsxWorkbook(bytes);
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toContain("Summary");
      expect(names).toContain("Field Completeness");
      expect(names).toContain("Class Breakdown");
      expect(names).toContain("Issues");
      const staffExport = await value.app.handle(new Request("http://local/api/analytics/data-quality/staff/export-excel", { headers: { cookie: value.admin.cookie } }));
      expect(staffExport.status).toBe(200);
      const staffWorkbook = await loadXlsxWorkbook(new Uint8Array(await staffExport.arrayBuffer()));
      expect(staffWorkbook.worksheets.map((sheet) => sheet.name)).toContain("Issues");
      const denied = await value.app.handle(new Request("http://local/api/analytics/data-quality/students/export-excel", { headers: { cookie: value.staff.cookie } }));
      expect(denied.status).toBe(403);
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM student_masters").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);
});

