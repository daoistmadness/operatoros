import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./fixtures/golden";

const secret = "astryx-test-only-cookie-secret-32-chars";
const staffId = "synthetic-staff-admin";

function seedAcademic(path: string): void {
  createGoldenFixture(path, "academic-with-defaults");
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<{ cookie: string }> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
  }));
  if (response.status !== 200) throw new Error(`login failed for ${username}: ${await response.text()}`);
  return { cookie: sessionCookie(response) };
}

function jsonRequest(method: string, path: string, auth: { cookie: string } | null, body?: unknown): Request {
  return new Request(`http://local${path}`, {
    method,
    headers: { ...(auth ?? {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function auditRows(database: ReturnType<typeof openDatabase>, operation: string): Record<string, any>[] {
  return database.client.query("SELECT * FROM operations_audit_events WHERE operation = ? ORDER BY id").all(operation) as Record<string, any>[];
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

describe("administration accountability", () => {
  it("audits staff mutations transactionally without copying staff or education contents", async () => {
    const path = `/tmp/operatoros-admin-accountability-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-admin-accountability-audit-${process.pid}-${Date.now()}`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      database.client.run("INSERT INTO staff_members (id, full_name, normalized_name, employment_status, employment_start_date, dapodik_status_normalized) VALUES (?, 'Synthetic Staff', 'synthetic staff', 'ACTIVE', '2020-01-01', 'ACTIVE')", [staffId]);
      database.client.run("INSERT INTO staff_identifiers (staff_member_id, identifier_type, raw_value, normalized_value) VALUES (?, 'NIK', 'SENSITIVE_IDENTIFIER_SENTINEL', 'SENSITIVE_IDENTIFIER_SENTINEL')", [staffId]);
      const jenjangs = database.client.query("SELECT id FROM jenjangs WHERE active = 1 ORDER BY id LIMIT 2").all() as { id: number }[];
      expect(jenjangs).toHaveLength(2);
      const [firstJenjang, secondJenjang] = jenjangs.map((value) => Number(value.id)) as [number, number];
      database.client.run("INSERT INTO staff_jenjang_assignments (staff_member_id, jenjang_id) VALUES (?, ?)", [staffId, firstJenjang]);
      const initialEducationId = Number(database.client.run("INSERT INTO staff_education (staff_member_id, education_level, institution_name, notes) VALUES (?, 'S1', 'Synthetic University', 'PRIVATE_EDUCATION_NOTE_SENTINEL')", [staffId]).lastInsertRowid);
      const admin = await login(app, "golden-admin", "golden-admin-pass-1");
      const staff = await login(app, "golden-staff", "golden-staff-pass-1");
      const educationBody = { education_level: "S2", institution_name: "Synthetic Institute", major: "Synthetic Major", graduation_year: 2020, notes: "PRIVATE_EDUCATION_NOTE_SENTINEL" };
      const paths = [
        ["PATCH", `/api/staff/${staffId}`, { employment_end_date: "2026-09-30" }],
        ["PUT", `/api/staff/${staffId}/jenjangs`, { jenjang_ids: [secondJenjang] }],
        ["POST", `/api/staff/${staffId}/education`, educationBody],
        ["PATCH", `/api/staff/${staffId}/education/${initialEducationId}`, educationBody],
        ["DELETE", `/api/staff/${staffId}/education/${initialEducationId}`, undefined],
      ] as const;
      for (const [method, route, body] of paths) {
        expect((await app.handle(jsonRequest(method, route, null, body))).status).toBe(401);
        expect((await app.handle(jsonRequest(method, route, staff, body))).status).toBe(403);
      }
      expect(database.client.query("SELECT COUNT(*) AS count FROM operations_audit_events WHERE operation LIKE 'STAFF_%'").get()).toMatchObject({ count: 0 });

      const updatedStaff = await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}`, admin, { employment_end_date: "2026-09-30" }));
      expect(updatedStaff.status).toBe(200);
      const updateEvent = auditRows(database, "STAFF_UPDATE")[0]!;
      expect(updateEvent).toMatchObject({ actor_id: "golden-admin", actor_role: "admin", capability: "manage_staff", entity_type: "STAFF", entity_reference: staffId, operation: "STAFF_UPDATE", risk_level: "MEDIUM", source: "API", success: 1 });
      expect(parseJson(updateEvent.changed_fields)).toEqual(["employment_end_date"]);
      expect(String(updateEvent.metadata)).not.toContain("SENSITIVE_IDENTIFIER_SENTINEL");

      expect((await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}`, admin, { employment_end_date: "2026-09-30" }))).status).toBe(200);
      expect(auditRows(database, "STAFF_UPDATE")).toHaveLength(2);

      const invalidUpdate = await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}`, admin, { employment_end_date: "2019-12-31" }));
      const missingUpdate = await app.handle(jsonRequest("PATCH", "/api/staff/missing-staff", admin, { employment_end_date: "2026-09-30" }));
      expect(invalidUpdate.status).toBe(422);
      expect(missingUpdate.status).toBe(404);
      expect(auditRows(database, "STAFF_UPDATE")).toHaveLength(2);

      database.client.run("CREATE TRIGGER fail_staff_update_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'STAFF_UPDATE' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
      expect((await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}`, admin, { employment_end_date: "2026-10-01" }))).status).toBe(409);
      expect(database.client.query("SELECT employment_end_date FROM staff_members WHERE id = ?").get(staffId)).toEqual({ employment_end_date: "2026-09-30" });
      expect(auditRows(database, "STAFF_UPDATE")).toHaveLength(2);
      database.client.run("DROP TRIGGER fail_staff_update_audit");

      const replaced = await app.handle(jsonRequest("PUT", `/api/staff/${staffId}/jenjangs`, admin, { jenjang_ids: [secondJenjang] }));
      expect(replaced.status).toBe(200);
      expect(database.client.query("SELECT jenjang_id FROM staff_jenjang_assignments WHERE staff_member_id = ? ORDER BY jenjang_id").all(staffId)).toEqual([{ jenjang_id: secondJenjang }]);
      const jenjangEvent = auditRows(database, "STAFF_JENJANG_REPLACE")[0]!;
      expect(jenjangEvent).toMatchObject({ actor_id: "golden-admin", actor_role: "admin", capability: "manage_staff", entity_type: "STAFF", entity_reference: staffId, source: "API", success: 1 });
      expect(parseJson(jenjangEvent.changed_fields)).toEqual(["jenjang_ids"]);
      expect(parseJson(jenjangEvent.metadata)).toEqual({ previous_jenjang_ids: [firstJenjang], resulting_jenjang_ids: [secondJenjang] });
      expect((await app.handle(jsonRequest("PUT", `/api/staff/${staffId}/jenjangs`, admin, { jenjang_ids: [secondJenjang, secondJenjang] }))).status).toBe(422);
      expect((await app.handle(jsonRequest("PUT", "/api/staff/missing-staff/jenjangs", admin, { jenjang_ids: [] }))).status).toBe(404);
      expect(auditRows(database, "STAFF_JENJANG_REPLACE")).toHaveLength(1);

      database.client.run("CREATE TRIGGER fail_staff_jenjang_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'STAFF_JENJANG_REPLACE' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
      expect((await app.handle(jsonRequest("PUT", `/api/staff/${staffId}/jenjangs`, admin, { jenjang_ids: [firstJenjang] }))).status).toBe(409);
      expect(database.client.query("SELECT jenjang_id FROM staff_jenjang_assignments WHERE staff_member_id = ? ORDER BY jenjang_id").all(staffId)).toEqual([{ jenjang_id: secondJenjang }]);
      expect(auditRows(database, "STAFF_JENJANG_REPLACE")).toHaveLength(1);
      database.client.run("DROP TRIGGER fail_staff_jenjang_audit");

      const created = await app.handle(jsonRequest("POST", `/api/staff/${staffId}/education`, admin, educationBody));
      expect(created.status).toBe(201);
      const createdEducation = await created.json() as { id: number };
      const createEvent = auditRows(database, "STAFF_EDUCATION_CREATE")[0]!;
      expect(createEvent).toMatchObject({ actor_id: "golden-admin", actor_role: "admin", capability: "manage_staff", entity_type: "STAFF_EDUCATION", entity_reference: String(createdEducation.id), source: "API", success: 1 });
      expect(parseJson(createEvent.changed_fields)).toEqual(["education_record"]);
      expect(parseJson(createEvent.metadata)).toEqual({ staff_id: staffId });
      expect(JSON.stringify(createEvent)).not.toContain("Synthetic Institute");
      expect(JSON.stringify(createEvent)).not.toContain("Synthetic Major");
      expect(JSON.stringify(createEvent)).not.toContain("PRIVATE_EDUCATION_NOTE_SENTINEL");

      const updatedEducation = await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}/education/${createdEducation.id}`, admin, { ...educationBody, education_level: "S3" }));
      expect(updatedEducation.status).toBe(200);
      const updateEducationEvent = auditRows(database, "STAFF_EDUCATION_UPDATE")[0]!;
      expect(updateEducationEvent).toMatchObject({ actor_id: "golden-admin", entity_type: "STAFF_EDUCATION", entity_reference: String(createdEducation.id), operation: "STAFF_EDUCATION_UPDATE", success: 1 });
      expect(parseJson(updateEducationEvent.changed_fields)).toEqual(["education_level", "institution_name", "major", "graduation_year", "notes"]);
      expect(parseJson(updateEducationEvent.metadata)).toEqual({ staff_id: staffId });
      expect(JSON.stringify(updateEducationEvent)).not.toContain("PRIVATE_EDUCATION_NOTE_SENTINEL");
      expect((await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}/education/${createdEducation.id}`, admin, { ...educationBody, education_level: "PHD" }))).status).toBe(422);
      expect((await app.handle(jsonRequest("PATCH", `/api/staff/${staffId}/education/999999`, admin, educationBody))).status).toBe(404);
      expect(auditRows(database, "STAFF_EDUCATION_UPDATE")).toHaveLength(1);

      const deleted = await app.handle(jsonRequest("DELETE", `/api/staff/${staffId}/education/${createdEducation.id}`, admin));
      expect(deleted.status).toBe(204);
      expect(database.client.query("SELECT id FROM staff_education WHERE id = ?").get(createdEducation.id)).toBeNull();
      const deleteEvent = auditRows(database, "STAFF_EDUCATION_DELETE")[0]!;
      expect(deleteEvent).toMatchObject({ actor_id: "golden-admin", actor_role: "admin", capability: "manage_staff", entity_type: "STAFF_EDUCATION", entity_reference: String(createdEducation.id), operation: "STAFF_EDUCATION_DELETE", source: "API", success: 1 });
      expect(parseJson(deleteEvent.changed_fields)).toEqual(["education_record"]);
      expect(parseJson(deleteEvent.metadata)).toEqual({ staff_id: staffId });
      expect((await app.handle(jsonRequest("DELETE", `/api/staff/${staffId}/education/${createdEducation.id}`, admin))).status).toBe(404);
      expect(auditRows(database, "STAFF_EDUCATION_DELETE")).toHaveLength(1);

      database.client.run("CREATE TRIGGER fail_staff_education_delete_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'STAFF_EDUCATION_DELETE' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
      expect((await app.handle(jsonRequest("DELETE", `/api/staff/${staffId}/education/${initialEducationId}`, admin))).status).toBe(409);
      expect(database.client.query("SELECT id FROM staff_education WHERE id = ?").get(initialEducationId)).toMatchObject({ id: initialEducationId });
      expect(auditRows(database, "STAFF_EDUCATION_DELETE")).toHaveLength(1);
      database.client.run("DROP TRIGGER fail_staff_education_delete_audit");
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);

  it("binds HEB authorship to the admin session and preserves CRUD validation", async () => {
    const path = `/tmp/operatoros-heb-accountability-${process.pid}-${Date.now()}.db`;
    const auditDir = `/tmp/operatoros-heb-accountability-audit-${process.pid}-${Date.now()}`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir } });
    try {
      const admin = await login(app, "golden-admin", "golden-admin-pass-1");
      const staff = await login(app, "golden-staff", "golden-staff-pass-1");
      const route = "/api/config/heb/SMP/2026/8";
      const body = { heb_value: 20, note: "Synthetic HEB correction" };
      expect((await app.handle(jsonRequest("PUT", route, null, body))).status).toBe(401);
      expect((await app.handle(jsonRequest("PUT", route, staff, body))).status).toBe(403);
      expect((await app.handle(jsonRequest("PUT", route, admin, body))).status).toBe(200);
      expect(database.client.query("SELECT set_by, note FROM heb_overrides WHERE jenjang = 'SMP' AND year = 2026 AND month = 8").get()).toEqual({ set_by: "golden-admin", note: "Synthetic HEB correction" });

      const spoof = await app.handle(jsonRequest("PUT", route, admin, { ...body, heb_value: 21, set_by: "someone-else" }));
      expect([200, 400, 422]).toContain(spoof.status);
      expect(database.client.query("SELECT set_by FROM heb_overrides WHERE jenjang = 'SMP' AND year = 2026 AND month = 8").get()).toEqual({ set_by: "golden-admin" });
      if (spoof.status === 200) expect(await spoof.json()).toMatchObject({ set_by: "golden-admin", heb_value: 21 });

      for (const [invalidRoute, invalidBody] of [
        ["/api/config/heb/SMP/2026/0", body],
        ["/api/config/heb/SMP/2026/13", body],
        ["/api/config/heb/SMP/2019/8", body],
        [route, { ...body, heb_value: 0 }],
        [route, { ...body, heb_value: 32 }],
        [route, { ...body, heb_value: 1.5 }],
      ] as const) {
        expect((await app.handle(jsonRequest("PUT", invalidRoute, admin, invalidBody))).status).toBe(400);
      }

      expect((await app.handle(jsonRequest("DELETE", route, null))).status).toBe(401);
      expect((await app.handle(jsonRequest("DELETE", route, staff))).status).toBe(403);
      expect((await app.handle(jsonRequest("DELETE", route, admin))).status).toBe(200);
      expect(database.client.query("SELECT id FROM heb_overrides WHERE jenjang = 'SMP' AND year = 2026 AND month = 8").get()).toBeNull();
      expect((await app.handle(jsonRequest("DELETE", route, admin))).status).toBe(404);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(auditDir, { recursive: true, force: true });
    }
  }, 30000);
});
