import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
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
});
