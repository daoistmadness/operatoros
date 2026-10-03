import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./fixtures/golden";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createGoldenFixture(path, "reports-with-defaults");
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
