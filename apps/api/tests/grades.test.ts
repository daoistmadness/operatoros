import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { python } from "./python";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
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

async function adminAuth(app: ReturnType<typeof createApp>): Promise<{ cookie: string }> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const token = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!token) throw new Error("session cookie missing");
  return { cookie: `astyx_session=${token}` };
}

describe("grades and academic parity slices", () => {
  it("saves grades, preserves uniqueness, and returns ledger analytics", async () => {
    const path = `/tmp/operatoros-grades-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-grades-audit-${process.pid}` } });
    try {
      const auth = await adminAuth(app);
      const enrollment = database.client.query("SELECT id, jenjang_id, academic_year_id FROM student_enrollments WHERE lifecycle_state = 'ACTIVE' ORDER BY id LIMIT 1").get() as { id: number; jenjang_id: number; academic_year_id: number };
      const year = { id: enrollment.academic_year_id };
      database.client.run("UPDATE student_enrollments SET student_id = 701 WHERE id = ?", [enrollment.id]);
      database.client.run("INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Mathematics', ?, 1, 1)", [enrollment.jenjang_id]);
      const subjectId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      database.client.run("INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Exam', 'sumatif', ?)", [subjectId]);
      const subject = database.client.query("SELECT id FROM subjects ORDER BY id LIMIT 1").get() as { id: number };
      const component = database.client.query("SELECT id FROM assessment_components WHERE subject_id = ? ORDER BY id LIMIT 1").get(subjectId) as { id: number };
      const sessionResponse = await app.handle(new Request("http://local/api/grades/assessment-sessions", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: year.id, term_number: 1, label: "Exam", assessment_date: "2026-08-15" }) }));
      expect(sessionResponse.status).toBe(200);
      const session = await sessionResponse.json() as { id: number };
      const body = { enrollment_id: enrollment.id, assessment_session_id: session.id, grades: [{ subject_id: subject.id, component_id: component.id, score: 88 }] };
      const saved = await app.handle(new Request("http://local/api/grades/save", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ status: "success", inserted: 1, updated: 0, saved: 1 });
      expect(() => database.client.run("INSERT INTO student_subject_grades (enrollment_id, subject_id, component_id, assessment_session_id, score) VALUES (?, ?, ?, ?, ?)", [enrollment.id, subject.id, component.id, session.id, 91])).toThrow();
      expect(() => database.client.run("INSERT INTO assessment_components (name, assessment_type, subject_id) VALUES ('Broken', 'invalid', ?)", [subject.id])).toThrow();
      expect(() => database.client.run("DELETE FROM subjects WHERE id = ?", [subject.id])).toThrow();
      const duplicate = await app.handle(new Request("http://local/api/grades/save", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ ...body, grades: [body.grades[0], body.grades[0]] }) }));
      expect(duplicate.status).toBe(400);
      const ledger = await app.handle(new Request(`http://local/api/grades/ledger?academic_year_id=${year.id}`, { headers: auth }));
      expect(ledger.status).toBe(200);
      expect((await ledger.json() as any[]).some((value) => value.grades.some((grade: any) => grade.score === 88))).toBe(true);
      const analytics = await app.handle(new Request(`http://local/api/grades/analytics?academic_year_id=${year.id}`, { headers: auth }));
      expect(analytics.status).toBe(200);
      expect(await analytics.json()).toMatchObject({ grade_count: 1, average_score: 88 });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("preserves KKM fallback and configured precedence", async () => {
    const path = `/tmp/operatoros-kkm-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-kkm-audit-${process.pid}` } });
    try {
      const auth = await adminAuth(app);
      const year = database.client.query("SELECT id FROM academic_years ORDER BY id LIMIT 1").get() as { id: number };
      const fallback = await app.handle(new Request(`http://local/api/academic-config/kkm-effective?academic_year_id=${year.id}&assessment_type=sumatif`, { headers: auth }));
      expect(await fallback.json()).toMatchObject({ threshold: 85, threshold_source: "legacy-fallback" });
      const created = await app.handle(new Request("http://local/api/academic-config/kkm-thresholds", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: year.id, assessment_type: "sumatif", threshold: 90 }) }));
      expect(created.status).toBe(200);
      const configured = await app.handle(new Request(`http://local/api/academic-config/kkm-effective?academic_year_id=${year.id}&assessment_type=sumatif`, { headers: auth }));
      expect(await configured.json()).toMatchObject({ threshold: 90, threshold_source: "subject-specific" });
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("authors components while preserving scored component identity", async () => {
    const path = `/tmp/operatoros-components-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-components-audit-${process.pid}` } });
    try {
      const auth = await adminAuth(app);
      const enrollment = database.client.query("SELECT id, academic_year_id, jenjang_id FROM student_enrollments WHERE lifecycle_state = 'ACTIVE' ORDER BY id LIMIT 1").get() as { id: number; academic_year_id: number; jenjang_id: number };
      database.client.run("INSERT INTO subjects (name, jenjang_id, supports_sumatif, supports_formatif) VALUES ('Component Mathematics', ?, 1, 1)", [enrollment.jenjang_id]);
      const subjectId = Number((database.client.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      const create = await app.handle(new Request("http://local/api/grades/components", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Unit Exam", assessment_type: "sumatif", subject_id: subjectId }) }));
      expect(create.status).toBe(200);
      const component = await create.json() as { id: number; name: string; subject_id: number };
      expect(component).toMatchObject({ name: "Unit Exam", subject_id: subjectId });
      const duplicate = await app.handle(new Request("http://local/api/grades/components", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Unit Exam", assessment_type: "sumatif", subject_id: subjectId }) }));
      expect(duplicate.status).toBe(409);
      const invalidScope = await app.handle(new Request("http://local/api/grades/components", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Missing Subject", assessment_type: "sumatif", subject_id: 999999 }) }));
      expect(invalidScope.status).toBe(404);
      const renamed = await app.handle(new Request(`http://local/api/grades/components/${component.id}`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Unit Exam Revised" }) }));
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ id: component.id, name: "Unit Exam Revised" });

      const session = await app.handle(new Request("http://local/api/grades/assessment-sessions", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ academic_year_id: enrollment.academic_year_id, term_number: 1, label: "Component Session" }) }));
      expect(session.status).toBe(200);
      const sessionId = (await session.json() as { id: number }).id;
      const saved = await app.handle(new Request("http://local/api/grades/save", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ enrollment_id: enrollment.id, assessment_session_id: sessionId, grades: [{ subject_id: subjectId, component_id: component.id, score: 91 }] }) }));
      expect(saved.status).toBe(200);
      const blockedEdit = await app.handle(new Request(`http://local/api/grades/components/${component.id}`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ assessment_type: "formatif" }) }));
      expect(blockedEdit.status).toBe(409);
      const blockedDelete = await app.handle(new Request(`http://local/api/grades/components/${component.id}`, { method: "DELETE", headers: auth }));
      expect(blockedDelete.status).toBe(409);
      expect((database.client.query("SELECT component_id, score FROM student_subject_grades WHERE component_id = ?").get(component.id) as { component_id: number; score: number })).toEqual({ component_id: component.id, score: 91 });

      const unused = await app.handle(new Request("http://local/api/grades/components", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Unused Component", assessment_type: "formatif", subject_id: subjectId }) }));
      const unusedId = (await unused.json() as { id: number }).id;
      const deleted = await app.handle(new Request(`http://local/api/grades/components/${unusedId}`, { method: "DELETE", headers: auth }));
      expect(deleted.status).toBe(200);
      const unauthorized = await app.handle(new Request("http://local/api/grades/components", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Unauthorized", assessment_type: "sumatif", subject_id: subjectId }) }));
      expect(unauthorized.status).toBe(401);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
