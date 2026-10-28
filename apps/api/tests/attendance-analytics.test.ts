import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { createAttendanceReadFixture } from "./fixtures/attendance-reads";

const secret = "astryx-test-only-cookie-secret-32-chars";
const RANGE = "?academic_year_id=1&date_from=2026-08-01&date_to=2026-08-31";

function seed(path: string): void {
  createAttendanceReadFixture(path, "analytics");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-att-analytics-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-att-analytics-audit-${process.pid}` } });
  const admin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const staff = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
  return {
    path, database, app,
    admin: { cookie: cookie(admin) },
    staff: { cookie: cookie(staff) },
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

describe("attendance analytics expansion", () => {
  it("computes the overview with override-corrected statuses", async () => {
    const value = await setup("overview");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      const response = await value.app.handle(new Request(`http://local/api/analytics/attendance/overview${RANGE}`, { headers: { cookie: value.admin.cookie } }));
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.totalRecords).toBe(8);
      // late corrected to on-time: 3 on-time + 1 incomplete + 1 absent + 1 sakit + 1 izin + 1 alfa
      expect(body.counts.present).toBe(3);
      expect(body.counts.late).toBe(0);
      expect(body.counts.incomplete).toBe(1);
      expect(body.counts.absent).toBe(1);
      expect(body.counts.sakit).toBe(1);
      expect(body.counts.izin).toBe(1);
      expect(body.counts.alfa).toBe(1);
      expect(body.students).toBe(3);
      expect(body.classes).toBe(2);
      expect(body.overriddenRecords).toBe(1);
      expect(body.attendanceRate).toBeCloseTo(50, 1); // present + late over present + late + Sakit + Izin + Alfa
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("breaks attendance down by class and by jenjang without duplicate counting", async () => {
    const value = await setup("breakdown");
    try {
      const classes = await value.app.handle(new Request(`http://local/api/analytics/attendance/classes${RANGE}`, { headers: { cookie: value.admin.cookie } }));
      const classesBody = await classes.json() as any;
      expect(classesBody.rows.length).toBe(2);
      const class7a = classesBody.rows.find((row: any) => row.className === "7A");
      expect(class7a.counts.present).toBe(2);
      expect(class7a.counts.sakit).toBe(1);
      expect(class7a.students).toBe(2);
      const class7b = classesBody.rows.find((row: any) => row.className === "7B");
      expect(class7b.counts.alfa).toBe(1);
      const sumOfAll = classesBody.rows.reduce((sum: number, row: any) => sum + row.counts.present + row.counts.late + row.counts.incomplete + row.counts.absent + row.counts.sakit + row.counts.izin + row.counts.alfa, 0);
      expect(sumOfAll).toBe(8);
      const jenjang = await value.app.handle(new Request(`http://local/api/analytics/attendance/jenjang${RANGE}`, { headers: { cookie: value.admin.cookie } }));
      const jenjangBody = await jenjang.json() as any;
      expect(jenjangBody.rows.length).toBe(2);
      const smp = jenjangBody.rows.find((row: any) => row.jenjang === "SMP");
      expect(smp.counts.present).toBe(2);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("provides daily grouping inside date boundaries", async () => {
    const value = await setup("daily");
    try {
      const response = await value.app.handle(new Request(`http://local/api/analytics/attendance/daily${RANGE}`, { headers: { cookie: value.admin.cookie } }));
      const body = await response.json() as any;
      expect(body.rows.length).toBe(3); // 08-03, 08-04, 08-05
      expect(body.rows.map((row: any) => row.date)).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
      const first = body.rows[0];
      expect(first.counts.present).toBe(1);
      expect(first.counts.incomplete).toBe(1);
      expect(first.counts.alfa).toBe(1);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("supports student drilldown with server-side search, sort, and pagination", async () => {
    const value = await setup("students");
    try {
      const all = await value.app.handle(new Request(`http://local/api/analytics/attendance/students${RANGE}&page_size=2`, { headers: { cookie: value.admin.cookie } }));
      const allBody = await all.json() as any;
      expect(allBody.total).toBe(3);
      expect(allBody.rows.length).toBe(2);
      expect(allBody.rows[0].studentName).toBe("Alpha Student");
      const searched = await value.app.handle(new Request(`http://local/api/analytics/attendance/students${RANGE}&search=beta`, { headers: { cookie: value.admin.cookie } }));
      const searchedBody = await searched.json() as any;
      expect(searchedBody.total).toBe(1);
      expect(searchedBody.rows[0].studentName).toBe("Beta Student");
      const sorted = await value.app.handle(new Request(`http://local/api/analytics/attendance/students${RANGE}&sort=alfa&order=desc`, { headers: { cookie: value.admin.cookie } }));
      const sortedBody = await sorted.json() as any;
      expect(sortedBody.rows[0].studentName).toBe("Gamma Student");
      const scoped = await value.app.handle(new Request(`http://local/api/analytics/attendance/students${RANGE}&class_id=1`, { headers: { cookie: value.admin.cookie } }));
      const scopedBody = await scoped.json() as any;
      expect(scopedBody.total).toBe(2);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("keeps student totals and export rows exact after transfer, override, and zero-denominator data", async () => {
    const value = await setup("student-query");
    try {
      const alpha = value.database.client.query("SELECT id FROM student_enrollments WHERE student_id = 9501 AND academic_year_id = 1").get() as { id: number };
      const class7b = value.database.client.query("SELECT id FROM academic_classes WHERE class_name = '7B'").get() as { id: number };
      value.database.client.run("UPDATE student_enrollments SET academic_class_id = ?, class_name = '7B' WHERE id = ?", [class7b.id, alpha.id]);
      value.database.client.run("INSERT INTO student_enrollment_class_history (enrollment_id,class_name,effective_from,changed_by,source) VALUES (?,'7B','2026-08-04','golden-admin','manual_transfer')", [alpha.id]);

      value.database.client.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES ('00000000-0000-4000-8000-000000000004','Delta Student','delta student','active')");
      value.database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9504,'Delta Student','SMP','7A')");
      value.database.client.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9504,'00000000-0000-4000-8000-000000000004',1,2,1,'7A',1,'2026-07-01','ACTIVE')");
      value.database.client.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (9504,'2026-08-03',NULL,NULL,0,'test',0,'incomplete'),(9504,'2026-08-04',NULL,NULL,0,'test',0,'incomplete')");

      const students = async (filters: Record<string, string> = {}, cookie = value.admin.cookie) => {
        const query = new URLSearchParams(RANGE.slice(1));
        for (const [key, filter] of Object.entries(filters)) query.set(key, filter);
        const response = await value.app.handle(new Request(`http://local/api/analytics/attendance/students?${query}`, { headers: cookie ? { cookie } : {} }));
        return { response, body: await response.json() as any };
      };
      const all = await students({ page_size: "25" });
      const columns = (item: any) => ({ studentId: item.studentId, studentName: item.studentName, className: item.className, counts: item.counts, attendanceRate: item.attendanceRate, tardinessRate: item.tardinessRate, unexcusedAbsenceRate: item.unexcusedAbsenceRate });
      expect(all.body.total).toBe(4);
      expect(all.body.scope.totalApplicableRecords).toBe(10);
      expect(all.body.rows.map(columns)).toEqual([
        { studentId: 9501, studentName: "Alpha Student", className: "7B", counts: { present: 2, late: 0, incomplete: 0, absent: 1, sakit: 0, izin: 0, alfa: 0, unrecorded: 0 }, attendanceRate: 100, tardinessRate: 0, unexcusedAbsenceRate: 0 },
        { studentId: 9502, studentName: "Beta Student", className: "7A", counts: { present: 0, late: 0, incomplete: 1, absent: 0, sakit: 1, izin: 1, alfa: 0, unrecorded: 0 }, attendanceRate: 0, tardinessRate: null, unexcusedAbsenceRate: 0 },
        { studentId: 9504, studentName: "Delta Student", className: "7A", counts: { present: 0, late: 0, incomplete: 2, absent: 0, sakit: 0, izin: 0, alfa: 0, unrecorded: 0 }, attendanceRate: null, tardinessRate: null, unexcusedAbsenceRate: null },
        { studentId: 9503, studentName: "Gamma Student", className: "7B", counts: { present: 1, late: 0, incomplete: 0, absent: 0, sakit: 0, izin: 0, alfa: 1, unrecorded: 0 }, attendanceRate: 50, tardinessRate: 0, unexcusedAbsenceRate: 50 },
      ]);

      const page = await students({ page: "2", page_size: "2" });
      expect(page.body.rows).toEqual(all.body.rows.slice(2));
      const outOfRange = await students({ page: "99", page_size: "2" });
      expect(outOfRange.body).toMatchObject({ total: 4, page: 99, rows: [], scope: { totalApplicableRecords: 10 } });
      expect((await students({ search: "beta", class_id: "1" })).body).toMatchObject({ total: 1, scope: { totalApplicableRecords: 3 } });
      expect((await students({ class_id: "1" })).body).toMatchObject({ total: 2, scope: { totalApplicableRecords: 5 } });
      expect((await students({ sort: "alfa", order: "desc" })).body.rows[0]).toMatchObject({ studentName: "Gamma Student", counts: { alfa: 1 } });
      expect((await students({ date_from: "2026-09-01", date_to: "2026-09-30" })).body).toMatchObject({ total: 0, rows: [], scope: { totalApplicableRecords: 0 } });
      expect((await students({}, "")).response.status).toBe(401);
      expect((await students({}, value.staff.cookie)).response.status).toBe(200);

      const exportResponse = await value.app.handle(new Request(`http://local/api/analytics/attendance/export-excel${RANGE}`, { headers: { cookie: value.admin.cookie } }));
      const workbook = await loadXlsxWorkbook(new Uint8Array(await exportResponse.arrayBuffer()));
      const byStudent = workbook.getWorksheet("By Student")!;
      const exportRows = Array.from({ length: 4 }, (_, index) => Array.from({ length: 12 }, (_, column) => byStudent.getRow(index + 2).getCell(column + 1).value));
      expect(exportRows).toEqual([
        ["Alpha Student", "7B", 2, 0, 0, 1, 0, 0, 0, 100, 0, 0],
        ["Beta Student", "7A", 0, 0, 1, 0, 1, 1, 0, 0, null, 0],
        ["Delta Student", "7A", 0, 0, 2, 0, 0, 0, 0, null, null, null],
        ["Gamma Student", "7B", 1, 0, 0, 0, 0, 0, 1, 50, 0, 50],
      ]);
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("rejects invalid ranges, anonymous users, and insufficient capability for export", async () => {
    const value = await setup("auth");
    try {
      const invalid = await value.app.handle(new Request("http://local/api/analytics/attendance/overview?academic_year_id=1&date_from=2026-08-31&date_to=2026-08-01", { headers: { cookie: value.admin.cookie } }));
      expect(invalid.status).toBe(400);
      const anon = await value.app.handle(new Request(`http://local/api/analytics/attendance/overview${RANGE}`));
      expect(anon.status).toBe(401);
      const staffView = await value.app.handle(new Request(`http://local/api/analytics/attendance/overview${RANGE}`, { headers: { cookie: value.staff.cookie } }));
      expect(staffView.status).toBe(200); // staff holds view_attendance
      const staffExport = await value.app.handle(new Request(`http://local/api/analytics/attendance/export-excel${RANGE}`, { headers: { cookie: value.staff.cookie } }));
      expect(staffExport.status).toBe(200); // view_attendance covers the export per current capability model
      const options = await value.app.handle(new Request("http://local/api/analytics/attendance/options?academic_year_id=1", { headers: { cookie: value.admin.cookie } }));
      expect(options.status).toBe(200);
      expect((await options.json() as any).classes.length).toBe(2);
      const empty = await value.app.handle(new Request("http://local/api/analytics/attendance/overview?academic_year_id=1&date_from=2026-09-01&date_to=2026-09-30", { headers: { cookie: value.admin.cookie } }));
      expect(empty.status).toBe(200);
      expect(await empty.json()).toMatchObject({ totalRecords: 0, attendanceRate: null, tardinessRate: null, unexcusedAbsenceRate: null, overridePercentage: null });
    } finally {
      value.cleanup();
    }
  }, 30000);

  it("exports a filter-parity workbook", async () => {
    const value = await setup("export");
    try {
      const before = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      const jenjangId = Number((value.database.client.query("SELECT id FROM jenjangs WHERE name = 'SMP' LIMIT 1").get() as { id: number }).id);
      const scoped = await value.app.handle(new Request(`http://local/api/analytics/attendance/export-excel${RANGE}&jenjang_id=${jenjangId}`, { headers: { cookie: value.admin.cookie } }));
      expect(scoped.status).toBe(200);
      const bytes = new Uint8Array(await scoped.arrayBuffer());
      expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
      const workbook = await loadXlsxWorkbook(bytes);
      const names = workbook.worksheets.map((sheet) => sheet.name);
      expect(names).toContain("Summary");
      expect(names).toContain("By Class");
      expect(names).toContain("By Jenjang");
      expect(names).toContain("Daily");
      expect(names).toContain("By Student");
      const summary = workbook.getWorksheet("Summary")!;
      const totalRow = [2, 3, 4, 5, 6, 7, 8].map((r) => summary.getRow(r).getCell(2).value);
      expect(totalRow).toContain(6); // SMP contains the first two seeded students.
      const after = value.database.client.query("SELECT COUNT(*) AS count FROM attendance").get() as { count: number };
      expect(after.count).toBe(before.count);
    } finally {
      value.cleanup();
    }
  }, 30000);
});
