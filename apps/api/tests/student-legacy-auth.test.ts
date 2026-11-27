import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAttendanceReadFixture } from "./fixtures/attendance-reads";

const secret = "astryx-test-only-cookie-secret-32-chars";

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("legacy student route authorization", () => {
  it("preserves the documented limited open directory read and protects records and mutations", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), `operatoros-student-auth-${process.pid}-`));
    const path = join(tempDir, "operatoros.sqlite");
    createAttendanceReadFixture(path, "corrections");
    const database = openDatabase(path);
    database.client.exec(`
      INSERT INTO students (id, name, jenjang, class_name) VALUES (9604, 'Delta Synthetic Student', 'SMP', '7B');
      INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state)
        VALUES (9604, 1, 2, 2, '7B', 1, '2026-07-01', 'ACTIVE');
      INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, entered_by, entered_at, updated_at)
        VALUES (9604, '7B', 8, 2026, 1, 0, 0, 'golden-admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO absence_reasons (student_id, class_name, month, year, sakit, izin, alfa, entered_by, entered_at, updated_at)
        VALUES (9601, '7A', 8, 2026, 1, 2, 0, 'golden-admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO students (id, name, jenjang, class_name) VALUES (9606, 'Zeta Synthetic Student', 'SMP', '7B');
      INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state)
        VALUES (9606, 1, 2, 2, '7B', 1, '2026-07-01', 'ACTIVE');
      INSERT INTO students (id, name, jenjang, class_name) VALUES (9607, 'Eta Synthetic Student', 'SMP', '7A');
      INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state)
        VALUES (9607, 1, 2, 1, '7A', 1, '2026-07-01', 'ACTIVE');
    `);
    const disjointClass = database.client.run(
      "INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7C','C',1)",
    );
    database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9605,'Epsilon Synthetic Student','SMP','7C')");
    database.client.run(
      "INSERT INTO student_enrollments (student_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9605,1,2,?,'7C',1,'2026-08-15','ACTIVE')",
      [Number(disjointClass.lastInsertRowid)],
    );
    database.client.run(
      "INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from,effective_to) VALUES (2,1,?,'HOMEROOM_TEACHER',1,'golden-admin','2026-08-01','2026-08-10')",
      [Number(disjointClass.lastInsertRowid)],
    );
    database.client.run(
      "INSERT INTO absence_reasons (student_id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (9605,'7C',8,2026,3,0,0,'golden-admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
    );
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: join(tempDir, "audit") } });

    const request = (pathname: string, init: RequestInit = {}) => app.handle(new Request(`http://local${pathname}`, init));
    const login = async (username: string, password: string) => {
      const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      expect(response.status).toBe(200);
      return { cookie: `astyx_session=${cookie(response)}`, origin: "http://localhost:5173" };
    };

    try {
      const openDirectory = await request("/api/students?page=1&page_size=1");
      expect(openDirectory.status).toBe(200);
      const directoryBody = await openDirectory.json() as { students: Array<Record<string, unknown>> };
      expect(Object.keys(directoryBody.students[0] ?? {}).sort()).toEqual(["class_name", "id", "jenjang", "name"]);

      const anonymousJsonHeaders = { "content-type": "application/json" };
      expect((await request("/api/students", { method: "POST", headers: anonymousJsonHeaders, body: JSON.stringify({ name: "Anonymous synthetic student" }) })).status).toBe(401);
      expect((await request("/api/students/set-class", { method: "POST", headers: anonymousJsonHeaders, body: JSON.stringify({ student_id: 9601, class_name: "7B", jenjang: "SMP" }) })).status).toBe(401);
      expect((await request("/api/students/assign-class", { method: "PATCH", headers: anonymousJsonHeaders, body: JSON.stringify({ student_ids: [9601], class_name: "7B", jenjang: "SMP" }) })).status).toBe(401);

      for (const pathname of [
        "/api/students/classes",
        "/api/students/all",
        "/api/students/9601/attendance-summary?month=8&year=2026",
        "/api/students/9601/monthly-history",
      ]) {
        expect((await request(pathname)).status).toBe(401);
      }

      const admin = await login("golden-admin", "golden-admin-pass-1");
      expect((await request("/api/students/all", { headers: admin })).status).toBe(200);
      expect((await request("/api/students/9601/attendance-summary?month=8&year=2026", { headers: admin })).status).toBe(200);
      expect((await request("/api/students/9601/monthly-history", { headers: admin })).status).toBe(200);

      const staff = await login("golden-staff", "golden-staff-pass-1");
      expect((await request("/api/students/classes", { headers: staff })).status).toBe(200);
      const assignedStudentSummary = await request("/api/students/9601/attendance-summary?month=8&year=2026", { headers: staff });
      expect(assignedStudentSummary.status).toBe(200);
      expect((await assignedStudentSummary.json() as { reported_sakit: number }).reported_sakit).toBe(1);
      expect((await request("/api/students/9601/monthly-history", { headers: staff })).status).toBe(200);
      const emptyAssignedSummary = await request("/api/students/9607/attendance-summary?month=8&year=2026", { headers: staff });
      expect(emptyAssignedSummary.status).toBe(200);
      expect((await emptyAssignedSummary.json() as { breakdown: unknown[] }).breakdown).toEqual([]);
      expect((await request("/api/students/9607/monthly-history", { headers: staff })).status).toBe(200);
      expect((await request("/api/students/9602/attendance-summary?month=8&year=2026", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9602/monthly-history", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9604/attendance-summary?month=8&year=2026", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9605/attendance-summary?month=8&year=2026", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9605/monthly-history", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9606/attendance-summary?month=8&year=2026", { headers: staff })).status).toBe(403);
      expect((await request("/api/students/9606/monthly-history", { headers: staff })).status).toBe(403);

      const beforeCount = Number((database.client.query("SELECT COUNT(*) AS count FROM students").get() as { count: number }).count);
      const beforeClass = database.client.query("SELECT class_name FROM students WHERE id = 9601").get();
      const jsonHeaders = { ...staff, "content-type": "application/json" };
      expect((await request("/api/students", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "Unauthorized synthetic student" }) })).status).toBe(403);
      expect((await request("/api/students/set-class", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ student_id: 9601, class_name: "7B", jenjang: "SMP" }) })).status).toBe(403);
      expect((await request("/api/students/assign-class", { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ student_ids: [9601], class_name: "7B", jenjang: "SMP" }) })).status).toBe(403);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM students").get() as { count: number }).count)).toBe(beforeCount);
      expect(database.client.query("SELECT class_name FROM students WHERE id = 9601").get()).toEqual(beforeClass);

      expect((await request("/api/students", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ name: "Authorized synthetic student" }) })).status).toBe(201);

      const revoked = await login("golden-staff", "golden-staff-pass-1");
      database.client.run("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'golden-staff') ORDER BY id DESC LIMIT 1)");
      expect((await request("/api/students/all", { headers: revoked })).status).toBe(401);

      const expired = await login("golden-staff", "golden-staff-pass-1");
      database.client.run("UPDATE sessions SET expires_at = '2000-01-01 00:00:00', absolute_expires_at = '2000-01-01 00:00:00' WHERE id = (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'golden-staff') ORDER BY id DESC LIMIT 1)");
      expect((await request("/api/students/all", { headers: expired })).status).toBe(401);
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30000);
});
