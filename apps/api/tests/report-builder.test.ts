import { describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "../src/db/connection";

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const python = process.env.OPERATOROS_PYTHON ?? (existsSync(`${repoRoot}/backend/.venv/bin/python`) ? `${repoRoot}/backend/.venv/bin/python` : "/home/mikhailryu/projects/absensi/school-attendance-analytics/backend/.venv/bin/python");
const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  const script = [
    "from pathlib import Path",
    "import importlib.util, sys",
    "sys.path.insert(0, 'backend/src')",
    "from core.schema_migrations import bootstrap_fresh_sqlite_database",
    "from core import database as core_database",
    "path = Path(sys.argv[1]); bootstrap_fresh_sqlite_database(path)",
    "spec = importlib.util.spec_from_file_location('golden_seeds', 'docs/migration/ts-backend/golden/tools/seeds.py'); seeds = importlib.util.module_from_spec(spec); spec.loader.exec_module(seeds); seeds.seed_reports(path)",
    "core_database.run_grade_ledger_patches(core_database.engine); core_database._seed_grade_ledger_minimum(core_database.engine)",
    "from services.report_builder import seed_report_builder_defaults; seed_report_builder_defaults()",
  ].join("; ");
  const result = Bun.spawnSync([python, "-c", script, path], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: `sqlite:///${path}`, AUTH_COOKIE_SECRET: secret, OPERATOROS_ISOLATED_TEST: "true", BYPASS_STUDENT_LINKING_GATE: "true" } });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function cookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-admin", password: "golden-admin-pass-1" }) }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("session cookie missing");
  return `astyx_session=${value}`;
}

describe("report builder candidates", () => {
  it("supports sections, template CRUD, preview, branding, and exports", async () => {
    const path = `/tmp/operatoros-report-builder-${process.pid}-${Date.now()}.db`; seed(path); const database = openDatabase(path); const app = createApp({ databaseHandle: database, auth: { authCookieSecret: secret, auditDir: `/tmp/operatoros-report-builder-audit-${process.pid}` } });
    try {
      const auth = { cookie: await cookie(app) };
      const sections = await app.handle(new Request("http://local/api/report-builder/sections", { headers: auth })); expect(sections.status).toBe(200); expect(Object.keys(await sections.json() as Record<string, unknown>)).toContain("attendance");
      const templates = await app.handle(new Request("http://local/api/report-builder/templates", { headers: auth })); expect(templates.status).toBe(200); expect((await templates.json() as any[]).length).toBeGreaterThan(0);
      const preview = await app.handle(new Request("http://local/api/report-builder/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ filters: { academic_year_id: 2 }, include_trends: true, include_forecast: true, forecast_method: "linear_trend", granularity: "term" }) })); const previewBody = await preview.json() as any; expect(preview.status, JSON.stringify(previewBody)).toBe(200); expect(previewBody.resolved_sections).toContain("attendance");
      const created = await app.handle(new Request("http://local/api/report-builder/templates", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Phase 10 Candidate", template_type: "attendance_review", output_format: "both", is_default: false, is_active: true, page_order_json: ["executive_summary", "attendance"], section_visibility_json: { executive_summary: true, attendance: true }, chart_visibility_json: { attendance: true }, excel_sheet_visibility_json: { README: true }, default_filters_json: {}, export_options_json: {} }) })); const createdBody = await created.json() as any; expect(created.status, JSON.stringify(createdBody)).toBe(200);
      const patched = await app.handle(new Request(`http://local/api/report-builder/templates/${createdBody.id}`, { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ description: "Updated" }) })); expect(patched.status).toBe(200); expect((await patched.json() as any).description).toBe("Updated");
      const branding = await app.handle(new Request("http://local/api/report-builder/branding", { headers: auth })); expect(branding.status).toBe(200);
      for (const [pathSuffix, magic] of [["export/excel", "PK"], ["export/pdf", "%PDF"]] as const) { const exported = await app.handle(new Request(`http://local/api/report-builder/${pathSuffix}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ filters: { academic_year_id: 2 } }) })); expect(exported.status).toBe(200); expect(new TextDecoder().decode(new Uint8Array(await exported.arrayBuffer()).slice(0, magic.length))).toBe(magic); }
      const deleted = await app.handle(new Request(`http://local/api/report-builder/templates/${createdBody.id}`, { method: "DELETE", headers: auth })); expect(deleted.status).toBe(200); expect(await deleted.json()).toEqual({ status: "success", deleted: 1, id: createdBody.id });
    } finally { database.close(); rmSync(path, { force: true }); }
  }, 30000);
});
