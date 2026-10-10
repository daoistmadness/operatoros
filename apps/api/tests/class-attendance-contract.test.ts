import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { readXlsxWorkbook } from "@operatoros/excel";
import { ClassAttendanceEntriesResponseSchema, ClassAttendanceResponseSchema } from "@operatoros/contracts/attendance";
import { openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAttendancePolicyFixture } from "./fixtures/attendance-policy";

const secret = "astryx-class-attendance-contract-secret";

function seed(path: string): void {
  createAttendancePolicyFixture(path, "contract");
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("class attendance response contract", () => {
  it("validates the actual route payload and preserves the public field shape", async () => {
    const path = `/tmp/operatoros-class-attendance-contract-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-attendance-contract-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-admin", password: "contract-admin-pass-1" }) }));
      const response = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-03", { headers: { cookie: sessionCookie(login), origin: "http://localhost:5173" } }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, any>;
      expect(Value.Check(ClassAttendanceResponseSchema, body)).toBe(true);
      expect(body.items[0]).toMatchObject({ student_name: "Synthetic Attendance Student", effective_status: "late", scan_in: "07:40", scan_out: "16:00" });
      expect(body.items[0]).not.toHaveProperty("full_name");

      const submit = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-04/entries", { method: "POST", headers: { cookie: sessionCookie(login), "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ entries: [{ student_id: 9001, status: "on-time" }] }) }));
      expect(submit.status).toBe(200);
      const submitBody = await submit.json() as Record<string, unknown>;
      expect(Value.Check(ClassAttendanceEntriesResponseSchema, submitBody)).toBe(true);
      expect(submitBody).toMatchObject({ class_id: 1, date: "2026-08-04", total_submitted: 1, created: 1, updated: 0, submitted_by: "contract-admin" });
      expect(submitBody).not.toHaveProperty("success");
      expect(database.client.query("SELECT check_in, check_out, status FROM attendance WHERE student_id = 9001 AND date = '2026-08-04'").get()).toMatchObject({ check_in: null, check_out: null, status: "on-time" });
      const manualAudit = database.client.query("SELECT actor_id, metadata FROM operations_audit_events WHERE entity_reference = (SELECT 'ATTENDANCE/' || id FROM attendance WHERE student_id = 9001 AND date = '2026-08-04') AND operation = 'MANUAL_CLASS_ATTENDANCE_CREATE'").get() as any;
      expect(manualAudit.actor_id).toBe("contract-admin");
      expect(JSON.parse(manualAudit.metadata)).toMatchObject({ provenance: "MANUAL", source_workflow: "CLASS_ATTENDANCE_ENTRY", after: { status: "on-time", check_in: null } });

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-staff", password: "contract-staff-pass-1" }) }));
      const unassigned = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-03", { headers: { cookie: sessionCookie(staffLogin), origin: "http://localhost:5173" } }));
      expect(unassigned.status).toBe(403);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  }, 30000);

  it("rejects missing, renamed, and mistyped required fields", () => {
    const item = {
      student_id: 1,
      student_name: "Synthetic Student",
      attendance_id: null,
      raw_status: "unrecorded",
      effective_status: "unrecorded",
      is_overridden: false,
      scan_in: null,
      scan_out: null,
      is_absent: false,
      pending_correction: false,
      correction_request_id: null,
    };
    const response = { class_id: 1, class_name: "Synthetic 7A", date: "2026-08-03", is_finalized: false, total_enrolled: 1, items: [item] };
    expect(Value.Check(ClassAttendanceResponseSchema, response)).toBe(true);

    const missing = { ...response, items: [{ ...item, student_name: undefined }] };
    const renamed = { ...response, items: [{ ...item, student_name: undefined, full_name: "Synthetic Student" }] };
    const mistyped = { ...response, items: [{ ...item, student_id: "1" }] };
    expect(Value.Check(ClassAttendanceResponseSchema, missing)).toBe(false);
    expect(Value.Check(ClassAttendanceResponseSchema, renamed)).toBe(false);
    expect(Value.Check(ClassAttendanceResponseSchema, mistyped)).toBe(false);
  });

  it("derives manual on-time/late from the canonical cutoff when an arrival time is entered", async () => {
    const path = `/tmp/operatoros-class-attendance-canonical-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-attendance-canonical-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-admin", password: "contract-admin-pass-1" }) }));
      const cookie = sessionCookie(login);
      const submit = async (date: string, entries: unknown) => app.handle(new Request(`http://local/api/attendance/classes/1/dates/${date}/entries`, { method: "POST", headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ entries }) }));
      // An operator-marked on-time arrival after the cutoff is stored late with canonical minutes.
      expect((await submit("2026-08-05", [{ student_id: 9001, status: "on-time", check_in: "07:40", check_out: "16:00" }])).status).toBe(200);
      expect(database.client.query("SELECT status, late_duration, late_source FROM attendance WHERE student_id = 9001 AND date = '2026-08-05'").get()).toMatchObject({ status: "late", late_duration: 10, late_source: "calculated" });
      // An on-time arrival keeps its derived status.
      expect((await submit("2026-08-06", [{ student_id: 9001, status: "late", check_in: "07:20", check_out: "16:00" }])).status).toBe(200);
      expect(database.client.query("SELECT status, late_duration, late_source FROM attendance WHERE student_id = 9001 AND date = '2026-08-06'").get()).toMatchObject({ status: "on-time", late_duration: 0, late_source: "calculated" });
      // Explicit Sakit keeps the operator status and never becomes late.
      expect((await submit("2026-08-07", [{ student_id: 9001, status: "sakit", check_in: "07:40" }])).status).toBe(200);
      expect(database.client.query("SELECT status, late_duration, late_source FROM attendance WHERE student_id = 9001 AND date = '2026-08-07'").get()).toMatchObject({ status: "sakit", late_duration: 0, late_source: "none" });
      // Explicit late without an arrival time keeps the operator status with unavailable duration.
      expect((await submit("2026-08-08", [{ student_id: 9001, status: "late" }])).status).toBe(200);
      expect(database.client.query("SELECT status, late_duration, late_source FROM attendance WHERE student_id = 9001 AND date = '2026-08-08'").get()).toMatchObject({ status: "late", late_duration: 0, late_source: "manual" });
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  }, 30000);

  it("preserves raw attendance across repeated authorized class corrections and rolls back failures", async () => {
    const path = `/tmp/operatoros-class-attendance-revisions-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-class-attendance-revisions-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-admin", password: "contract-admin-pass-1" }) }));
      const cookie = sessionCookie(login); const auth = { cookie, origin: "http://localhost:5173" };
      const submit = (date: string, entries: unknown, headers = auth) => app.handle(new Request(`http://local/api/attendance/classes/1/dates/${date}/entries`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ entries }) }));
      const rawBefore = database.client.query("SELECT status, check_in, check_out, late_duration FROM attendance WHERE student_id = 9001 AND date = '2026-08-03'").get();

      expect((await submit("2026-08-03", [{ student_id: 9001, status: "absent", notes: "Checked the class register." }])).status).toBe(200);
      expect(database.client.query("SELECT status, check_in, check_out, late_duration FROM attendance WHERE student_id = 9001 AND date = '2026-08-03'").get()).toEqual(rawBefore);
      expect(database.client.query("SELECT override_status, reviewed_by, note FROM attendance_overrides WHERE attendance_id = 1").get()).toMatchObject({ override_status: "absent", reviewed_by: "contract-admin", note: "Checked the class register." });

      expect((await submit("2026-08-03", [{ student_id: 9001, status: "on-time", notes: "Rechecked the register." }])).status).toBe(200);
      const daily = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-03", { headers: auth }));
      expect((await daily.json() as any).items[0]).toMatchObject({ raw_status: "late", effective_status: "on-time", is_absent: false, scan_in: "07:40" });
      expect(database.client.query("SELECT previous_status, new_status, previous_values, new_values, reviewed_by, note FROM attendance_override_history WHERE attendance_id = 1 ORDER BY id").all()).toHaveLength(2);
      expect(database.client.query("SELECT previous_status, new_status, reviewed_by, note FROM attendance_override_history WHERE attendance_id = 1 ORDER BY id").all()).toEqual([
        { previous_status: "late", new_status: "absent", reviewed_by: "contract-admin", note: "Checked the class register." },
        { previous_status: "absent", new_status: "on-time", reviewed_by: "contract-admin", note: "Rechecked the register." },
      ]);

      const exported = await app.handle(new Request("http://local/api/attendance/classes/1/attendance/export-excel?month=08&year=2026", { headers: auth }));
      expect(exported.status).toBe(200);
      const workbook = await readXlsxWorkbook(new Uint8Array(await exported.arrayBuffer()));
      const detail = workbook.sheets.find((sheet) => sheet.name === "Rincian Harian")!;
      expect(detail.rows.find((row) => row.values[1] === "2026-08-03")?.values[2]).toBe("on-time");

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "contract-staff", password: "contract-staff-pass-1" }) }));
      expect((await submit("2026-08-03", [{ student_id: 9001, status: "absent" }], { cookie: sessionCookie(staffLogin), origin: "http://localhost:5173" })).status).toBe(403);

      const historyCount = Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_override_history WHERE attendance_id = 1").get() as any).count);
      database.client.run("CREATE TRIGGER fail_manual_attendance_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'MANUAL_CLASS_ATTENDANCE_CORRECT' BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
      const failed = await submit("2026-08-03", [{ student_id: 9001, status: "absent", notes: "This operation must roll back." }]);
      expect(failed.status).toBe(400);
      expect(database.client.query("SELECT override_status FROM attendance_overrides WHERE attendance_id = 1").get()).toMatchObject({ override_status: "on-time" });
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_override_history WHERE attendance_id = 1").get() as any).count)).toBe(historyCount);
    } finally {
      database.close();
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  }, 30000);
});
