import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { openDatabase } from "@operatoros/db";
import { createGoldenFixture } from "./fixtures/golden";

const secret = "astryx-test-only-cookie-secret-32-chars";

function seed(path: string): void {
  createGoldenFixture(path, "academic-with-defaults");
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
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
      const datasets = await app.handle(new Request("http://local/api/data-portability/datasets", { headers: auth }));
      expect(datasets.status).toBe(200);
      const datasetInfo = await datasets.json() as Array<{ identifier: string; has_sensitive_access: boolean }>;
      expect(datasetInfo).toHaveLength(4);
      expect(datasetInfo.find((dataset) => dataset.identifier === "student_roster")?.has_sensitive_access).toBe(true);
      const preview = await app.handle(new Request("http://local/api/data-portability/exports/preview", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster" }) }));
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ estimated_row_count: 2, allowed: true, sensitive_fields_included: false });
      const exportResponse = await app.handle(new Request("http://local/api/data-portability/exports", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ dataset: "student_roster", format_type: "csv" }) }));
      expect(exportResponse.status).toBe(200);
      expect(await exportResponse.text()).toContain("student_id,full_name");
      const templateResponse = await app.handle(new Request("http://local/api/data-portability/templates/student_roster", { headers: auth }));
      expect(templateResponse.status).toBe(200);
      expect(new Uint8Array(await templateResponse.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));

      const staffLogin = await app.handle(new Request("http://local/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "golden-staff", password: "golden-staff-pass-1" }) }));
      const staffAuth = { cookie: `astyx_session=${cookie(staffLogin)}`, origin: "http://localhost:5173" };
      const staffDatasets = await app.handle(new Request("http://local/api/data-portability/datasets", { headers: staffAuth }));
      const staffRoster = (await staffDatasets.json() as Array<{ identifier: string; has_sensitive_access: boolean }>).find((dataset) => dataset.identifier === "student_roster");
      expect(staffDatasets.status).toBe(200);
      expect(staffRoster?.has_sensitive_access).toBe(false);
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
      const auth = { cookie: `astyx_session=${cookie(login)}`, origin: "http://localhost:5173" };
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
