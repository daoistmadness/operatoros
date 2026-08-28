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

describe("CSV data portability candidates", () => {
  it("lists datasets, previews and exports CSV, and creates templates", async () => {
    const path = `/tmp/operatoros-portability-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-portability-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const datasets = await app.handle(new Request("http://local/api/data-portability/datasets", { headers: auth }));
      expect(datasets.status).toBe(200);
      expect(await datasets.json()).toHaveLength(4);
      const preview = await app.handle(new Request("http://local/api/data-portability/exports/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster" }) }));
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ estimated_row_count: 2, allowed: true, sensitive_fields_included: false });
      const exportResponse = await app.handle(new Request("http://local/api/data-portability/exports", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster", format_type: "csv" }) }));
      expect(exportResponse.status).toBe(200);
      expect(await exportResponse.text()).toContain("student_id,full_name");
      const templateResponse = await app.handle(new Request("http://local/api/data-portability/templates/student_roster", { headers: auth }));
      expect(templateResponse.status).toBe(200);
      expect(new Uint8Array(await templateResponse.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);

  it("previews and commits a disposable CSV import, then emits errors and history", async () => {
    const path = `/tmp/operatoros-portability-import-${process.pid}-${Date.now()}.db`;
    seed(path);
    const database = openDatabase(path);
    const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-portability-import-audit-${process.pid}` } });
    try {
      const login = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
      const auth = { cookie: `astyx_session=${cookie(login)}` };
      const form = new FormData();
      form.append("dataset", "student_roster");
      form.append("file", new File(["student_id,full_name,student_status,gender\nportability-new,Portable Student,ACTIVE,L\n"], "students.csv", { type: "text/csv" }));
      const preview = await app.handle(new Request("http://local/api/data-portability/imports/preview", { method: "POST", headers: auth, body: form }));
      expect(preview.status).toBe(200);
      const previewBody = await preview.json() as any;
      expect(previewBody).toMatchObject({ dataset: "student_roster", valid_count: 1, error_count: 0, summary: { NEW: 1 } });
      const commit = await app.handle(new Request("http://local/api/data-portability/imports/commit", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ batch_id: previewBody.batch_id, confirmation: "CONFIRM_IMPORT" }) }));
      expect(commit.status).toBe(200);
      expect(await commit.json()).toMatchObject({ success: true, committed_count: 1 });
      expect((database.client.query("SELECT full_name FROM student_masters WHERE id = ?").get("portability-new") as any).full_name).toBe("Portable Student");
      const errorFile = await app.handle(new Request("http://local/api/data-portability/imports/error-file", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ errors: [{ row: "2", field: "student_id", code: "REQUIRED_FIELD_MISSING", message: "student_id is required" }] }) }));
      expect(errorFile.status).toBe(200);
      expect(await errorFile.text()).toContain("safe_error_code");
      const history = await app.handle(new Request("http://local/api/data-portability/history", { headers: auth }));
      expect(history.status).toBe(200);
      expect((await history.json() as any[]).length).toBeGreaterThanOrEqual(2);
    } finally {
      database.close();
      rmSync(path, { force: true });
    }
  }, 30000);
});
