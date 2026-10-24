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
      const rawBefore = database.client.query("SELECT status, check_in, check_out FROM attendance WHERE id = 2").get();
      const fabricatedTime = await app.handle(new Request("http://local/api/attendance-corrections", { method: "POST", headers: { ...staff, "content-type": "application/json" }, body: JSON.stringify({ attendance_id: 2, proposed_status: "sakit", proposed_check_in: "07:30", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "P2-B September 2026 attendance book, page 1." }) }));
      expect(fabricatedTime.status).toBe(400);
      const create = await app.handle(new Request("http://local/api/attendance-corrections", { method: "POST", headers: { ...staff, "content-type": "application/json" }, body: JSON.stringify({ attendance_id: 2, proposed_status: "sakit", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "P2-B September 2026 attendance book, page 1." }) }));
      expect(create.status).toBe(200); const id = (await create.json() as any).id;
      expect((await app.handle(new Request(`http://local/api/attendance-corrections/${id}/submit`, { method: "POST", headers: staff }))).status).toBe(200);
      const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const admin = { cookie: `astyx_session=${cookie(adminLogin)}`, origin: "http://localhost:5173" };
      const approved = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(approved.status).toBe(200); expect((await approved.json() as any).state).toBe("APPROVED");
      expect(database.client.query("SELECT override_status, reviewed_by, note FROM attendance_overrides WHERE attendance_id = 2").get()).toMatchObject({ override_status: "sakit", reviewed_by: "golden-admin", note: "P2-B September 2026 attendance book, page 1." });
      expect(database.client.query("SELECT status, check_in, check_out FROM attendance WHERE id = 2").get()).toEqual(rawBefore);
      expect(database.client.query("SELECT previous_status, new_status, reviewed_by, note FROM attendance_override_history WHERE attendance_id = 2").get()).toMatchObject({ new_status: "sakit", reviewed_by: "golden-admin", note: "P2-B September 2026 attendance book, page 1." });
      const duplicate = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(duplicate.status).toBe(409);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("requires a structured paper-book source and rejects unknown status before writes", async () => {
    const path = `/tmp/operatoros-paper-book-override-${process.pid}-${Date.now()}.db`; createAttendanceReadFixture(path, "corrections"); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-paper-book-override-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const postOverride = (body: unknown) => app.handle(new Request("http://local/api/review/attendance/1/override", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
      const invalidBefore = Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count);
      expect((await postOverride({ override_status: "sakit", note: "P2-B September page 1" })).status).toBe(400);
      expect((await postOverride({ override_status: "presentish", note: "Unsupported status" })).status).toBe(400);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count)).toBe(invalidBefore);
      database.client.run("CREATE TRIGGER fail_paper_book_override_audit BEFORE INSERT ON operations_audit_events WHEN NEW.operation = 'PAPER_BOOK_ATTENDANCE_OVERRIDE' BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
      const paperBookOverride = { override_status: "alfa", note: "P2-B September 2026 attendance book, page 1.", source: "PAPER_BOOK_VERIFICATION" };
      expect((await postOverride(paperBookOverride)).status).toBe(409);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_overrides").get() as any).count)).toBe(invalidBefore);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM attendance_override_history WHERE attendance_id = 1").get() as any).count)).toBe(0);
      database.client.run("DROP TRIGGER fail_paper_book_override_audit");
      const rawBefore = database.client.query("SELECT status, check_in, check_out FROM attendance WHERE id = 1").get();
      expect((await postOverride(paperBookOverride)).status).toBe(200);
      expect(database.client.query("SELECT status, check_in, check_out FROM attendance WHERE id = 1").get()).toEqual(rawBefore);
      expect(database.client.query("SELECT previous_status, new_status, reviewed_by, note, timestamp FROM attendance_override_history WHERE attendance_id = 1").get()).toMatchObject({ new_status: "alfa", reviewed_by: "golden-admin", note: "P2-B September 2026 attendance book, page 1." });
      const audit = database.client.query("SELECT actor_id, occurred_at, capability, reason, metadata FROM operations_audit_events WHERE operation = 'PAPER_BOOK_ATTENDANCE_OVERRIDE'").get() as any;
      expect(audit).toMatchObject({ actor_id: "golden-admin", occurred_at: expect.any(String), capability: "manage_attendance", reason: paperBookOverride.note });
      expect(JSON.parse(audit.metadata)).toMatchObject({ source_workflow: "PAPER_BOOK_VERIFICATION", attendance_date: "2026-08-04", student_id: 9601, before: { status: "on-time" }, after: { status: "alfa" } });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("reports effective dated S/I/A separately from teacher-book ledger totals", async () => {
    const path = `/tmp/operatoros-paper-book-student-summary-${process.pid}-${Date.now()}.db`;
    createAttendanceReadFixture(path, "corrections");
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-paper-book-student-summary-audit-${process.pid}` } });
    try {
      database.client.run("UPDATE attendance_overrides SET override_status = 'sakit' WHERE attendance_id = 1");
      database.client.run("INSERT INTO absence_reasons (student_id,class_name,month,year,sakit,izin,alfa,entered_by,entered_at,updated_at) VALUES (9601,'7A',8,2026,4,2,1,'golden-admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const summary = await app.handle(new Request("http://local/api/students/9601/attendance-summary?month=8&year=2026", { headers: auth }));
      expect(summary.status).toBe(200);
      expect(await summary.json()).toMatchObject({ sakit: 1, izin: 0, alfa: 0, reported_sakit: 4, reported_izin: 2, reported_alfa: 1, breakdown: [{ date: "2026-08-04", status: "sakit", scan_masuk: "07:30" }] });
      const history = await app.handle(new Request("http://local/api/students/9601/monthly-history", { headers: auth }));
      expect(await history.json()).toMatchObject({ history: [{ present: 0, late: 0, absent: 0, sakit: 1, izin: 0, alfa: 0 }] });
      expect(database.client.query("SELECT status, check_in FROM attendance WHERE id = 1").get()).toEqual({ status: "late", check_in: "07:30:00" });
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

      const mismatchedRevoke = await app.handle(new Request(`http://local/api/attendance/999/departure-excuses/${excuseId}/revoke`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ revocation_reason: "Mismatched target" }) }));
      expect(mismatchedRevoke.status).toBe(400);
      expect((await mismatchedRevoke.json() as any).detail.code).toBe("EARLY_DEPARTURE_EXCUSE_NOT_ACTIVE");

      database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7B','B',1)");
      database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9002,'Other Student','SMP','7B')");
      database.client.run("INSERT INTO attendance (id,student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (3,9002,'2026-08-01','07:40:00','16:00:00',25,'calculated',0,'late')");
      database.client.run("INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from) VALUES (2,1,1,'HOMEROOM_TEACHER',1,'golden-admin','2026-07-01')");
      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
      const staffAuth = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };
      const assignedHistory = await app.handle(new Request("http://local/api/attendance/1/departure-history", { headers: staffAuth }));
      expect(assignedHistory.status).toBe(200);
      const unassignedHistory = await app.handle(new Request("http://local/api/attendance/3/departure-history", { headers: staffAuth }));
      expect(unassignedHistory.status).toBe(403);
      expect((await unassignedHistory.json() as any).detail.code).toBe("EARLY_DEPARTURE_CLASS_SCOPE_FORBIDDEN");

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
  it("enforces class scope and teacher assignment effective dates across attendance review and entries", async () => {
    const path = `/tmp/operatoros-review-scoping-${process.pid}-${Date.now()}.db`;
    createAttendanceReadFixture(path, "corrections");
    const database = openDatabase(path);
    database.client.run("UPDATE student_enrollments SET effective_from = '2026-01-01' WHERE student_id = 9601");
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-review-scoping-audit-${process.pid}` } });
    try {
      const adminLogin = await app.handle(new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
      }));
      const adminAuth = { cookie: `astyx_session=${cookie(adminLogin)}`, origin: "http://localhost:5173" };

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const staffAuth = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };

      // 1. GET /api/review/classes
      const staffClassesRes = await app.handle(new Request("http://local/api/review/classes?academic_year_id=1", { headers: staffAuth }));
      expect(staffClassesRes.status).toBe(200);
      const staffClasses = await staffClassesRes.json() as any;
      expect(staffClasses.classes).toEqual([{ id: 1, name: "7A" }]);

      const adminClassesRes = await app.handle(new Request("http://local/api/review/classes?academic_year_id=1", { headers: adminAuth }));
      expect(adminClassesRes.status).toBe(200);
      const adminClasses = await adminClassesRes.json() as any;
      expect(adminClasses.classes.map((c: any) => c.name)).toContain("7A");
      expect(adminClasses.classes.map((c: any) => c.name)).toContain("7B");

      // 2. GET /api/review/attendance
      const staffUnassignedAtt = await app.handle(new Request("http://local/api/review/attendance?academic_year_id=1&academic_class_id=2&date=2026-08-05", { headers: staffAuth }));
      expect(staffUnassignedAtt.status).toBe(403);

      const staffAssignedAtt = await app.handle(new Request("http://local/api/review/attendance?academic_year_id=1&academic_class_id=1&date=2026-08-04", { headers: staffAuth }));
      expect(staffAssignedAtt.status).toBe(200);
      expect((await staffAssignedAtt.json() as any).class_name).toBe("7A");

      const adminUnassignedAtt = await app.handle(new Request("http://local/api/review/attendance?academic_year_id=1&academic_class_id=2&date=2026-08-05", { headers: adminAuth }));
      expect(adminUnassignedAtt.status).toBe(200);

      // 3. GET /api/review/attendance/:attendance_id/history
      const staffUnassignedHist = await app.handle(new Request("http://local/api/review/attendance/2/history", { headers: staffAuth }));
      expect(staffUnassignedHist.status).toBe(403);

      const staffAssignedHist = await app.handle(new Request("http://local/api/review/attendance/1/history", { headers: staffAuth }));
      expect(staffAssignedHist.status).toBe(200);

      const adminHist = await app.handle(new Request("http://local/api/review/attendance/2/history", { headers: adminAuth }));
      expect(adminHist.status).toBe(200);

      // 4. POST /api/attendance/classes/:class_id/dates/:date_val/entries
      // Staff assignment on class 1 is effective from 2026-07-01
      const staffOutsideDate = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-06-01/entries", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ student_id: 9601, status: "on-time" }] }),
      }));
      expect(staffOutsideDate.status).toBe(403);

      const staffInsideDate = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-08-04/entries", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ student_id: 9601, status: "on-time" }] }),
      }));
      expect(staffInsideDate.status).toBe(200);

      const adminOutsideDate = await app.handle(new Request("http://local/api/attendance/classes/1/dates/2026-06-01/entries", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ student_id: 9601, status: "on-time" }] }),
      }));
      expect(adminOutsideDate.status).toBe(200);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("enforces teacher class assignment scope on attendance corrections", async () => {
    const path = `/tmp/operatoros-correction-scope-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    database.client.run("INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'7B','B',1)");
    database.client.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (9002,'Other Class Student','SMP','7B')");
    database.client.run("INSERT INTO student_enrollments (student_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (9002,1,1,2,'7B',1,'2026-07-01','ACTIVE')");
    database.client.run("INSERT INTO teacher_class_assignments (user_id,academic_year_id,academic_class_id,class_role,active,assigned_by,effective_from) VALUES (2,1,1,'HOMEROOM_TEACHER',1,'golden-admin','2026-07-01')");
    database.client.run("INSERT INTO attendance (id,student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (3,9002,'2026-08-02','07:35:00',NULL,0,'none',0,'incomplete')");
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-correction-scope-audit-${process.pid}` } });
    try {
      const staffLogin = await app.handle(new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }),
      }));
      const staffAuth = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };

      const adminLogin = await app.handle(new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }),
      }));
      const adminAuth = { cookie: `astyx_session=${cookie(adminLogin)}`, origin: "http://localhost:5173" };

      // 1. Missing attendance record -> 404
      const missingAtt = await app.handle(new Request("http://local/api/attendance-corrections", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ attendance_id: 99999, proposed_status: "sakit", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "Missing attendance record." }),
      }));
      expect(missingAtt.status).toBe(404);

      // 2. Unassigned class attendance record (attendance 3 belongs to student 9002 in class 7B) -> 403 for staff
      const unassignedCreate = await app.handle(new Request("http://local/api/attendance-corrections", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ attendance_id: 3, proposed_status: "sakit", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "Unassigned class correction attempt." }),
      }));
      expect(unassignedCreate.status).toBe(403);

      // 3. Assigned class attendance record (attendance 2 belongs to student 9001 in class 7A) -> 200 for staff
      const assignedCreate = await app.handle(new Request("http://local/api/attendance-corrections", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ attendance_id: 2, proposed_status: "sakit", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "Class 7A valid correction draft." }),
      }));
      expect(assignedCreate.status).toBe(200);
      const staffReqId = (await assignedCreate.json() as any).id;

      // 4. Admin creates correction request on class 7B (attendance 3) -> 200
      const adminCreate = await app.handle(new Request("http://local/api/attendance-corrections", {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ attendance_id: 3, proposed_status: "izin", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "Admin correction for 7B." }),
      }));
      expect(adminCreate.status).toBe(200);
      const adminReqId = (await adminCreate.json() as any).id;

      // 5. GET /api/attendance-corrections:
      // Staff should only see requests for assigned class or requested by staff
      const staffList = await app.handle(new Request("http://local/api/attendance-corrections", { headers: staffAuth }));
      expect(staffList.status).toBe(200);
      const staffListJson = await staffList.json() as any[];
      const staffListIds = staffListJson.map((r) => r.id);
      expect(staffListIds).toContain(staffReqId);
      expect(staffListIds).not.toContain(adminReqId);

      // Admin sees both
      const adminList = await app.handle(new Request("http://local/api/attendance-corrections", { headers: adminAuth }));
      expect(adminList.status).toBe(200);
      const adminListJson = await adminList.json() as any[];
      const adminListIds = adminListJson.map((r) => r.id);
      expect(adminListIds).toContain(staffReqId);
      expect(adminListIds).toContain(adminReqId);

      // 6. GET /api/attendance-corrections/:request_id:
      // Staff accessing unassigned request adminReqId -> 403
      const staffGetUnassigned = await app.handle(new Request(`http://local/api/attendance-corrections/${adminReqId}`, { headers: staffAuth }));
      expect(staffGetUnassigned.status).toBe(403);

      // Staff accessing assigned request staffReqId -> 200
      const staffGetAssigned = await app.handle(new Request(`http://local/api/attendance-corrections/${staffReqId}`, { headers: staffAuth }));
      expect(staffGetAssigned.status).toBe(200);

      // Non-existent request -> 404
      const notFoundReq = await app.handle(new Request("http://local/api/attendance-corrections/99999", { headers: staffAuth }));
      expect(notFoundReq.status).toBe(404);

      // 7. Assignment expiration check on submit:
      // Expire teacher assignment so date 2026-08-02 is outside assignment window
      database.client.run("UPDATE teacher_class_assignments SET effective_to = '2026-08-01' WHERE user_id = 2 AND academic_class_id = 1");
      const expiredSubmit = await app.handle(new Request(`http://local/api/attendance-corrections/${staffReqId}/submit`, {
        method: "POST",
        headers: staffAuth,
      }));
      expect(expiredSubmit.status).toBe(403);

      // Restore active assignment window
      database.client.run("UPDATE teacher_class_assignments SET effective_to = NULL WHERE user_id = 2 AND academic_class_id = 1");
      const validSubmit = await app.handle(new Request(`http://local/api/attendance-corrections/${staffReqId}/submit`, {
        method: "POST",
        headers: staffAuth,
      }));
      expect(validSubmit.status).toBe(200);

      // 8. Cancellation scoping:
      // Create another correction on attendance 1 (student 9001 in class 7A, date 2026-08-01)
      const cancelDraft = await app.handle(new Request("http://local/api/attendance-corrections", {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ attendance_id: 1, proposed_status: "sakit", reason_code: "PAPER_BOOK_VERIFICATION", explanation: "Draft to cancel." }),
      }));
      expect(cancelDraft.status).toBe(200);
      const cancelReqId = (await cancelDraft.json() as any).id;

      // Expire assignment before 2026-08-01
      database.client.run("UPDATE teacher_class_assignments SET effective_to = '2026-07-15' WHERE user_id = 2 AND academic_class_id = 1");
      const expiredCancel = await app.handle(new Request(`http://local/api/attendance-corrections/${cancelReqId}/cancel`, {
        method: "POST",
        headers: staffAuth,
      }));
      expect(expiredCancel.status).toBe(403);

      // Restore active assignment window
      database.client.run("UPDATE teacher_class_assignments SET effective_to = NULL WHERE user_id = 2 AND academic_class_id = 1");
      const validCancel = await app.handle(new Request(`http://local/api/attendance-corrections/${cancelReqId}/cancel`, {
        method: "POST",
        headers: staffAuth,
      }));
      expect(validCancel.status).toBe(200);
      expect((await validCancel.json() as any).state).toBe("CANCELLED");

      // 9. Staff attempting to approve -> 403 (RBAC)
      const staffApprove = await app.handle(new Request(`http://local/api/attendance-corrections/${staffReqId}/approve`, {
        method: "POST",
        headers: { ...staffAuth, "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }),
      }));
      expect(staffApprove.status).toBe(403);

      // Admin approves -> 200
      const adminApprove = await app.handle(new Request(`http://local/api/attendance-corrections/${staffReqId}/approve`, {
        method: "POST",
        headers: { ...adminAuth, "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }),
      }));
      expect(adminApprove.status).toBe(200);
      expect((await adminApprove.json() as any).state).toBe("APPROVED");
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
