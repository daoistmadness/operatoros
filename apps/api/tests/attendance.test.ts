import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys, importlib.util",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db()",
    "from argon2 import PasswordHasher; ph = PasswordHasher(); db = sqlite3.connect(path)",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('golden-admin', ph.hash('golden-admin-pass-1'), 'admin'), ('golden-staff', ph.hash('golden-staff-pass-1'), 'staff')])",
    "db.execute(\"INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('2026/2027', '2026-07-01', '2027-06-30', 'active', 0)\")",
    "db.execute(\"INSERT INTO jenjangs (name, code, level, active) VALUES ('SMP', 'SMP', 'junior', 1)\")",
    "db.execute(\"INSERT INTO academic_programs (jenjang_id, name, active) VALUES (1, 'SMP Program', 1)\")",
    "db.execute(\"INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (1, 1, 'Grade 7', 1, 1)\")",
    "db.execute(\"INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (1, 1, '7A', '', 1)\")",
    "db.execute(\"INSERT INTO students (id, name, jenjang, class_name) VALUES (9001, 'Attendance Student', 'SMP', '7A')\")",
    "db.execute(\"INSERT INTO student_enrollments (student_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (9001, 1, 1, 1, '7A', 1, '2026-07-01', 'ACTIVE')\")",
    "db.executemany(\"INSERT INTO attendance (student_id, date, check_in, check_out, late_duration, late_source, is_absent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)\", [(9001, '2026-08-01', '07:40:00', '16:00:00', 25, 'calculated', 0, 'late'), (9001, '2026-08-02', '07:30:00', None, 0, 'none', 0, 'incomplete')])",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("attendance parity slices", () => {
  it("keeps overrides append-only and blocks mutation after finalization", async () => {
    const path = `/tmp/operatoros-attendance-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-attendance-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}` };
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
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("runs correction draft, submit, approve, and terminal replay", async () => {
    const path = `/tmp/operatoros-correction-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-correction-audit-${process.pid}` } });
    try {
      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) })); const staff = { cookie: `astyx_session=${cookie(staffLogin)}` };
      const create = await app.handle(new Request("http://local/api/attendance-corrections", { method: "POST", headers: { ...staff, "content-type": "application/json" }, body: JSON.stringify({ attendance_id: 2, proposed_status: "on-time", proposed_check_in: "07:30", proposed_check_out: "16:00", reason_code: "DEVICE_FAULT", explanation: "Device failed to register the departure scan." }) }));
      expect(create.status).toBe(200); const id = (await create.json() as any).id;
      expect((await app.handle(new Request(`http://local/api/attendance-corrections/${id}/submit`, { method: "POST", headers: staff }))).status).toBe(200);
      const adminLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const admin = { cookie: `astyx_session=${cookie(adminLogin)}` };
      const approved = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(approved.status).toBe(200); expect((await approved.json() as any).state).toBe("APPROVED");
      const duplicate = await app.handle(new Request(`http://local/api/attendance-corrections/${id}/approve`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "APPROVE_ATTENDANCE_CORRECTION" }) }));
      expect(duplicate.status).toBe(409);
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);

  it("keeps early-departure policy, excuse, and history behavior", async () => {
    const path = `/tmp/operatoros-departure-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-departure-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}` };
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
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) })); const auth = { cookie: `astyx_session=${cookie(login)}` };
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
