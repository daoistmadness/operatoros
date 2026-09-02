import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ReadinessResponseSchema } from "@operatoros/contracts/readiness";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { FEATURE_REQUIREMENTS, mapReadinessToResponse } from "../src/domains/readiness";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
const secret = "astryx-readiness-test-secret-32-characters";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import sqlite3, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "from argon2 import PasswordHasher; db = sqlite3.connect(path); ph = PasswordHasher()",
    "db.executemany('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [('readiness-admin', ph.hash('readiness-admin-pass-1'), 'admin'), ('readiness-staff', ph.hash('readiness-staff-pass-1'), 'staff')])",
    "db.commit(); db.close()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function cookie(response: Response): string {
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

async function setup(label: string) {
  const path = `/tmp/operatoros-readiness-${label}-${process.pid}-${Date.now()}.db`;
  seed(path);
  const database = openDatabase(path);
  const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-readiness-audit-${process.pid}` } });
  const login = async (username: string, password: string) => cookie(await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })));
  return {
    app,
    database,
    admin: await login("readiness-admin", "readiness-admin-pass-1"),
    staff: await login("readiness-staff", "readiness-staff-pass-1"),
    cleanup: () => { database.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); },
  };
}

function configureFoundation(database: { client: Database }): void {
  const client = database.client;
  const year = client.run("INSERT INTO academic_years (label, start_date, end_date, status, is_default) VALUES ('Synthetic 2026/2027', '2026-07-06', '2027-06-30', 'active', 1)");
  const yearId = Number(year.lastInsertRowid);
  const jenjang = client.run("INSERT INTO jenjangs (name, code, level, active) VALUES ('Synthetic SMP', 'SYN-SMP', 'junior', 1)");
  const jenjangId = Number(jenjang.lastInsertRowid);
  client.run("INSERT INTO jenjangs (name, code, level, active) VALUES ('Synthetic Unused Program', 'SYN-UNUSED', 'other', 1)");
  const program = client.run("INSERT INTO academic_programs (jenjang_id, name, active) VALUES (?, 'Synthetic Regular', 1)", [jenjangId]);
  const programId = Number(program.lastInsertRowid);
  const grade = client.run("INSERT INTO academic_grades (jenjang_id, program_id, name, sequence_number, active) VALUES (?, ?, 'Synthetic Grade 7', 1, 1)", [jenjangId, programId]);
  const gradeId = Number(grade.lastInsertRowid);
  const academicClass = client.run("INSERT INTO academic_classes (academic_year_id, grade_id, class_name, section_code, active) VALUES (?, ?, 'Synthetic 7A', 'SYN-A', 1)", [yearId, gradeId]);
  const classId = Number(academicClass.lastInsertRowid);
  client.run("INSERT INTO attendance_calendar_weekday_rules (academic_year_id, jenjang_id, weekday, expectation) VALUES (?, ?, 1, 'EXPECTED')", [yearId, jenjangId]);
  const studentId = "00000000-0000-4000-8000-000000000001";
  client.run("INSERT INTO student_masters (id, full_name, normalized_name, student_status) VALUES (?, 'Synthetic Student', 'synthetic student', 'active')", [studentId]);
  client.run("INSERT INTO student_enrollments (student_master_id, academic_year_id, jenjang_id, academic_class_id, class_name, class_assigned, effective_from, lifecycle_state) VALUES (?, ?, ?, ?, 'Synthetic 7A', 1, '2026-07-06', 'ACTIVE')", [studentId, yearId, jenjangId, classId]);
}

async function readiness(app: ReturnType<typeof createApp>, session?: string) {
  const response = await app.handle(new Request("http://local/api/readiness", session ? { headers: { cookie: session } } : undefined));
  return { response, body: await response.json() as Record<string, any> };
}

describe("derived readiness reference implementation", () => {
  it("returns scoped canonical foundation states and a conforming public DTO", async () => {
    const value = await setup("states");
    try {
      const initial = await readiness(value.app, value.admin);
      expect(initial.response.status).toBe(200);
      expect(Value.Check(ReadinessResponseSchema, initial.body)).toBe(true);
      expect(initial.body.foundation.find((item: any) => item.key === "academic_year").state).toBe("ACTION_REQUIRED");
      expect(initial.body.foundation.find((item: any) => item.key === "jenjang").state).toBe("ACTION_REQUIRED");
      expect(initial.body.foundation.find((item: any) => item.key === "academic_periods").state).toBe("BLOCKED");
      expect(initial.body.features[0]).toMatchObject({ key: "MACHINE_IMPORT", state: "BLOCKED", blockers: ["academic_year", "jenjang", "calendar"] });

      configureFoundation(value.database);
      const configured = await readiness(value.app, value.admin);
      expect(configured.body.foundation.every((item: any) => item.state === "READY")).toBe(true);
      expect(configured.body.features[0]).toMatchObject({ key: "MACHINE_IMPORT", state: "READY", blockers: [] });
      expect(Value.Check(ReadinessResponseSchema, configured.body)).toBe(true);
    } finally { value.cleanup(); }
  }, 30000);

  it("does not treat supporting jenjang_config as canonical program setup", async () => {
    const value = await setup("supporting-config");
    try {
      value.database.client.run("INSERT INTO jenjang_config (jenjang, cutoff_time, updated_at) VALUES ('Synthetic SMP', '08:00', CURRENT_TIMESTAMP)");
      const result = await readiness(value.app, value.admin);
      expect(result.body.foundation.find((item: any) => item.key === "jenjang").state).toBe("ACTION_REQUIRED");
      expect(result.body.foundation.find((item: any) => item.key === "jenjang").actions).toEqual([{ code: "configure_jenjang", label: "Configure programs / jenjang", route: "/academic-management?tab=foundation" }]);
    } finally { value.cleanup(); }
  }, 30000);

  it("fails closed for staff without a proven setup scope and never leaks global setup state", async () => {
    const value = await setup("scope");
    try {
      configureFoundation(value.database);
      const result = await readiness(value.app, value.staff);
      expect(result.response.status).toBe(200);
      expect(result.body.overall.state).toBe("BLOCKED");
      expect(result.body.foundation.every((item: any) => item.state === "BLOCKED" && item.count === undefined && item.actions.length === 0)).toBe(true);
      expect(JSON.stringify(result.body)).not.toContain("Synthetic");
      expect((await readiness(value.app)).response.status).toBe(401);
    } finally { value.cleanup(); }
  }, 30000);

  it("keeps the typed prerequisite registry small and mapping explicit", () => {
    expect(FEATURE_REQUIREMENTS.MACHINE_IMPORT).toEqual(["academic_year", "jenjang", "calendar"]);
    const mapped = mapReadinessToResponse({
      overall: { state: "READY", summary: "Ready" }, foundation: [], operational: [], features: [],
      legacy: { overallStatus: "READY_WITH_RECOMMENDATIONS", steps: [] },
    });
    expect(Value.Check(ReadinessResponseSchema, mapped)).toBe(true);
    expect(mapped).toEqual(expect.objectContaining({ overall: { state: "READY", summary: "Ready" }, foundation: [], operational: [], features: [], overall_status: "READY_WITH_RECOMMENDATIONS", steps: [] }));
  });

  it("preserves NOT_APPLICABLE as a distinct public readiness state", () => {
    const mapped = mapReadinessToResponse({
      overall: { state: "NOT_APPLICABLE", summary: "This foundation is not used in the current scope." },
      foundation: [{ key: "calendar", label: "School calendar", state: "NOT_APPLICABLE", summary: "Not applicable.", actions: [] }],
      operational: [], features: [], legacy: { overallStatus: "READY_WITH_RECOMMENDATIONS", steps: [] },
    });
    expect(mapped.foundation[0]?.state).toBe("NOT_APPLICABLE");
    expect(Value.Check(ReadinessResponseSchema, mapped)).toBe(true);
  });

  it("keeps a readiness server failure separate from missing setup", async () => {
    const value = await setup("server-error");
    try {
      value.database.close();
      const result = await readiness(value.app, value.admin);
      expect(result.response.status).toBe(500);
      expect(result.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    } finally { value.cleanup(); }
  }, 30000);
});
