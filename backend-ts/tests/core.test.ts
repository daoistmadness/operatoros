import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? `${repoRoot}/backend/.venv/bin/python`;
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
      const staff = await app.handle(new Request("http://local/api/staff", { headers: auth }));
      expect(staff.status).toBe(403);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
