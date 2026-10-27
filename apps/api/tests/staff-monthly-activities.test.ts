import { describe, expect, it } from "bun:test";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { loadXlsxWorkbook } from "@operatoros/excel";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";

const secret = "synthetic-monthly-ptk-cookie-secret-32";
const clock = () => new Date("2026-08-31T16:59:00.000Z");

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-monthly-ptk-"));
  const path = join(root, "operatoros.sqlite");
  createFreshDatabase(path);
  const database = openDatabase(path);
  const adminHash = await Bun.password.hash("synthetic-monthly-admin-password-1", "argon2id");
  const staffHash = await Bun.password.hash("synthetic-monthly-staff-password-1", "argon2id");
  database.client.run("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at,failed_login_attempts) VALUES (?,?,'admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)", ["synthetic-monthly-admin", adminHash]);
  database.client.run("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at,failed_login_attempts) VALUES (?,?,'staff',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)", ["synthetic-monthly-staff", staffHash]);
  const app = createApp({ databaseHandle: database, clock, auth: { authCookieSecret: secret, auditDir: join(root, "audit"), allowedOrigins: ["http://local"] } });
  const login = async (username: string, password: string) => app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const admin = cookie(await login("synthetic-monthly-admin", "synthetic-monthly-admin-password-1"));
  const staff = cookie(await login("synthetic-monthly-staff", "synthetic-monthly-staff-password-1"));
  return { root, database, app, admin, staff, cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

function request(method: string, path: string, session?: string, body?: unknown): Request {
  const headers = new Headers();
  if (session) headers.set("cookie", session);
  if (method !== "GET") headers.set("origin", "http://local");
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createStaff(value: Awaited<ReturnType<typeof setup>>, code: string) {
  const response = await value.app.handle(request("POST", "/api/staff", value.admin, { full_name: `Synthetic ${code}`, source_staff_id: code, employment_status: "ACTIVE" }));
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

async function createUnit(value: Awaited<ReturnType<typeof setup>>, name: string): Promise<number> {
  const response = await value.app.handle(request("POST", "/api/staff/school-units", value.admin, { name, reason: "Synthetic unit setup" }));
  expect(response.status).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function assign(value: Awaited<ReturnType<typeof setup>>, staffId: string, unitId: number, start: string, applicability: "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN") {
  return value.app.handle(request("POST", `/api/staff/${staffId}/school-unit-assignments`, value.admin, {
    school_unit_id: unitId,
    effective_from: start,
    ptk_applicability: applicability,
    reason: "Synthetic monthly PTK eligibility",
  }));
}

describe("monthly PTK activity", () => {
  it("freezes applicable staff/unit pairs, enforces transitions, and exports consistent summaries", async () => {
    const value = await setup();
    try {
      const staffA = await createStaff(value, "PTK-A");
      const staffB = await createStaff(value, "PTK-B");
      const staffC = await createStaff(value, "PTK-C");
      const unitA = await createUnit(value, "Synthetic Unit A");
      const unitB = await createUnit(value, "Synthetic Unit B");
      const unitC = await createUnit(value, "Synthetic Unit C");

      expect((await assign(value, staffA, unitA, "2026-07-01", "APPLICABLE")).status).toBe(201);
      const firstAssignment = value.database.client.query("SELECT id FROM staff_school_unit_assignment_versions WHERE staff_member_id=? AND school_unit_id=?").get(staffA, unitA) as { id: number };
      expect((await value.app.handle(request("POST", `/api/staff/${staffA}/school-unit-assignments/${firstAssignment.id}/close`, value.admin, { effective_to: "2026-07-15", reason: "Synthetic period boundary" }))).status).toBe(200);
      expect((await assign(value, staffA, unitA, "2026-07-16", "APPLICABLE")).status).toBe(201);
      expect((await assign(value, staffA, unitB, "2026-07-31", "APPLICABLE")).status).toBe(201);
      expect((await assign(value, staffB, unitA, "2026-07-01", "UNKNOWN")).status).toBe(201);
      expect((await assign(value, staffC, unitA, "2026-07-01", "NOT_APPLICABLE")).status).toBe(201);
      value.database.client.run("UPDATE staff_members SET employment_status='FORMER',employment_end_date='2026-06-30' WHERE id=?", [staffA]);

      expect((await value.app.handle(request("POST", "/api/staff/monthly-activities/generate", undefined, { month: "2026-07" }))).status).toBe(401);
      expect((await value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.staff, { month: "2026-07" }))).status).toBe(403);
      expect((await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-07", value.staff))).status).toBe(403);

      const generationResponses = await Promise.all([
        value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.admin, { month: "2026-07" })),
        value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.admin, { month: "2026-07" })),
      ]);
      expect(generationResponses.map((response) => response.status)).toEqual([200, 200]);
      const generationResults = await Promise.all(generationResponses.map((response) => response.json()));
      expect(generationResults).toEqual(expect.arrayContaining([
        { month: "2026-07", generated_count: 2, already_generated: false },
        { month: "2026-07", generated_count: 0, already_generated: true },
      ]));
      const markerBefore = value.database.client.query("SELECT generated_at,generated_by_user_id FROM staff_monthly_activity_periods WHERE reporting_year=2026 AND reporting_month=7").get();
      expect((await assign(value, staffA, unitC, "2026-07-31", "APPLICABLE")).status).toBe(201);
      const retry = await value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.admin, { month: "2026-07" }));
      expect(await retry.json()).toEqual({ month: "2026-07", generated_count: 0, already_generated: true });
      expect(value.database.client.query("SELECT generated_at,generated_by_user_id FROM staff_monthly_activity_periods WHERE reporting_year=2026 AND reporting_month=7").get()).toEqual(markerBefore);

      const listResponse = await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-07", value.admin));
      expect((await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-07&school_unit_id=1.5", value.admin))).status).toBe(400);
      expect(listResponse.status).toBe(200);
      const list = await listResponse.json() as { period: { generated: boolean }; summary: Record<string, unknown>; items: Array<{ id: number; staff_member_id: string; school_unit_id: number; status: string; version: number }> };
      expect(list.period.generated).toBe(true);
      expect(list.items).toHaveLength(2);
      expect(list.items.filter((item) => item.staff_member_id === staffA)).toHaveLength(2);
      expect(list.items.map((item) => item.school_unit_id)).toEqual([unitA, unitB]);
      expect(list.summary).toMatchObject({ total_activities: 2, total_applicable: 2, completed: 0, pending: 2, not_applicable: 0, completion_percentage: 0 });

      const primary = list.items.find((item) => item.school_unit_id === unitA)!;
      const complete = await value.app.handle(request("PATCH", `/api/staff/monthly-activities/${primary.id}`, value.admin, { expected_version: 1, status: "COMPLETED", confirmation_date: "2026-08-31" }));
      expect(complete.status).toBe(200);
      expect(await complete.json()).toMatchObject({ status: "COMPLETED", confirmation_date: "2026-08-31", confirmed_by: "synthetic-monthly-admin", version: 2 });
      const completionSummary = await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-07", value.admin));
      expect((await completionSummary.json() as { summary: Record<string, unknown> }).summary).toMatchObject({ completed: 1, pending: 1, completion_percentage: 50 });

      const missingReason = await value.app.handle(request("PATCH", `/api/staff/monthly-activities/${primary.id}`, value.admin, { expected_version: 2, status: "NEEDS_CORRECTION" }));
      expect(missingReason.status).toBe(422);
      const correction = await value.app.handle(request("PATCH", `/api/staff/monthly-activities/${primary.id}`, value.admin, { expected_version: 2, status: "NEEDS_CORRECTION", processing_notes: "Recheck external record", reason: "Synthetic correction" }));
      expect(correction.status).toBe(200);
      expect(await correction.json()).toMatchObject({ status: "NEEDS_CORRECTION", confirmation_date: null, confirmed_by: null, processing_notes: "Recheck external record", version: 3 });
      const historyResponse = await value.app.handle(request("GET", `/api/staff/monthly-activities/${primary.id}/history`, value.admin));
      expect(historyResponse.status).toBe(200);
      const history = await historyResponse.json() as { items: Array<{ version: number; from_status: string | null; to_status: string; from_confirmation_date: string | null; reason: string | null }> };
      expect(history.items).toHaveLength(3);
      expect(history.items[2]).toMatchObject({ version: 3, from_status: "COMPLETED", to_status: "NEEDS_CORRECTION", from_confirmation_date: "2026-08-31", reason: "Synthetic correction" });

      const beforeStale = value.database.client.query("SELECT COUNT(*) AS count FROM staff_monthly_activity_history WHERE activity_id=?").get(primary.id) as { count: number };
      const stale = await value.app.handle(request("PATCH", `/api/staff/monthly-activities/${primary.id}`, value.admin, { expected_version: 2, status: "PENDING", reason: "Stale correction" }));
      expect(stale.status).toBe(409);
      expect(value.database.client.query("SELECT COUNT(*) AS count FROM staff_monthly_activity_history WHERE activity_id=?").get(primary.id)).toEqual(beforeStale);

      const other = list.items.find((item) => item.id !== primary.id)!;
      expect((await value.app.handle(request("PATCH", `/api/staff/monthly-activities/${other.id}`, value.admin, { expected_version: 1, status: "NOT_APPLICABLE", reason: "Synthetic non-applicable correction" }))).status).toBe(200);
      const correctedSummary = await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-07", value.admin));
      expect((await correctedSummary.json() as { summary: Record<string, unknown> }).summary).toMatchObject({ total_activities: 2, total_applicable: 1, completed: 0, needs_correction: 1, not_applicable: 1, completion_percentage: 0 });
      expect((await value.app.handle(request("GET", `/api/staff/monthly-activities/${primary.id}/history`, value.staff))).status).toBe(403);

      const trend = await value.app.handle(request("GET", "/api/staff/monthly-activities/summary?from_month=2026-07&to_month=2026-07", value.admin));
      expect(await trend.json()).toMatchObject({ items: [expect.objectContaining({ month: "2026-07", total_activities: 2, total_applicable: 1 })] });
      const filteredExport = await value.app.handle(request("GET", `/api/staff/monthly-activities/export?month=2026-07&school_unit_id=${unitA}&status=NEEDS_CORRECTION&format=xlsx`, value.admin));
      expect(filteredExport.status).toBe(200);
      const workbookBytes = new Uint8Array(await filteredExport.arrayBuffer());
      expect(Array.from(workbookBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const workbook = await loadXlsxWorkbook(workbookBytes);
      expect(workbook.getWorksheet("Activities")?.getRow(2).values).toContain("NEEDS_CORRECTION");
      const pdf = await value.app.handle(request("GET", "/api/staff/monthly-activities/export?month=2026-07&format=pdf", value.admin));
      expect(pdf.status).toBe(200);
      expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
      expect((await value.app.handle(request("GET", "/api/staff/monthly-activities/export?month=2026-07&format=xlsx", value.staff))).status).toBe(403);

      expect(() => value.database.client.run("UPDATE staff_monthly_activity_history SET reason='Changed' WHERE activity_id=?", [primary.id])).toThrow();
      expect(() => value.database.client.run("DELETE FROM staff_monthly_activity_history WHERE activity_id=?", [primary.id])).toThrow();
    } finally { value.cleanup(); }
  }, 60000);

  it("records an empty generated month so later assignments cannot backfill it", async () => {
    const value = await setup();
    try {
      const staffId = await createStaff(value, "PTK-LATE");
      const unitId = await createUnit(value, "Synthetic Late Unit");
      const generated = await value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.admin, { month: "2026-06" }));
      expect(await generated.json()).toEqual({ month: "2026-06", generated_count: 0, already_generated: false });
      expect((await assign(value, staffId, unitId, "2026-06-01", "APPLICABLE")).status).toBe(201);
      const retry = await value.app.handle(request("POST", "/api/staff/monthly-activities/generate", value.admin, { month: "2026-06" }));
      expect(await retry.json()).toEqual({ month: "2026-06", generated_count: 0, already_generated: true });
      const list = await value.app.handle(request("GET", "/api/staff/monthly-activities?month=2026-06", value.admin));
      expect(await list.json()).toMatchObject({ period: { generated: true }, summary: { total_activities: 0, total_applicable: 0, completion_percentage: null }, items: [] });
      const trend = await value.app.handle(request("GET", "/api/staff/monthly-activities/summary?from_month=2026-06&to_month=2026-06", value.admin));
      expect(await trend.json()).toMatchObject({ items: [expect.objectContaining({ month: "2026-06", total_activities: 0, total_applicable: 0, completion_percentage: null })] });
    } finally { value.cleanup(); }
  }, 60000);
});
