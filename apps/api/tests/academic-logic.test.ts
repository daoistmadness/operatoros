import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_academic(path)",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function auth(app: ReturnType<typeof createApp>, username: string, password: string): Promise<{ cookie: string }> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const token = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!token) throw new Error("session cookie missing");
  return { cookie: `astyx_session=${token}` };
}

describe("academic progression and intervention parity slices", () => {
  it("creates and closes an academic intervention with duplicate protection", async () => {
    const path = `/tmp/operatoros-intervention-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-intervention-audit-${process.pid}` } });
    try {
      const admin = await auth(app, "golden-admin", "golden-admin-pass-1");
      const year = database.client.query("SELECT id FROM academic_years ORDER BY start_date DESC LIMIT 1").get() as { id: number };
      const jenjang = database.client.query("SELECT id FROM jenjangs LIMIT 1").get() as { id: number };
      database.client.run("INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)", [jenjang.id]);
      const subject = database.client.query("SELECT id FROM subjects ORDER BY id DESC LIMIT 1").get() as { id: number };
      const body = { student_id: 701, academic_year_id: year.id, jenjang_id: jenjang.id, subject_id: subject.id, student_name: "Linked Student", subject_name: "Mathematics", effective_threshold: 85, threshold_source: "legacy-fallback", current_average: 70, status: "open", priority: "high", follow_up_date: "2026-09-01" };
      const created = await app.handle(new Request("http://local/api/academic-interventions", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(created.status).toBe(200);
      const createdJson = await created.json() as any;
      const duplicate = await app.handle(new Request("http://local/api/academic-interventions", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(duplicate.status).toBe(409);
      const closed = await app.handle(new Request(`http://local/api/academic-interventions/${createdJson.id}`, { method: "DELETE", headers: admin }));
      expect(closed.status).toBe(200);
      expect(await closed.json()).toMatchObject({ status: "success", closed: 1 });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("previews and commits progression in one transaction", async () => {
    const path = `/tmp/operatoros-progression-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-progression-audit-${process.pid}` } });
    try {
      const admin = await auth(app, "golden-admin", "golden-admin-pass-1");
      const years = database.client.query("SELECT id, start_date FROM academic_years ORDER BY start_date").all() as { id: number; start_date: string }[];
      const sourceYear = years[0]!;
      const destinationYear = years[1]!;
      const grade = database.client.query("SELECT id, program_id, jenjang_id FROM academic_grades LIMIT 1").get() as { id: number; program_id: number; jenjang_id: number };
      database.client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7A-old', 'OLD', 1)", [sourceYear.id, grade.id]);
      const sourceClassId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      database.client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (702, '22222222-2222-2222-2222-222222222222', ?, ?, ?, '7A-old', 1, ?, 'ACTIVE')", [sourceYear.id, grade.jenjang_id, sourceClassId, sourceYear.start_date]);
      const sourceEnrollmentId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      database.client.run("INSERT INTO student_progression_mapping_rules (source_jenjang_id, destination_jenjang_id, source_program_id, destination_program_id, source_grade_id, destination_grade_id, outcome, active, created_by, approved_by) VALUES (?, ?, ?, ?, ?, ?, 'PROMOTE', 1, 'golden-admin', 'golden-admin')", [grade.jenjang_id, grade.jenjang_id, grade.program_id, grade.program_id, grade.id, grade.id]);
      const preview = await app.handle(new Request("http://local/api/student-progression/previews", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ source_academic_year_id: sourceYear.id, destination_academic_year_id: destinationYear.id, source_enrollment_ids: [sourceEnrollmentId] }) }));
      expect(preview.status).toBe(201);
      const previewJson = await preview.json() as any;
      expect(previewJson.summary).toMatchObject({ total: 1, valid: 1, outcomes: { PROMOTE: 1 } });
      database.client.run("CREATE TRIGGER test_progression_failure BEFORE INSERT ON student_progression_audit BEGIN SELECT RAISE(ABORT, 'forced progression failure'); END");
      const failedCommit = await app.handle(new Request(`http://local/api/student-progression/previews/${previewJson.batch_id}/commit`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ preview_version: 1, effective_date: destinationYear.start_date, confirmation: "COMMIT_STUDENT_PROGRESSION" }) }));
      expect(failedCommit.status).toBe(409);
      expect(database.client.query("SELECT lifecycle_state FROM student_enrollments WHERE id = ?").get(sourceEnrollmentId)).toMatchObject({ lifecycle_state: "ACTIVE" });
      expect(database.client.query("SELECT COUNT(*) AS count FROM student_enrollments WHERE student_master_id = '22222222-2222-2222-2222-222222222222' AND academic_year_id = ?").get(destinationYear.id)).toMatchObject({ count: 0 });
      database.client.run("DROP TRIGGER test_progression_failure");
      const commit = await app.handle(new Request(`http://local/api/student-progression/previews/${previewJson.batch_id}/commit`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ preview_version: 1, effective_date: destinationYear.start_date, confirmation: "COMMIT_STUDENT_PROGRESSION" }) }));
      expect(commit.status).toBe(200);
      expect(await commit.json()).toMatchObject({ status: "COMMITTED", applied: 1, destination_enrollments_created: 1 });
      expect(database.client.query("SELECT lifecycle_state FROM student_enrollments WHERE id = ?").get(sourceEnrollmentId)).toMatchObject({ lifecycle_state: "ENDED" });
      expect(database.client.query("SELECT COUNT(*) AS count FROM student_progression_audit WHERE batch_id = ?").get(previewJson.batch_id)).toMatchObject({ count: 1 });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("uses grade sequence fallback and marks a sole graduate", async () => {
    const path = `/tmp/operatoros-progression-auto-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-progression-auto-audit-${process.pid}` } });
    try {
      const admin = await auth(app, "golden-admin", "golden-admin-pass-1");
      const years = database.client.query("SELECT id FROM academic_years ORDER BY start_date").all() as { id: number }[];
      const sourceYear = years[0]!;
      const destinationYear = years[1]!;
      const grade = database.client.query("SELECT id, program_id, jenjang_id FROM academic_grades LIMIT 1").get() as { id: number; program_id: number; jenjang_id: number };
      database.client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES ('33333333-3333-3333-3333-333333333333', 'Auto Graduate', 'auto graduate', 'active')");
      database.client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, '7A-auto', 'AUTO', 1)", [sourceYear.id, grade.id]);
      const sourceClassId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      database.client.run("INSERT INTO student_enrollments (student_id, student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (703, '33333333-3333-3333-3333-333333333333', ?, ?, ?, '7A-auto', 1, '2025-07-01', 'ACTIVE')", [sourceYear.id, grade.jenjang_id, sourceClassId]);
      const sourceEnrollmentId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      const preview = await app.handle(new Request("http://local/api/student-progression/previews", { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ source_academic_year_id: sourceYear.id, destination_academic_year_id: destinationYear.id, source_enrollment_ids: [sourceEnrollmentId] }) }));
      expect(preview.status).toBe(201);
      const previewJson = await preview.json() as any;
      expect(previewJson.rows[0]).toMatchObject({ proposed_outcome: "GRADUATE", mapping_source: "TERMINAL_GRADE", validation_result: "VALID" });
      const commit = await app.handle(new Request(`http://local/api/student-progression/previews/${previewJson.batch_id}/commit`, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify({ preview_version: 1, effective_date: "2026-07-01", confirmation: "COMMIT_GRADUATION_PROGRESSION" }) }));
      expect(commit.status).toBe(200);
      expect(database.client.query("SELECT student_status FROM student_masters WHERE id = '33333333-3333-3333-3333-333333333333'").get()).toMatchObject({ student_status: "graduated" });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
