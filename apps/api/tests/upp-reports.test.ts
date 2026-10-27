import { expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { createWorkbook, writeXlsxWorkbook } from "@operatoros/excel";
import { createApp } from "../src/app";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";
import { createAccountFixture } from "./fixtures/accounts";

const secret = "synthetic-upp-cookie-secret-distinct-from-key";
const key = randomBytes(32).toString("base64");

function request(method: string, path: string, cookie?: string, body?: FormData | string, origin = method === "GET" ? undefined : "http://local"): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  if (typeof body === "string") headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { method, headers, body });
}

async function login(app: ReturnType<typeof createApp>, role = "admin"): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `golden-${role}`, password: `golden-${role}-pass-1` }),
  }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("synthetic session missing");
  return `astyx_session=${value}`;
}

async function workbook(label: string): Promise<Uint8Array> {
  const value = createWorkbook();
  const students = value.addWorksheet("Students");
  students.addRow(["Student ID", "Name"]);
  students.addRow([1, `Synthetic ${label}`]);
  students.getCell("C2").value = { formula: "A2+1", result: 2 };
  const facilities = value.addWorksheet("Facilities");
  facilities.addRow(["Item", "Count"]);
  facilities.addRow(["Synthetic desks", 4]);
  return writeXlsxWorkbook(value);
}

function formUpload(bytes: Uint8Array, filename: string, values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [keyName, value] of Object.entries(values)) form.set(keyName, value);
  form.set("file", new File([bytes], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return form;
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "operatoros-upp-report-"));
  const databasePath = join(root, "operatoros.sqlite");
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);
  const unitId = Number(database.client.run("INSERT INTO school_units (name) VALUES ('Synthetic UPP Unit')").lastInsertRowid);
  const backupDir = join(root, "backups");
  mkdirSync(backupDir, { mode: 0o700 });
  const app = createApp({
    environment: "test", databaseHandle: database, backupDir, destructiveOperationsEnabled: true,
    backupEncryption: parseBackupEncryptionConfig({ activeKey: key, activeKeyId: "synthetic", authCookieSecret: secret }),
    auth: { authCookieSecret: secret, auditDir: backupDir, allowedOrigins: ["http://local"] },
  });
  return { root, database, app, unitId, backupDir, databasePath, cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

it("archives one original workbook, preserves history, tracks submission, and restores exact attachment bytes", async () => {
  const value = await setup();
  const restoredTarget = join(tmpdir(), `operatoros-upp-restored-${randomBytes(8).toString("hex")}`);
  try {
    const admin = await login(value.app);
    const staff = await login(value.app, "staff");
    const original = await workbook("first version");
    const replacement = await workbook("replacement version");
    const upload = await value.app.handle(request("POST", "/api/upp-reports", admin,
      formUpload(original, "UPP_September_2026.xlsx", { school_unit_id: String(value.unitId), month: "2026-09", notes: "Synthetic initial report" })));
    expect(upload.status).toBe(200);
    const first = await upload.json() as { id: number; version_id: number; updated_at: string; file_name: string; submission_status: string };
    expect(first).toMatchObject({ file_name: "UPP_September_2026.xlsx", submission_status: "UPLOADED" });

    const denied = await value.app.handle(request("GET", "/api/upp-reports?month=2026-09", staff));
    expect(denied.status).toBe(403);
    const duplicate = await value.app.handle(request("POST", "/api/upp-reports", admin,
      formUpload(original, "same.xlsx", { school_unit_id: String(value.unitId), month: "2026-09" })));
    expect(duplicate.status).toBe(409);

    const firstDownload = await value.app.handle(request("GET", `/api/upp-reports/${first.id}/download`, admin));
    expect(firstDownload.status).toBe(200);
    expect(Buffer.from(await firstDownload.arrayBuffer())).toEqual(Buffer.from(original));
    const replace = await value.app.handle(request("POST", `/api/upp-reports/${first.id}/versions`, admin,
      formUpload(replacement, "UPP_September_2026_v2.xlsx", { expected_updated_at: first.updated_at, notes: "Synthetic replacement" })));
    expect(replace.status).toBe(200);
    const second = await replace.json() as { id: number; version_id: number; updated_at: string; submission_status: string };
    expect(second.submission_status).toBe("UPLOADED");
    const conflict = await value.app.handle(request("POST", `/api/upp-reports/${first.id}/versions`, admin,
      formUpload(original, "stale.xlsx", { expected_updated_at: first.updated_at })));
    expect(conflict.status).toBe(409);

    const ready = await value.app.handle(request("PATCH", `/api/upp-reports/${first.id}/status`, admin, (() => {
      const form = new FormData(); form.set("status", "READY_FOR_SUBMISSION"); form.set("expected_updated_at", second.updated_at); return form;
    })()));
    expect(ready.status).toBe(200);
    const readyReport = await ready.json() as { updated_at: string; submission_status: string };
    expect(readyReport.submission_status).toBe("READY_FOR_SUBMISSION");

    const evidenceBytes = Buffer.from("synthetic submission receipt");
    const submittedForm = new FormData();
    submittedForm.set("status", "SUBMITTED");
    submittedForm.set("expected_updated_at", readyReport.updated_at);
    submittedForm.set("submission_notes", "Synthetic confirmation");
    submittedForm.set("evidence", new File([evidenceBytes], "submission-receipt.pdf", { type: "application/pdf" }));
    const submitted = await value.app.handle(request("PATCH", `/api/upp-reports/${first.id}/status`, admin, submittedForm));
    expect(submitted.status).toBe(200);
    const submittedReport = await submitted.json() as { updated_at: string; submission_status: string; submitted_by: string };
    expect(submittedReport).toMatchObject({ submission_status: "SUBMITTED", submitted_by: "golden-admin" });
    const invalidTransition = new FormData();
    invalidTransition.set("status", "READY_FOR_SUBMISSION");
    invalidTransition.set("expected_updated_at", submittedReport.updated_at);
    expect((await value.app.handle(request("PATCH", `/api/upp-reports/${first.id}/status`, admin, invalidTransition))).status).toBe(409);

    const detailResponse = await value.app.handle(request("GET", `/api/upp-reports/${first.id}`, admin));
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as { versions: Array<{ id: number; active: boolean }>; history: Array<{ action: string }>; evidence: Array<{ id: number }> };
    expect(detail.versions.map((entry) => entry.active)).toEqual([true, false]);
    expect(detail.history.map((entry) => entry.action)).toEqual(["STATUS_CHANGED", "STATUS_CHANGED", "REPLACEMENT", "UPLOAD"]);
    const evidenceId = detail.evidence[0]!.id;
    const evidenceDownload = await value.app.handle(request("GET", `/api/upp-reports/${first.id}/evidence/${evidenceId}/download`, admin));
    expect(Buffer.from(await evidenceDownload.arrayBuffer())).toEqual(evidenceBytes);

    const backup = await value.app.handle(request("POST", "/api/admin/backups", admin, undefined));
    expect(backup.status).toBe(200);
    const backupFilename = (await backup.json() as { filename: string }).filename;
    const activeHash = String((value.database.client.query("SELECT file_sha256 FROM upp_report_versions WHERE report_id=? AND is_active=1").get(first.id) as { file_sha256: string }).file_sha256);
    const evidenceHash = String((value.database.client.query("SELECT file_sha256 FROM upp_report_submission_evidence WHERE report_id=?").get(first.id) as { file_sha256: string }).file_sha256);
    expect(createHash("sha256").update(replacement).digest("hex")).toBe(activeHash);
    expect(createHash("sha256").update(evidenceBytes).digest("hex")).toBe(evidenceHash);

    value.database.client.run("INSERT INTO students (id,name) VALUES (9876543,'Synthetic post-backup student')");
    const preflight = await value.app.handle(request("POST", `/api/admin/backups/${backupFilename}/restore-preflight`, admin));
    expect(preflight.status).toBe(200);
    const checked = await preflight.json() as { source: { restore_eligible: boolean; sha256: string }; active: { active_sha256: string } };
    expect(checked.source.restore_eligible).toBe(true);
    const restore = await value.app.handle(request("POST", `/api/admin/backups/${backupFilename}/restore`, admin, JSON.stringify({
      current_password: "golden-admin-pass-1",
      confirmation_filename: backupFilename,
      confirmation_phrase: "RESTORE_DATABASE",
      acknowledge_complete_replacement: true,
      acknowledge_session_revocation: true,
      acknowledge_restart_required: true,
      acknowledge_safety_backup: true,
      expected_source_sha256: checked.source.sha256,
      expected_active_sha256: checked.active.active_sha256,
    })));
    expect(restore.status, await restore.clone().text()).toBe(200);
    expect(value.database.client.query("SELECT 1 FROM students WHERE id=9876543").get()).toBeNull();
    const afterApiRestore = await value.app.handle(request("GET", `/api/upp-reports/${first.id}/versions/${second.version_id}/download`, await login(value.app)));
    expect(afterApiRestore.status).toBe(200);
    expect(Buffer.from(await afterApiRestore.arrayBuffer())).toEqual(Buffer.from(replacement));

    rmSync(join(value.root, "upp-reports", "sha256", activeHash.slice(0, 2), activeHash));
    rmSync(join(value.root, "upp-reports", "sha256", evidenceHash.slice(0, 2), evidenceHash));

    const target = restoredTarget;
    mkdirSync(target, { mode: 0o700 });
    const repository = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    const cliRestore = Bun.spawnSync([process.execPath, join(repository, "apps/api/src/backup-cli.ts"), "restore-disposable", backupFilename, target], {
      cwd: repository, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, OPERATOROS_DATA_DIR: value.root, DATABASE_URL: `sqlite:///${value.databasePath}`, BACKUP_ENCRYPTION_KEY: key, BACKUP_ENCRYPTION_KEY_ID: "synthetic", AUTH_COOKIE_SECRET: secret },
    });
    if (cliRestore.exitCode !== 0) throw new Error(cliRestore.stderr.toString());
    const restoredDatabase = openDatabase(join(target, "operatoros.sqlite"));
    try {
      const restoredApp = createApp({ environment: "test", databaseHandle: restoredDatabase, auth: { authCookieSecret: secret, auditDir: join(target, "audit"), allowedOrigins: ["http://local"] } });
      const restoredAdmin = await login(restoredApp);
      const restoredDownload = await restoredApp.handle(request("GET", `/api/upp-reports/${first.id}/versions/${second.version_id}/download`, restoredAdmin));
      expect(restoredDownload.status).toBe(200);
      expect(Buffer.from(await restoredDownload.arrayBuffer())).toEqual(Buffer.from(replacement));
      const restoredEvidence = await restoredApp.handle(request("GET", `/api/upp-reports/${first.id}/evidence/${evidenceId}/download`, restoredAdmin));
      expect(Buffer.from(await restoredEvidence.arrayBuffer())).toEqual(evidenceBytes);
    } finally { restoredDatabase.close(); }
  } finally { value.cleanup(); rmSync(restoredTarget, { recursive: true, force: true }); }
}, 30000);

it("rejects unreadable workbooks and keeps non-admin users out of uploads", async () => {
  const value = await setup();
  try {
    const admin = await login(value.app);
    const staff = await login(value.app, "staff");
    const invalid = formUpload(Buffer.from("not an xlsx"), "invalid.xlsx", { school_unit_id: String(value.unitId), month: "2026-09" });
    expect((await value.app.handle(request("POST", "/api/upp-reports", admin, invalid))).status).toBe(400);
    const valid = formUpload(await workbook("denied"), "valid.xlsx", { school_unit_id: String(value.unitId), month: "2026-09" });
    expect((await value.app.handle(request("POST", "/api/upp-reports", staff, valid))).status).toBe(403);
    expect(existsSync(join(value.root, "upp-reports"))).toBe(false);
  } finally { value.cleanup(); }
});
