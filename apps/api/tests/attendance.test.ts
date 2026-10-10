import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createAttendanceReadFixture } from "./fixtures/attendance-reads";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createAttendanceReadFixture(path, "crud");
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("attendance parity slices", () => {
  it("records cutoff changes as effective-dated policies with reasons", async () => {
    const path = `/tmp/operatoros-cutoff-policy-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-cutoff-policy-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const body = { cutoff_time: "07:45", effective_from: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), reason: "Approved school schedule update" };
      const backdated = await app.handle(new Request("http://local/api/config/jenjang/SMP", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ ...body, effective_from: "2026-08-10" }) }));
      expect(backdated.status).toBe(400);
      const saved = await app.handle(new Request("http://local/api/config/jenjang/SMP", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(saved.status).toBe(200);
      expect(database.client.query("SELECT jenjang_id,effective_from,cutoff_time,source,created_by,reason FROM jenjang_lateness_policy WHERE jenjang_id=(SELECT id FROM jenjangs WHERE name='SMP') AND effective_from=?").get(body.effective_from)).toMatchObject({ effective_from: body.effective_from, cutoff_time: "07:45", source: "RECORDED", created_by: "golden-admin", reason: body.reason });
      expect((await app.handle(new Request("http://local/api/config/jenjang/SMP", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }))).status).toBe(409);
      database.client.run("INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (9001,'2099-01-03','07:40:00',NULL,0,'calculated',0,'late')");
      const covered = await app.handle(new Request("http://local/api/config/jenjang/SMP", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ ...body, cutoff_time: "07:50", effective_from: "2099-01-02" }) }));
      expect(covered.status).toBe(409);
      expect((await app.handle(new Request("http://local/api/config/jenjang/SMP", { method: "DELETE", headers: auth }))).status).toBe(409);
      const config = await app.handle(new Request("http://local/api/config/jenjang", { headers: auth }));
      expect(await config.json()).toMatchObject({ configured: [{ jenjang: "SMP", cutoff_time: "07:45", effective_from: body.effective_from, source: "RECORDED" }] });
      expect((database.client.query("PRAGMA table_info(jenjang_lateness_policy)").all() as any[]).map((value) => value.name)).not.toContain("grace_minutes");
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("keeps overrides append-only and blocks mutation after finalization", async () => {
    const path = `/tmp/operatoros-attendance-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const override = await app.handle(new Request("http://local/api/review/attendance/1/override", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ override_status: "on-time", note: "Device missed the morning scan." }) }));
      expect(override.status).toBe(200);
      expect(await (await app.handle(new Request("http://local/api/review/attendance/1/history", { headers: auth }))).json()).toMatchObject({ attendance_id: 1, items: [{ new_status: "on-time" }] });
      expect(() => database.client.run("UPDATE attendance_override_history SET note = 'tampered'" )).toThrow();
      const finalized = await app.handle(new Request("http://local/api/attendance-corrections/periods/finalize", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_date: "2026-08-01", reason: "Daily review completed", confirmation: "FINALIZE_ATTENDANCE_PERIOD" }) }));
      expect(finalized.status).toBe(200); expect((await finalized.json() as any).version).toBe(2);
      const blocked = await app.handle(new Request("http://local/api/review/attendance/1/override", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ override_status: "late", note: "Attempt after finalization" }) }));
      expect(blocked.status).toBe(409);
      const reopened = await app.handle(new Request("http://local/api/attendance-corrections/periods/reopen", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_date: "2026-08-01", expected_version: 2, reason: "Correction is required", confirmation: "REOPEN_ATTENDANCE_PERIOD" }) }));
      expect(reopened.status).toBe(200); expect((await reopened.json() as any).status).toBe("OPEN");

      const finalizeWithMonthlyCoverage = await app.handle(new Request("http://local/api/attendance-corrections/periods/finalize", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_date: "2026-08-03", reason: "Daily review completed", confirmation: "FINALIZE_ATTENDANCE_PERIOD" }) }));
      expect(finalizeWithMonthlyCoverage.status).toBe(200);
      expect(await finalizeWithMonthlyCoverage.json()).toMatchObject({ warning_acknowledged: false, ledger_warning: [] });

      database.client.run("UPDATE student_enrollments SET effective_from = '2025-07-01' WHERE id = 1");
      const finalizeWithoutLedgerAck = await app.handle(new Request("http://local/api/attendance-corrections/periods/finalize", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_date: "2026-05-03", reason: "Daily review completed", confirmation: "FINALIZE_ATTENDANCE_PERIOD" }) }));
      expect(finalizeWithoutLedgerAck.status).toBe(409);
      expect(await finalizeWithoutLedgerAck.json()).toMatchObject({ detail: { requires_acknowledgement: true, ledger_warning: [{ class_id: 1, month: "2026-05", ledger_state: "MISSING" }] } });
      const finalizeWithLedgerAck = await app.handle(new Request("http://local/api/attendance-corrections/periods/finalize", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_date: "2026-05-03", reason: "Daily review completed", confirmation: "FINALIZE_ATTENDANCE_PERIOD", acknowledge_ledger_warning: true }) }));
      expect(finalizeWithLedgerAck.status).toBe(200);
      expect(await finalizeWithLedgerAck.json()).toMatchObject({ warning_acknowledged: true, ledger_warning: [{ class_id: 1, ledger_state: "MISSING" }] });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("runs correction draft, submit, approve, and terminal replay", async () => {
    const path = `/tmp/operatoros-correction-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-correction-audit-${process.pid}` } });
    try {
      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) })); const staff = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };
      const create = await app.handle(new Request("http://local/api/attendance-corrections", { method: "POST", headers: { ...staff, "content-type": "application/json" }, body: JSON.stringify({ attendance_id: 2, proposed_status: "on-time", proposed_check_in: "07:30", proposed_check_out: "16:00", reason_code: "DEVICE_FAULT", explanation: "Device failed to register the departure scan." }) }));
      expect(create.status).toBe(200); const id = (await create.json() as any).id;
      expect((await app.handle(new Request(`http://local/api/attendance-corrections/${id}/submit`, { method: "POST", headers: staff }))).status).toBe(200);
      const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const admin = { cookie: `astyx_session=${cookie(adminLogin)}`, origin: "http://localhost:5173" };
      const approved = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(approved.status).toBe(200); expect((await approved.json() as any).state).toBe("APPROVED");
      const duplicate = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(duplicate.status).toBe(409);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("records the prior override on self-confirm and rejects a stale decision", async () => {
    const path = `/tmp/operatoros-self-confirm-history-${process.pid}-${Date.now()}.db`; createAttendanceReadFixture(path, "corrections"); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-self-confirm-history-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const create = (status: string) => app.handle(new Request("http://local/api/attendance-corrections", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ attendance_id: 1, proposed_status: status, reason_code: "VERIFIED_SOURCE", explanation: "Class record verified by the operator." }) }));
      const selfConfirm = (id: number, version: number) => app.handle(new Request(`http://local/api/attendance-corrections/${id}/self-confirm`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expected_version: version, confirmation: "CONFIRM_CORRECTION", confirmation_note: "I verified the source record." }) }));
      const first = await (await create("absent")).json() as any;
      expect((await selfConfirm(first.id, 1)).status).toBe(200);
      const firstHistory = database.client.query("SELECT previous_status, new_status, previous_values, new_values, reviewed_by FROM attendance_override_history WHERE attendance_id = 1 ORDER BY id").get() as any;
      expect(firstHistory).toMatchObject({ previous_status: "on-time", new_status: "absent", reviewed_by: "golden-admin" });
      expect(JSON.parse(firstHistory.previous_values)).toMatchObject({ status: "on-time", check_in: "07:30" });
      expect(JSON.parse(firstHistory.new_values)).toMatchObject({ status: "absent" });

      const second = await (await create("late")).json() as any;
      const changed = await app.handle(new Request("http://local/api/review/attendance/1/override", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ override_status: "on-time", note: "A newer verified correction." }) }));
      expect(changed.status).toBe(200);
      expect((await selfConfirm(second.id, 1)).status).toBe(409);
      expect(database.client.query("SELECT override_status FROM attendance_overrides WHERE attendance_id = 1").get()).toMatchObject({ override_status: "on-time" });
      expect(database.client.query("SELECT state FROM attendance_correction_requests WHERE id = ?").get(second.id)).toMatchObject({ state: "STALE" });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("keeps early-departure policy, excuse, and history behavior", async () => {
    const path = `/tmp/operatoros-departure-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-departure-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const created = await app.handle(new Request("http://local/api/attendance/departure-policies", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jenjang: "SMP", weekday: 5, dismissal_time: "16:30", grace_period_minutes: 15, effective_from: "2026-07-01", change_reason: "Attendance policy test" }) }));
      expect(created.status).toBe(201); expect((await created.json() as any).dismissal_time).toBe("16:30");
      const departures = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-01/departures", { headers: auth }));
      expect(departures.status).toBe(200); expect((await departures.json() as any).departures[0]).toMatchObject({ classification: "EARLY_DEPARTURE", minutes_early: 30 });
      const recorded = await app.handle(new Request("http://local/api/attendance/1/departure-excuses", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ reason_code: "SCHOOL_EVENT", explanation: "Approved school event" }) }));
      expect(recorded.status).toBe(201); const excuseId = (await recorded.json() as any).id;
      const history = await app.handle(new Request("http://local/api/attendance/1/departure-history", { headers: auth }));
      expect((await history.json() as any).audit_trail[0]).toMatchObject({ action: "RECORDED", reason_code: "SCHOOL_EVENT" });
      expect((await (await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-01/departures", { headers: auth }))).json() as any).departures[0].classification).toBe("EXCUSED_EARLY_DEPARTURE");
      const revoked = await app.handle(new Request(`http://local/api/attendance/1/departure-excuses/${excuseId}/revoke`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ revocation_reason: "Event ended" }) }));
      expect(revoked.status).toBe(200); expect((await revoked.json() as any).state).toBe("REVOKED");
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("supports follow-up candidate discovery and case workflow", async () => {
    const path = `/tmp/operatoros-followups-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-followups-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const candidates = await app.handle(new Request("http://local/api/attendance/followups/candidates?date_from=2026-08-01&date_to=2026-08-02", { headers: auth }));
      expect(candidates.status).toBe(200); expect((await candidates.json() as any).items.map((item: any) => item.exception_kind)).toEqual(expect.arrayContaining(["LATE_ARRIVAL", "MISSING_CHECKOUT"]));
      const created = await app.handle(new Request("http://local/api/attendance/followups", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ exception_key: "LATE_ARRIVAL:student:2026-08-01:1", exception_kind: "LATE_ARRIVAL", attendance_id: 1, exception_date: "2026-08-01", source_snapshot: { summary: "Late arrival" } }) }));
      const createdResponseBody = await created.json() as any; expect(created.status, JSON.stringify(createdResponseBody)).toBe(200); const caseBody = createdResponseBody; expect(caseBody).toMatchObject({ status: "OPEN", version: 1, exception_kind: "LATE_ARRIVAL" });
      const acknowledged = await app.handle(new Request(`http://local/api/attendance/followups/${caseBody.id}/acknowledge`, { method: "POST", headers: auth }));
      expect(acknowledged.status).toBe(200); expect((await acknowledged.json() as any)).toMatchObject({ status: "ACKNOWLEDGED", version: 2 });
      const note = await app.handle(new Request(`http://local/api/attendance/followups/${caseBody.id}/notes`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ body: "Contacted the class teacher" }) }));
      expect(note.status).toBe(200); expect((await note.json() as any).body).toBe("Contacted the class teacher");
      const started = await app.handle(new Request(`http://local/api/attendance/followups/${caseBody.id}/start`, { method: "POST", headers: auth }));
      expect(started.status).toBe(200);
      const resolved = await app.handle(new Request(`http://local/api/attendance/followups/${caseBody.id}/resolve`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ resolution_code: "EXPLAINED", resolution_note: "Teacher confirmed the event", version: 3 }) }));
      const resolvedBody = await resolved.json() as any; expect(resolved.status, JSON.stringify(resolvedBody)).toBe(200); expect(resolvedBody.status).toBe("RESOLVED");
      const history = await app.handle(new Request(`http://local/api/attendance/followups/${caseBody.id}/history`, { headers: auth }));
      expect((await history.json() as any).history.length).toBeGreaterThanOrEqual(3);
      const metrics = await app.handle(new Request("http://local/api/attendance/followups/metrics/summary", { headers: auth }));
      const metricsBody = await metrics.json() as any; expect(metrics.status).toBe(200); expect(metricsBody.by_class).toBeInstanceOf(Object); expect(metricsBody.by_class).not.toBeInstanceOf(Array);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
