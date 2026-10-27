import { expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { createFreshDatabase, openDatabase } from "@operatoros/db";
import { createApp } from "../src/app";
import { createAccountFixture } from "./fixtures/accounts";
import { parseBackupEncryptionConfig } from "../src/security/backup-crypto";

const secret = "synthetic-student-admin-cookie-secret";
const key = randomBytes(32).toString("base64");
const repository = fileURLToPath(new URL("../../../", import.meta.url));

function request(method: string, path: string, cookie?: string, body?: FormData | string, origin = method === "GET" ? undefined : "http://localhost:5173"): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  if (typeof body === "string") headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { method, headers, body });
}

async function login(app: ReturnType<typeof createApp>, role = "admin"): Promise<string> {
  const response = await app.handle(new Request("http://local/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `golden-${role}`, password: `golden-${role}-pass-1` }),
  }));
  const value = response.headers.get("set-cookie")?.match(/astyx_session=([^;]+)/)?.[1];
  if (!value) throw new Error("synthetic session missing");
  return `astyx_session=${value}`;
}

async function pdfBytes(content = "Synthetic IOM test document"): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage().drawText(content);
  return document.save();
}

function formIomUpload(bytes: Uint8Array, filename: string, type: string, description: string): FormData {
  const form = new FormData();
  form.set("iom_type", type);
  form.set("description", description);
  form.set("file", new File([bytes], filename, { type: "application/pdf" }));
  return form;
}

async function setup(studentIomMaxFileSizeBytes?: number) {
  const root = mkdtempSync(join(tmpdir(), "operatoros-student-admin-"));
  const databasePath = join(root, "operatoros.sqlite");
  createAccountFixture(databasePath, "golden-active");
  const database = openDatabase(databasePath);
  const backupDir = join(root, "backups");
  mkdirSync(backupDir, { mode: 0o700 });

  // Insert a test student
  const studentId = "student-phase5-test-01";
  database.client.run(
    `INSERT INTO student_masters (id, full_name, normalized_name, nipd, nisn, nik, student_status, created_at, updated_at)
      VALUES (?, 'Synthetic Student', 'synthetic student', 'NIPD001', '0012345678', 'SYNTHETIC-NIK-0001', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [studentId]
  );

  const app = createApp({
    databaseHandle: database,
    auth: { authCookieSecret: secret },
    backupDir,
    backupEncryption: parseBackupEncryptionConfig({
      activeKey: key,
      activeKeyId: "key-test-1",
      authCookieSecret: secret,
    }),
    studentIomMaxFileSizeBytes,
    destructiveOperationsEnabled: true,
  });

  const session = await login(app);
  return {
    app,
    root,
    backupDir,
    database,
    studentId,
    session,
    cleanup: () => {
      try { database.close(); } catch {}
      rmSync(root, { recursive: true, force: true });
    },
  };
}

it("tracks distinct NIK and KK entry, verification, correction, and audit states", async () => {
  const env = await setup();
  try {
    // 1. Initially empty verifications
    const getInitial = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, env.session));
    expect(getInitial.status).toBe(200);
    const initialData = (await getInitial.json()) as any;
    expect(initialData.verifications).toHaveLength(0);
    expect(initialData.history).toHaveLength(0);

    const originalNik = env.database.client.query("SELECT nik FROM student_masters WHERE id = ?").get(env.studentId) as { nik: string };
    env.database.client.run("UPDATE student_masters SET nik = NULL WHERE id = ?", [env.studentId]);
    const missingNikEntry = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "IDENTIFIER_ENTERED",
    })));
    expect(missingNikEntry.status).toBe(409);
    env.database.client.run("UPDATE student_masters SET nik = ? WHERE id = ?", [originalNik.nik, env.studentId]);

    env.database.client.run("INSERT INTO student_document_statuses (student_master_id, family_card_received) VALUES (?, 1)", [env.studentId]);
    expect((await (await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, env.session))).json() as any).verifications).toHaveLength(0);

    const prematureNik = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "VERIFIED",
    })));
    expect(prematureNik.status).toBe(409);

    const enteredNik = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "IDENTIFIER_ENTERED",
    })));
    expect(enteredNik.status).toBe(200);

    // Verify NIK only after the entered state is recorded.
    const verifyNik = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "VERIFIED",
      notes: "Verified against Dukcapil record",
    })));
    expect(verifyNik.status).toBe(200);
    const nikData = (await verifyNik.json()) as any;
    expect(nikData.identifier_type).toBe("NIK");
    expect(nikData.verification_status).toBe("VERIFIED");
    expect(nikData.verified_by).toBe("golden-admin");
    expect(nikData.verified_at).not.toBeNull();

    // 3. Mark KK as NEEDS_CORRECTION without reason -> rejected with 422
    const badKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
    })));
    expect(badKk.status).toBe(422);

    // 4. Mark KK as NEEDS_CORRECTION with reason
    const correctKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
      correction_reason: "Family Card number blurry in scan",
    })));
    expect(correctKk.status).toBe(200);
    const kkData = (await correctKk.json()) as any;
    expect(kkData.identifier_type).toBe("KK");
    expect(kkData.verification_status).toBe("NEEDS_CORRECTION");
    expect(kkData.correction_reason).toBe("Family Card number blurry in scan");

    const prematureKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "VERIFIED",
    })));
    expect(prematureKk.status).toBe(409);
    const enteredKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "IDENTIFIER_ENTERED",
    })));
    expect(enteredKk.status).toBe(200);
    const verifiedKk = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "VERIFIED",
    })));
    expect(verifiedKk.status).toBe(200);

    // 5. Query verifications and history
    const getFinal = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, env.session));
    const finalData = (await getFinal.json()) as any;
    expect(finalData.verifications).toHaveLength(2);
    expect(finalData.history).toHaveLength(5);
    expect(finalData.history.some((entry: any) => entry.correction_reason === "Family Card number blurry in scan")).toBe(true);

    // 6. Ensure raw NIK / KK values are NEVER in operations_audit_events
    const audits = env.database.client.query("SELECT * FROM operations_audit_events WHERE entity_reference = ?").all(env.studentId) as any[];
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const metadataStr = String(a.metadata || "");
      expect(metadataStr.includes("SYNTHETIC-NIK-0001")).toBe(false);
    }

    const changedNik = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/profile`, env.session, JSON.stringify({ identity: { full_name: "Synthetic Student", nik: "SYNTHETIC-NIK-0002" } })));
    expect(changedNik.status).toBe(200);
    expect(env.database.client.query("SELECT verification_status,correction_reason FROM student_identity_verifications WHERE student_master_id = ? AND identifier_type = 'NIK'").get(env.studentId)).toEqual({
      verification_status: "NEEDS_CORRECTION", correction_reason: "NIK value changed; re-verification is required.",
    });
    expect(env.database.client.query("SELECT old_value,new_value FROM student_master_change_history WHERE student_master_id = ? AND field_name = 'nik' ORDER BY id DESC LIMIT 1").get(env.studentId)).toEqual({
      old_value: "[REDACTED]", new_value: "[REDACTED]",
    });

    // 7. Verify triggers protect verification history
    expect(() => {
      env.database.client.run("UPDATE student_identity_verification_history SET to_status = 'MUTATED'");
    }).toThrow();
    expect(() => {
      env.database.client.run("DELETE FROM student_identity_verification_history");
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("tracks DAPODIK registration status and history with triggers", async () => {
  const env = await setup();
  try {
    // 1. Initial status
    const getInitial = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/dapodik-status`, env.session));
    expect(getInitial.status).toBe(200);
    const initialData = (await getInitial.json()) as any;
    expect(initialData.registration).toBeNull();
    expect(initialData.history).toHaveLength(0);

    const invalidStart = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({ status: "ENTERED" })));
    expect(invalidStart.status).toBe(409);

    const pendingRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({ status: "PENDING_EXTERNAL_PROCESSING" })));
    expect(pendingRes.status).toBe(200);

    // 2. Transition to ENTERED
    const enterRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "ENTERED",
      external_reference: "REG-2026-DAPODIK-99",
      notes: "Inputted in desktop client",
    })));
    expect(enterRes.status).toBe(200);
    const enterData = (await enterRes.json()) as any;
    expect(enterData.status).toBe("ENTERED");
    expect(enterData.external_reference).toBe("REG-2026-DAPODIK-99");
    expect(enterData.updated_by).toBe("golden-admin");

    // 3. Transition to SYNCHRONIZED
    const syncRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "SYNCHRONIZED",
      notes: "Verified on Dapodik cloud portal",
    })));
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.status).toBe("SYNCHRONIZED");
    expect(syncData.synchronized_at).not.toBeNull();

    // 4. History log check
    const histRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/dapodik-status`, env.session));
    const histData = (await histRes.json()) as any;
    expect(histData.history).toHaveLength(3);
    const invalidRegression = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({ status: "ENTERED" })));
    expect(invalidRegression.status).toBe(409);
    expect((await (await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/dapodik-status`, env.session))).json() as any).history).toHaveLength(3);
    expect(() => env.database.client.run("UPDATE student_dapodik_registrations SET status = 'ENTERED' WHERE student_master_id = ?", [env.studentId])).toThrow();

    // 5. Verify triggers protect history
    expect(() => {
      env.database.client.run("UPDATE student_dapodik_history SET to_status = 'MUTATED'");
    }).toThrow();
    expect(() => {
      env.database.client.run("DELETE FROM student_dapodik_history");
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("manages IOM documents: upload, magic bytes validation, download, description edit, and triggers", async () => {
  const env = await setup();
  try {
    const validPdf = await pdfBytes("Official Inter Office Memo content from CSO");
    const invalidFile = new TextEncoder().encode("Not a PDF document");
    const malformedPdf = new TextEncoder().encode("%PDF-1.4\nnot a structurally valid PDF");

    // 1. Reject invalid non-PDF file
    const badUpload = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(invalidFile, "fake.pdf", "TRANSFER_IN", "Transfer from SMP 1")));
    expect(badUpload.status).toBe(400);
    const malformedUpload = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(malformedPdf, "broken.pdf", "TRANSFER_IN", "Transfer memo")));
    expect(malformedUpload.status).toBe(400);

    // 2. Reject missing description
    const noDescUpload = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "valid.pdf", "TRANSFER_IN", "   ")));
    expect(noDescUpload.status).toBe(422);
    const unsupportedType = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "valid.pdf", "OTHER", "Other memo")));
    expect(unsupportedType.status).toBe(400);

    // 3. Successful upload
    const uploadRes = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "../../cso_memo_001.pdf", "TRANSFER_IN", "Transfer memo from CSO")));
    expect(uploadRes.status).toBe(201);
    const docData = (await uploadRes.json()) as any;
    expect(docData.iom_type).toBe("TRANSFER_IN");
    expect(docData.description).toBe("Transfer memo from CSO");
    expect(docData.uploaded_by).toBe("golden-admin");
    expect(docData.file_sha256).toBeDefined();
    expect(docData.original_filename).toBe("cso_memo_001.pdf");

    // 4. Download document
    const downloadRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}/download`, env.session));
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("application/pdf");
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(downloadedBytes.length).toBe(validPdf.length);
    const originalHash = createHash("sha256").update(downloadedBytes).digest("hex");

    const staffSession = await login(env.app, "staff");
    expect((await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents`, staffSession))).status).toBe(403);
    expect((await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}/download`, staffSession))).status).toBe(403);
    expect((await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}`, staffSession, JSON.stringify({ description: "Unauthorized edit" })))).status).toBe(403);
    expect((await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/identity-verifications`, staffSession))).status).toBe(403);
    expect((await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, staffSession, JSON.stringify({ identifier_type: "NIK", verification_status: "VERIFIED" })))).status).toBe(403);

    // 5. Edit description
    const editRes = await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}`, env.session, JSON.stringify({
      description: "Updated memo description with SOP reference",
    })));
    expect(editRes.status).toBe(200);
    const editedData = (await editRes.json()) as any;
    expect(editedData.description).toBe("Updated memo description with SOP reference");
    expect(editedData.updated_by).toBe("golden-admin");
    const afterEdit = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}/download`, env.session));
    expect(createHash("sha256").update(new Uint8Array(await afterEdit.arrayBuffer())).digest("hex")).toBe(originalHash);
    const audit = env.database.client.query("SELECT metadata FROM operations_audit_events WHERE operation = 'UPDATE_IOM_DOCUMENT_DESCRIPTION'").get() as { metadata: string };
    expect(JSON.parse(audit.metadata)).toMatchObject({ previous_description: "Transfer memo from CSO", description: "Updated memo description with SOP reference" });

    // 6. Triggers protect delete and hash mutation
    expect(() => {
      env.database.client.run("DELETE FROM student_iom_documents WHERE id = ?", [docData.id]);
    }).toThrow();
    expect(() => {
      env.database.client.run("UPDATE student_iom_documents SET file_sha256 = 'tampered' WHERE id = ?", [docData.id]);
    }).toThrow();
  } finally {
    env.cleanup();
  }
});

it("includes IOM documents in encrypted backup and successfully restores them", async () => {
  const env = await setup();
  let restoredDatabase: ReturnType<typeof openDatabase> | undefined;
  let restoreTarget: string | undefined;
  try {
    const validPdf = await pdfBytes("IOM memo content for encrypted backup verification");
    const originalHash = createHash("sha256").update(validPdf).digest("hex");
    const uploadRes = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "memo_backup_test.pdf", "TRANSFER_OUT", "Transfer out to international school")));
    expect(uploadRes.status).toBe(201);
    const docData = (await uploadRes.json()) as any;

    // Trigger backup
    const backupRes = await env.app.handle(request("POST", "/api/admin/backups", env.session, JSON.stringify({})));
    if (backupRes.status !== 200) console.log("BACKUP_FAIL_BODY:", await backupRes.text());
    expect(backupRes.status).toBe(200);
    const backupData = (await backupRes.json()) as any;
    expect(backupData.filename).toBeDefined();

    restoreTarget = mkdtempSync(join(tmpdir(), "operatoros-iom-restore-"));
    const restored = Bun.spawnSync([process.execPath, join(repository, "apps/api/src/backup-cli.ts"), "restore-disposable", backupData.filename, restoreTarget], {
      cwd: repository,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPERATOROS_DATA_DIR: env.root,
        DATABASE_URL: `sqlite:///${join(env.root, "operatoros.sqlite")}`,
        BACKUP_ENCRYPTION_KEY: key,
        BACKUP_ENCRYPTION_KEY_ID: "key-test-1",
        AUTH_COOKIE_SECRET: secret,
      },
    });
    if (restored.exitCode !== 0) throw new Error(`Disposable restore failed: ${String(restored.stderr)}`);
    restoredDatabase = openDatabase(join(restoreTarget, "operatoros.sqlite"));
    const restoredApp = createApp({ environment: "test", databaseHandle: restoredDatabase, auth: { authCookieSecret: secret } });
    const restoredSession = await login(restoredApp);
    const metadataResponse = await restoredApp.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents`, restoredSession));
    expect(metadataResponse.status).toBe(200);
    expect((await metadataResponse.json() as any[])[0]).toMatchObject({
      id: docData.id,
      uploaded_by: "golden-admin",
      original_filename: "memo_backup_test.pdf",
    });
    const download = await restoredApp.handle(request("GET", `/api/student-masters/${env.studentId}/iom-documents/${docData.id}/download`, restoredSession));
    expect(download.status).toBe(200);
    expect(createHash("sha256").update(new Uint8Array(await download.arrayBuffer())).digest("hex")).toBe(originalHash);
  } finally {
    restoredDatabase?.close();
    if (restoreTarget) rmSync(restoreTarget, { recursive: true, force: true });
    env.cleanup();
  }
});

it("rejects IOM PDFs above the configured upload limit without creating a document record", async () => {
  const env = await setup(1);
  try {
    const pdf = await pdfBytes();
    const response = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(pdf, "large.pdf", "TRANSFER_IN", "Synthetic memo")));
    expect(response.status).toBe(400);
    expect(env.database.client.query("SELECT COUNT(*) AS count FROM student_iom_documents WHERE student_master_id = ?").get(env.studentId)).toEqual({ count: 0 });
  } finally {
    env.cleanup();
  }
});

it("rolls back an IOM document when its audit record cannot be written", async () => {
  const env = await setup();
  try {
    env.database.client.exec(`CREATE TRIGGER reject_iom_upload_audit BEFORE INSERT ON operations_audit_events
      WHEN NEW.operation = 'UPLOAD_IOM_DOCUMENT' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
    const pdf = await pdfBytes("Synthetic memo for failed database transaction");
    const response = await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(pdf, "failed.pdf", "TRANSFER_OUT", "Synthetic memo")));
    expect(response.status).toBe(409);
    expect(env.database.client.query("SELECT COUNT(*) AS count FROM student_iom_documents WHERE student_master_id = ?").get(env.studentId)).toEqual({ count: 0 });
    expect(await response.text()).not.toContain(env.root);
  } finally {
    env.cleanup();
  }
});

it("enriches student detail profile and supports status filtering in student management list & csv export", async () => {
  const env = await setup();
  try {
    // Set up NIK verification, DAPODIK status, and upload an IOM document
    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "IDENTIFIER_ENTERED",
    })));
    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "NIK",
      verification_status: "VERIFIED",
    })));

    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/identity-verifications`, env.session, JSON.stringify({
      identifier_type: "KK",
      verification_status: "NEEDS_CORRECTION",
      correction_reason: "Document unreadable",
    })));

    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({
      status: "PENDING_EXTERNAL_PROCESSING",
    })));
    await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, env.session, JSON.stringify({ status: "ENTERED" })));

    const validPdf = await pdfBytes("IOM memo content");
    await env.app.handle(request("POST", `/api/student-masters/${env.studentId}/iom-documents`, env.session, formIomUpload(validPdf, "iom_memo.pdf", "TRANSFER_IN", "Incoming transfer")));

    // 1. Fetch student detail profile
    const profileRes = await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/profile`, env.session));
    expect(profileRes.status).toBe(200);
    const profileData = (await profileRes.json()) as any;
    expect(profileData.identity_verifications).toHaveLength(2);
    expect(profileData.dapodik_registration).not.toBeNull();
    expect(profileData.dapodik_registration.status).toBe("ENTERED");
    expect(profileData.identity.nik).toBe("SYNTHETIC-NIK-0001");
    expect(profileData.iom_documents).toHaveLength(1);
    expect(profileData.iom_documents[0].iom_type).toBe("TRANSFER_IN");

    const staffSession = await login(env.app, "staff");
    const staffProfile = await (await env.app.handle(request("GET", `/api/student-masters/${env.studentId}/profile`, staffSession))).json() as any;
    expect(staffProfile.identity.nik).toBeNull();
    expect(staffProfile.iom_documents).toEqual([]);
    expect((await env.app.handle(request("PATCH", `/api/student-masters/${env.studentId}/dapodik-status`, staffSession, JSON.stringify({ status: "NEEDS_CORRECTION", correction_reason: "Synthetic reason" })))).status).toBe(403);

    // 2. Fetch list with matching filters
    const listRes = await env.app.handle(request("GET", `/api/student-masters/management/list?nik_verification_status=VERIFIED&kk_verification_status=NEEDS_CORRECTION&dapodik_status=ENTERED`, env.session));
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.items.some((s: any) => s.id === env.studentId)).toBe(true);

    // 3. Fetch list with non-matching filter
    const mismatchRes = await env.app.handle(request("GET", `/api/student-masters/management/list?nik_verification_status=UNVERIFIED`, env.session));
    expect(mismatchRes.status).toBe(200);
    const mismatchData = (await mismatchRes.json()) as any;
    expect(mismatchData.items.some((s: any) => s.id === env.studentId)).toBe(false);

    // 4. Export CSV with filter
    const csvRes = await env.app.handle(request("GET", `/api/student-masters/management/export.csv?nik_verification_status=VERIFIED`, env.session));
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText.includes("Synthetic Student")).toBe(true);
    expect(csvText.includes("SYNTHETIC-NIK-0001")).toBe(false);
  } finally {
    env.cleanup();
  }
});
