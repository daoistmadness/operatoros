import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seedAcademic(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from core import database as core_database; from sqlalchemy import create_engine; core_database.engine.dispose(); core_database.engine = create_engine(f'sqlite:///{path}'); core_database.SessionLocal.configure(bind=core_database.engine)",
    "import importlib; from pathlib import Path as P; [importlib.import_module('models.' + f.stem) for f in sorted(P('backend/src/models').glob('*.py')) if f.stem != '__init__']; core_database.init_db()",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("core CRUD parity slices", () => {
  it("keeps academic hierarchy, legacy students, canonical students, and enrollments separate", async () => {
    const path = `/tmp/operatoros-core-${process.pid}-${Date.now()}.db`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-core-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const years = await app.handle(new Request("http://local/api/academic-masters/academic-years", { headers: auth }));
      expect(years.status).toBe(200);
      expect((await years.json()) as unknown[]).toHaveLength(3);
      const students = await app.handle(new Request("http://local/api/students?page=1&page_size=2"));
      expect(students.status).toBe(200);
      expect(await students.json()).toMatchObject({ total: 4, page_size: 2 });
      const masters = await app.handle(new Request("http://local/api/student-masters?page=1&page_size=10", { headers: auth }));
      expect(masters.status).toBe(200);
      expect(await masters.json()).toMatchObject({ total: 2, page_size: 10 });
      database.client.run("INSERT INTO student_import_sessions (id, session_uuid, import_type, status, provenance_status, created_by, expires_at, source_filename, source_file_checksum, row_count, selected_row_count, applied_action_count, rollback_state, metadata, schema_version) VALUES (?, ?, 'STUDENT_DATA_UPDATE', 'COMMITTED', 'LEGACY_PROVENANCE_UNAVAILABLE', ?, ?, ?, ?, 0, 0, 0, 'NOT_AVAILABLE', '{}', '1')", ["legacy-import-session", "legacy-import-uuid", "golden-admin", "2026-08-27T00:00:00", "legacy.xlsx", "a".repeat(64)]);
      const legacyRollbackPreview = await app.handle(new Request("http://local/api/student-import-sessions/legacy-import-session/rollback-preview", { method: "POST", headers: auth }));
      expect(legacyRollbackPreview.status).toBe(200);
      expect(await legacyRollbackPreview.json()).toMatchObject({ rollback_state: "NOT_AVAILABLE", is_rollbackable: false, required_capability: "rollback_import_session" });
      database.client.run("INSERT INTO student_import_sessions (id, session_uuid, import_type, status, provenance_status, created_by, expires_at, source_filename, source_file_checksum, row_count, selected_row_count, applied_action_count, rollback_state, metadata, schema_version) VALUES (?, ?, 'STUDENT_DATA_UPDATE', 'COMMITTED', 'COMPLETE_ACTION_PROVENANCE', ?, ?, ?, ?, 0, 0, 0, 'AVAILABLE', '{}', '1')", ["committed-import-session", "committed-import-uuid", "golden-admin", "2026-08-27T00:00:00", "current.xlsx", "b".repeat(64)]);
      const rollbackPreview = await app.handle(new Request("http://local/api/student-import-sessions/committed-import-session/rollback-preview", { method: "POST", headers: auth }));
      expect(rollbackPreview.status).toBe(200);
      expect(await rollbackPreview.json()).toMatchObject({ rollback_state: "PREVIEWED", total_applied_actions: 0, eligible_actions: 0 });
      expect((database.client.query("SELECT rollback_state FROM student_import_sessions WHERE id = ?").get("committed-import-session") as any).rollback_state).toBe("PREVIEWED");
      database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, ?, ?, 'active')", ["rollback-student", "Rollback Student", "rollback student"]);
      database.client.run("INSERT INTO student_import_sessions (id, session_uuid, import_type, status, provenance_status, created_by, expires_at, source_filename, source_file_checksum, row_count, selected_row_count, applied_action_count, rollback_state, metadata, schema_version) VALUES (?, ?, 'STUDENT_DATA_UPDATE', 'COMMITTED', 'COMPLETE_ACTION_PROVENANCE', ?, ?, ?, ?, 1, 1, 1, 'AVAILABLE', '{}', '1')", ["rollback-commit-session", "rollback-commit-uuid", "golden-admin", "2026-08-27T00:00:00", "current.xlsx", "c".repeat(64)]);
      database.client.run("INSERT INTO student_import_applied_actions (session_id, source_row_number, action_sequence, action_type, entity_type, entity_id, entity_reference, operation_id, applied_by, after_state, after_state_checksum, dependency_checkpoint, compensation_type, rollback_eligibility, rollback_state, metadata, schema_version) VALUES (?, 1, 1, 'CREATE_STUDENT_MASTER', 'STUDENT_MASTER', ?, ?, ?, ?, ?, ?, '{}', 'STATUS_INACTIVE', 'ELIGIBLE', 'NOT_REQUESTED', '{}', '1')", ["rollback-commit-session", "rollback-student", "rollback-student", "rollback-action", "golden-admin", JSON.stringify({ student_status: "active" }), "a".repeat(64)]);
      const rollbackCommitPreview = await app.handle(new Request("http://local/api/student-import-sessions/rollback-commit-session/rollback-preview", { method: "POST", headers: auth }));
      const rollbackCommitPreviewBody = await rollbackCommitPreview.json() as any;
      expect(rollbackCommitPreview.status).toBe(200);
      expect(rollbackCommitPreviewBody).toMatchObject({ eligible_actions: 1, is_rollbackable: true });
      const rollbackCommit = await app.handle(new Request("http://local/api/student-import-sessions/rollback-commit-session/rollback", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_checksum: rollbackCommitPreviewBody.preview_checksum, reason: "Undo import", confirmation_value: "ROLLBACK_SESSION_rollback", idempotency_token: "rollback-token-1" }) }));
      expect(rollbackCommit.status).toBe(200);
      expect(await rollbackCommit.json()).toMatchObject({ rollback_state: "APPLIED", compensated_action_count: 1, idempotent_replay: false });
      expect((database.client.query("SELECT student_status FROM student_masters WHERE id = ?").get("rollback-student") as any).student_status).toBe("inactive");
      expect((database.client.query("SELECT COUNT(*) AS count FROM student_import_applied_actions WHERE session_id = ? AND action_type = 'COMPENSATE_CREATE_STUDENT_MASTER'").get("rollback-commit-session") as any).count).toBe(1);
      const rollbackReplay = await app.handle(new Request("http://local/api/student-import-sessions/rollback-commit-session/rollback", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ preview_checksum: rollbackCommitPreviewBody.preview_checksum, reason: "Undo import", confirmation_value: "ROLLBACK_SESSION_rollback", idempotency_token: "rollback-token-1" }) }));
      expect(rollbackReplay.status).toBe(200);
      expect(await rollbackReplay.json()).toMatchObject({ idempotent_replay: true, status: "COMPLETED" });
      const enrollment = await app.handle(new Request("http://local/api/student-enrollments/student/11111111-1111-1111-1111-111111111111", { headers: auth }));
      expect(enrollment.status).toBe(200);
      expect(await enrollment.json()).toHaveLength(2);
      const staff = await app.handle(new Request("http://local/api/staff?status=ALL", { headers: auth }));
      expect(staff.status).toBe(200);
      expect(await staff.json()).toMatchObject({ total: 0, counts: { ALL: 0 } });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("rejects grades whose program belongs to another jenjang", async () => {
    const path = `/tmp/operatoros-core-grade-scope-${process.pid}-${Date.now()}.db`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-core-grade-scope-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const first = database.client.query("SELECT id FROM academic_programs ORDER BY id LIMIT 1").get() as { id: number };
      const secondJenjang = await app.handle(new Request("http://local/api/academic-masters/jenjangs", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ code: "LOWER", name: "Lower", level: "primary", active: true }) }));
      expect(secondJenjang.status).toBe(201);
      const secondJenjangId = (await secondJenjang.json() as { id: number }).id;
      const secondProgram = await app.handle(new Request("http://local/api/academic-masters/programs", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jenjang_id: secondJenjangId, name: "Lower Main", active: true }) }));
      expect(secondProgram.status).toBe(201);
      const secondProgramId = (await secondProgram.json() as { id: number }).id;

      const mismatch = await app.handle(new Request("http://local/api/academic-masters/grades", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jenjang_id: secondJenjangId, program_id: first.id, name: "Rejected Grade", sequence_number: 1, active: true }) }));
      expect(mismatch.status).toBe(422);
      expect(database.client.query("SELECT COUNT(*) AS count FROM academic_grades WHERE name = 'Rejected Grade'").get()).toEqual({ count: 0 });

      const valid = await app.handle(new Request("http://local/api/academic-masters/grades", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jenjang_id: secondJenjangId, program_id: secondProgramId, name: "Lower Grade 1", sequence_number: 1, active: true }) }));
      expect(valid.status).toBe(201);
      expect(await valid.json()).toMatchObject({ jenjang_id: secondJenjangId, program_id: secondProgramId, name: "Lower Grade 1" });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("creates grade batches atomically with canonical parents and per-grade audit rows", async () => {
    const path = `/tmp/operatoros-core-grade-batch-${process.pid}-${Date.now()}.db`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-core-grade-batch-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const jenjangId = Number((database.client.query("SELECT id FROM jenjangs ORDER BY id LIMIT 1").get() as any).id);
      const createProgram = (name: string) => Number(database.client.run("INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, ?, 1)", [jenjangId, name]).lastInsertRowid);
      const post = (program_id: number, grades: unknown[]) => app.handle(new Request("http://local/api/academic-masters/grades/bulk", {
        method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ program_id, grades }),
      }));
      const assertBatch = async (programName: string, names: string[]) => {
        const programId = createProgram(programName);
        const before = Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count);
        const response = await post(programId, names.map((name, index) => ({ name, sequence_number: index + 1 })));
        expect(response.status).toBe(201);
        const created = await response.json() as any[];
        expect(created.map((grade) => [grade.name, grade.sequence_number, grade.jenjang_id, grade.program_id])).toEqual(names.map((name, index) => [name, index + 1, jenjangId, programId]));
        const ids = created.map((grade) => String(grade.id));
        const auditRows = database.client.query(`SELECT entity_id, action, after_data FROM academic_master_audit WHERE entity_type = 'grade' AND entity_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(...ids) as any[];
        expect(auditRows).toHaveLength(names.length);
        expect(auditRows.map((audit) => [audit.action, JSON.parse(audit.after_data).name])).toEqual(names.map((name) => ["CREATE", name]));
        expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count) - before).toBe(names.length);
        return { programId, created };
      };

      await assertBatch("Quick Primary", ["P1", "P2", "P3", "P4", "P5", "P6"]);
      await assertBatch("Quick Secondary", ["S1", "S2", "S3"]);
      const homeschooling = await assertBatch("Quick Homeschooling", ["HSP1", "HSP2", "HSP3", "HSP4", "HSP5", "HSP6"]);

      const singleProgramId = createProgram("Quick Single");
      const single = await app.handle(new Request("http://local/api/academic-masters/grades", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ jenjang_id: jenjangId, program_id: singleProgramId, name: "One Grade", sequence_number: 1, active: true }),
      }));
      expect(single.status).toBe(201);
      expect(await single.json()).toMatchObject({ jenjang_id: jenjangId, program_id: singleProgramId, name: "One Grade", sequence_number: 1, active: true });

      const invalidProgramId = createProgram("Quick Invalid");
      const countBeforeInvalid = Number((database.client.query("SELECT COUNT(*) AS count FROM academic_grades WHERE program_id = ?").get(invalidProgramId) as any).count);
      const auditBeforeInvalid = Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count);
      for (const grades of [
        [{ name: "Same", sequence_number: 1 }, { name: "Same", sequence_number: 2 }],
        [{ name: "First", sequence_number: 1 }, { name: "Second", sequence_number: 1 }],
        [{ name: "   ", sequence_number: 1 }],
      ]) {
        expect((await post(invalidProgramId, grades)).status).toBe(422);
      }
      expect((await post(invalidProgramId, [{ name: "Fraction", sequence_number: 1.5 }])).status).toBe(400);
      expect((await post(99999999, [{ name: "Missing", sequence_number: 1 }])).status).toBe(404);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_grades WHERE program_id = ?").get(invalidProgramId) as any).count)).toBe(countBeforeInvalid);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count)).toBe(auditBeforeInvalid);

      const rollbackProgramId = createProgram("Quick Rollback");
      database.client.run(`CREATE TRIGGER quick_grade_unique_conflict BEFORE INSERT ON academic_grades WHEN NEW.name = 'Trigger conflict' BEGIN INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (NEW.jenjang_id, NEW.program_id, 'Trigger owner', NEW.sequence_number, 1); END`);
      const beforeRollbackAudit = Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count);
      expect((await post(rollbackProgramId, [{ name: "Will rollback", sequence_number: 1 }, { name: "Trigger conflict", sequence_number: 2 }])).status).toBe(409);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_grades WHERE program_id = ?").get(rollbackProgramId) as any).count)).toBe(0);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_master_audit WHERE entity_type = 'grade'").get() as any).count)).toBe(beforeRollbackAudit);

      const destinationJenjangId = Number(database.client.run("INSERT INTO jenjangs (code, name, level, active) VALUES (?, ?, ?, 1)", ["QG-DST", "Quick Grade Destination", "primary"]).lastInsertRowid);
      const moveProgram = await app.handle(new Request(`http://local/api/academic-masters/programs/${homeschooling.programId}`, {
        method: "PUT", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ jenjang_id: destinationJenjangId, name: "Quick Homeschooling", active: true }),
      }));
      expect(moveProgram.status).toBe(409);
      expect((await moveProgram.json() as any).detail).toContain("cannot change jenjang while grades exist");
      expect((database.client.query("SELECT DISTINCT jenjang_id FROM academic_grades WHERE program_id = ?").get(homeschooling.programId) as any).jenjang_id).toBe(jenjangId);

      const concurrentProgramId = createProgram("Quick Concurrent");
      const concurrent = await Promise.all([
        post(concurrentProgramId, [{ name: "Concurrent A", sequence_number: 1 }]),
        post(concurrentProgramId, [{ name: "Concurrent B", sequence_number: 1 }]),
      ]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(Number((database.client.query("SELECT COUNT(*) AS count FROM academic_grades WHERE program_id = ?").get(concurrentProgramId) as any).count)).toBe(1);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("enforces admin-only academic writes and server-side staff permissions", async () => {
    const path = `/tmp/operatoros-core-permissions-${process.pid}-${Date.now()}.db`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-core-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const denied = await app.handle(new Request("http://local/api/academic-masters/academic-years", { headers: auth }));
      expect(denied.status).toBe(403);
      const deniedGradeBatch = await app.handle(new Request("http://local/api/academic-masters/grades/bulk", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ program_id: 1, grades: [{ name: "No Access", sequence_number: 1 }] }) }));
      expect(deniedGradeBatch.status).toBe(403);
      const anonymousGradeBatch = await app.handle(new Request("http://local/api/academic-masters/grades/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ program_id: 1, grades: [{ name: "No Access", sequence_number: 1 }] }) }));
      expect(anonymousGradeBatch.status).toBe(401);
      const staff = await app.handle(new Request("http://local/api/staff", { headers: auth }));
      expect(staff.status).toBe(403);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("preserves staff education and enrollment lifecycle history", async () => {
    const path = `/tmp/operatoros-core-lifecycle-${process.pid}-${Date.now()}.db`;
    seedAcademic(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-core-lifecycle-audit-${process.pid}` } });
    try {
      const secondClass = database.client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) SELECT academic_year_id, grade_id, '7B', 'B', 1 FROM academic_classes WHERE id = 1");
      const staffId = "staff-golden-1";
      database.client.run("INSERT INTO staff_members (id, full_name, normalized_name, employment_status, employment_start_date, dapodik_status_normalized) VALUES (?, ?, ?, 'ACTIVE', ?, 'ACTIVE')", [staffId, "Golden Staff", "golden staff", "2020-01-01"]);
      database.client.run("INSERT INTO staff_import_batches (id, source_filename, source_sheet, file_sha256, actor, total_rows, active_count, former_count, review_count, issue_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["staff-batch-golden", "staff.xlsx", "Staff", "a".repeat(64), "golden-admin", 2, 1, 1, 0, 1, "APPLIED"]);
      database.client.run("INSERT INTO staff_import_issues (batch_id, issue_code, severity, message) VALUES (?, ?, ?, ?)", ["staff-batch-golden", "MISSING_NIP", "WARNING", "NIP is missing"]);
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const yearId = Number((database.client.query("SELECT id FROM academic_years WHERE label = '2026/2027-academic'").get() as any).id);
      const term = await app.handle(new Request("http://local/api/academic-config/terms", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, term_number: 1, label: "Semester One", start_date: "2026-07-01", end_date: "2026-09-30" }) }));
      expect(term.status, await term.clone().text()).toBe(200);
      expect((await (await app.handle(new Request(`http://local/api/academic-config/terms/effective?academic_year_id=${yearId}`, { headers: auth }))).json() as any)[0]).toMatchObject({ label: "Semester One", source: "custom" });
      const threshold = await app.handle(new Request("http://local/api/academic-config/kkm-thresholds", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, assessment_type: "sumatif", threshold: 82 }) }));
      expect(threshold.status).toBe(200); const thresholdId = (await threshold.json() as any).id;
      expect(await (await app.handle(new Request(`http://local/api/academic-config/kkm-effective?academic_year_id=${yearId}&assessment_type=sumatif`, { headers: auth }))).json()).toMatchObject({ threshold: 82, threshold_source: "subject-specific" });
      expect((await app.handle(new Request(`http://local/api/academic-config/kkm-thresholds/${thresholdId}`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ threshold: 83 }) }))).status).toBe(200);
      expect((await app.handle(new Request(`http://local/api/academic-config/kkm-thresholds/${thresholdId}`, { method: "DELETE", headers: auth }))).status).toBe(200);
      expect((await app.handle(new Request("http://local/api/student-masters/11111111-1111-1111-1111-111111111111/health", { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ allergy: "Pollen" }) }))).status).toBe(200);
      expect((await app.handle(new Request("http://local/api/student-masters/11111111-1111-1111-1111-111111111111/documents", { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ birth_certificate_received: true }) }))).status).toBe(200);
      const guardian = await app.handle(new Request("http://local/api/student-masters/11111111-1111-1111-1111-111111111111/guardians", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ guardian_type: "mother", name: "Golden Parent" }) }));
      expect(guardian.status).toBe(201);
      const device = await app.handle(new Request("http://local/api/student-masters/11111111-1111-1111-1111-111111111111/device-identities", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ device_identifier: "799", effective_from: "2026-08-01", reason: "Device replacement", confirmation: "REPLACE_ATTENDANCE_DEVICE_ID" }) }));
      expect(device.status).toBe(201); const deviceId = (await device.json() as any).id;
      expect((await app.handle(new Request(`http://local/api/student-masters/11111111-1111-1111-1111-111111111111/device-identities/${deviceId}/retire`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ effective_to: "2026-08-15", reason: "Device retired", confirmation: "RETIRE_ATTENDANCE_DEVICE_ID" }) }))).status).toBe(200);
      const education = await app.handle(new Request(`http://local/api/staff/${staffId}/education`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ education_level: "S1", institution_name: "State University", graduation_year: 2015 }) }));
      expect(education.status).toBe(201);
      const educationList = await app.handle(new Request(`http://local/api/staff/${staffId}/education`, { headers: auth }));
      expect(await educationList.json()).toMatchObject({ highest_education_level: "S1", highest_education_institution: "State University" });
      expect((await (await app.handle(new Request(`http://local/api/staff/${staffId}`, { headers: auth }))).json()) as any).toMatchObject({ employment_status: "ACTIVE", full_name: "Golden Staff" });
      const jenjangId = Number((database.client.query("SELECT id FROM jenjangs LIMIT 1").get() as any).id);
      expect((await app.handle(new Request(`http://local/api/staff/${staffId}/jenjangs`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jenjang_ids: [jenjangId] }) }))).status).toBe(200);
      expect((await (await app.handle(new Request("http://local/api/staff?status=ALL", { headers: auth }))).json() as any).items[0]).toMatchObject({ highest_education_level: "S1", jenjangs: [{ id: jenjangId }] });
      const staffImports = await app.handle(new Request("http://local/api/staff/imports/history", { headers: auth }));
      expect(staffImports.status).toBe(200); expect(await staffImports.json()).toMatchObject({ items: [{ id: "staff-batch-golden", total_rows: 2, issue_count: 1 }] });
      const staffImport = await app.handle(new Request("http://local/api/staff/imports/staff-batch-golden", { headers: auth }));
      expect(staffImport.status).toBe(200); expect(await staffImport.json()).toMatchObject({ id: "staff-batch-golden", issue_counts: { MISSING_NIP: 1 } });
      const managed = await app.handle(new Request("http://local/api/student-masters/management/list?page=1&page_size=10", { headers: auth }));
      expect(managed.status).toBe(200); expect(await managed.json()).toMatchObject({ total: 2, status_counts: { all: 2 } });
      const managedCsv = await app.handle(new Request("http://local/api/student-masters/management/export.csv", { headers: auth }));
      expect(managedCsv.status).toBe(200); expect(await managedCsv.text()).toContain("Student ID,Name,NIPD,NISN");
      const staffCsv = await app.handle(new Request("http://local/api/staff/export?status=ALL", { headers: auth }));
      expect(staffCsv.status).toBe(200); expect(await staffCsv.text()).toContain("Staff ID,Name,Employment Status");
      const sensitive = await app.handle(new Request(`http://local/api/staff/${staffId}/sensitive`, { headers: auth }));
      expect(sensitive.status).toBe(200); expect(await sensitive.json()).toMatchObject({ id: staffId, contact: null });
      const operations = await app.handle(new Request("http://local/api/students/operations", { headers: auth }));
      expect(operations.status).toBe(200); expect(await operations.json()).toMatchObject({ total: 0, pages: 0 });
      const legacyOperations = await app.handle(new Request("http://local/students/operations", { headers: auth }));
      expect(legacyOperations.status).toBe(200); expect(await legacyOperations.json()).toMatchObject({ total: 0, pages: 0 });
      const workQueue = await app.handle(new Request("http://local/api/operator/work-queue", { headers: auth }));
      expect(workQueue.status).toBe(200); expect(await workQueue.json()).toEqual([]);
      const assignments = await app.handle(new Request("http://local/api/teacher-class-assignments", { headers: auth }));
      expect(assignments.status).toBe(200); expect(await assignments.json()).toEqual([]);
      const exportPreview = await app.handle(new Request("http://local/api/student-exports/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ scope: "ALL_PERMITTED_STUDENTS", field_profile: "STANDARD_OPERATIONAL" }) }));
      expect(exportPreview.status).toBe(200); expect(await exportPreview.json()).toMatchObject({ normalized_scope: "ALL_PERMITTED_STUDENTS", estimated_row_count: 2, allowed: true });
      const exportDownload = await app.handle(new Request("http://local/api/student-exports/download", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ scope: "ALL_PERMITTED_STUDENTS", field_profile: "STANDARD_OPERATIONAL" }) }));
      expect(exportDownload.status).toBe(200); expect(new TextDecoder().decode(new Uint8Array(await exportDownload.arrayBuffer()).slice(0, 2))).toBe("PK");
      const masterPreview = await app.handle(new Request("http://local/api/student-enrollments/academic-master-preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ source_owner: "golden", academic_years: [], jenjangs: [], programs: [], grades: [], classes: [] }) }));
      expect(masterPreview.status).toBe(200); expect(await masterPreview.json()).toMatchObject({ status: "review_required", summary: { total: 0 } });
      const rosterTemplate = await app.handle(new Request("http://local/api/student-enrollments/roster-template", { headers: auth }));
      expect(rosterTemplate.status).toBe(200); expect(new TextDecoder().decode(new Uint8Array(await rosterTemplate.arrayBuffer()).slice(0, 2))).toBe("PK");
      const mappings = await app.handle(new Request("http://local/api/student-enrollments/mapping-preview", { method: "POST", headers: auth }));
      expect(mappings.status).toBe(200); expect(await mappings.json()).toMatchObject({ summary: { total: 5 } });
      const legacyPreview = await app.handle(new Request("http://local/api/student-masters/legacy-link/preview", { method: "POST", headers: auth }));
      expect(legacyPreview.status).toBe(200); expect(await legacyPreview.json()).toMatchObject({ summary: { total: 5 } });
      const absence = await app.handle(new Request("http://local/api/config/absence-reasons/bulk", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, month: "2026-07", classes: [{ class_id: Number(secondClass.lastInsertRowid), sakit: 1, izin: 0, alfa: 0 }] }) }));
      expect(absence.status).toBe(200); expect(await absence.json()).toMatchObject({ inserted: 1, updated: 0, total: 1 });
      expect(database.client.query("SELECT COUNT(*) AS count FROM absence_reasons WHERE class_name = '7B' AND year = 2026 AND month = 7").get()).toMatchObject({ count: 0 });
      const preview = await app.handle(new Request("http://local/api/student-enrollments/populate/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: yearId, legacy_student_ids: [701, 702], effective_start_date: "2026-07-01" }) }));
      expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ summary: { total: 2 } });
      const enrollmentId = Number((database.client.query("SELECT id FROM student_enrollments WHERE student_master_id = ? AND lifecycle_state = 'ACTIVE'").get("11111111-1111-1111-1111-111111111111") as any).id);
      expect((await app.handle(new Request(`http://local/api/student-enrollments/${enrollmentId}/transfer`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ target_class_id: Number(secondClass.lastInsertRowid), effective_date: "2026-08-01", reason: "Class placement changed", confirmation: "TRANSFER_STUDENT_ENROLLMENT" }) }))).status).toBe(200);
      const withdrawn = await app.handle(new Request(`http://local/api/student-enrollments/${enrollmentId}/withdraw`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ effective_date: "2026-08-15", reason: "Student withdrew", reason_code: "WITHDRAWAL", confirmation: "WITHDRAW_STUDENT_ENROLLMENT" }) }));
      expect(withdrawn.status).toBe(200); expect((await withdrawn.json() as any).lifecycle_state).toBe("WITHDRAWN");
      const status = await app.handle(new Request(`http://local/api/student-enrollments/${enrollmentId}/deletion-status`, { headers: auth }));
      expect(await status.json()).toMatchObject({ can_hard_delete: false, dependencies: ["CLASS_HISTORY", "LIFECYCLE_AUDIT"] });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
